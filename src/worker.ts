// The plugin's worker: talks to the LLM, gathers context, sends prompts to agent terminals, keeps
// history, and runs the optional agent.prompt.before auto-enhance hook.
import type { JsonValue, OrcaWorkerApi } from 'orca/worker'
import { copyToClipboard } from './clipboard'
import { HISTORY_KEY, parseHistory, toJson, type HistoryEntry } from './history'
import { gatherContext } from './context'
import { complete, DEFAULTS, LlmError, normalizeProvider, type LlmConfig, type Provider } from './llm'
import {
  buildSystemPrompt,
  buildUserMessage,
  cleanOutput,
  formatForTerminal,
  isStyle,
  type Style
} from './prompts'

const AUTO_MODES = ['off', 'rules', 'ai'] as const
type AutoMode = (typeof AUTO_MODES)[number]
/** Orca waits 2 s for a hook; leave room to answer. */
const HOOK_AI_BUDGET_MS = 1700

type Settings = {
  provider: Provider
  baseUrl: string
  model: string
  defaultStyle: Style
  outputLanguage: string
  customInstructions: string
  includeWorkspaceContext: boolean
  includeProjectFiles: boolean
  includeTerminalLines: number
  temperature: number
  maxTokens: number
  timeoutSeconds: number
  sendMode: string
  sendPressEnter: boolean
  historyLimit: number
  autoEnhanceMode: AutoMode
  autoEnhanceAppend: string
  autoEnhanceMinLength: number
}

const str = (value: JsonValue | undefined, fallback = '') =>
  typeof value === 'string' ? value : fallback
const num = (value: JsonValue | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const bool = (value: JsonValue | undefined, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback

export async function readSettings(orca: OrcaWorkerApi): Promise<Settings> {
  const all = await orca.settings.get()
  const provider = normalizeProvider(all.provider)
  const mode = str(all.autoEnhanceMode, 'off')
  const style = str(all.defaultStyle, 'balanced')
  return {
    provider,
    baseUrl: str(all.baseUrl).trim() || DEFAULTS[provider].baseUrl,
    model: str(all.model).trim() || DEFAULTS[provider].model,
    defaultStyle: isStyle(style) ? style : 'balanced',
    outputLanguage: str(all.outputLanguage, 'auto'),
    customInstructions: str(all.customInstructions),
    includeWorkspaceContext: bool(all.includeWorkspaceContext, true),
    includeProjectFiles: bool(all.includeProjectFiles, true),
    includeTerminalLines: num(all.includeTerminalLines, 0),
    temperature: num(all.temperature, 0.3),
    maxTokens: num(all.maxTokens, 2000),
    timeoutSeconds: num(all.timeoutSeconds, 60),
    sendMode: str(all.sendMode, 'paste'),
    sendPressEnter: bool(all.sendPressEnter, false),
    historyLimit: num(all.historyLimit, 50),
    autoEnhanceMode: (AUTO_MODES as readonly string[]).includes(mode) ? (mode as AutoMode) : 'off',
    autoEnhanceAppend: str(all.autoEnhanceAppend),
    autoEnhanceMinLength: num(all.autoEnhanceMinLength, 8)
  }
}

const secretName = (provider: Provider) => `apiKey.${provider}`

async function resolveKey(
  orca: OrcaWorkerApi,
  provider: Provider
): Promise<{ key: string | null; source: 'secret' | 'env' | 'none' }> {
  const stored = await orca.secrets.get(secretName(provider)).catch(() => null)
  if (stored) {
    return { key: stored, source: 'secret' }
  }
  const env = process.env[DEFAULTS[provider].env]
  if (env) {
    return { key: env, source: 'env' }
  }
  return { key: null, source: 'none' }
}

async function llmConfig(orca: OrcaWorkerApi, settings: Settings): Promise<LlmConfig> {
  const { key } = await resolveKey(orca, settings.provider)
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: key,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens
  }
}

/** Aborts when either the caller's signal does or `ms` passes. */
function deadline(ms: number, outer?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const onAbort = () => controller.abort()
  outer?.addEventListener('abort', onAbort)
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onAbort)
    }
  }
}

function hostError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

async function addHistory(
  orca: OrcaWorkerApi,
  limit: number,
  entry: Omit<HistoryEntry, 'id' | 'at'>
): Promise<void> {
  if (limit <= 0) {
    return
  }
  const stored = await orca.storage.get(HISTORY_KEY)
  const list = parseHistory(stored)
  const at = Date.now()
  const next: HistoryEntry[] = [
    { id: `${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, ...entry },
    ...list
  ].slice(0, limit)
  await orca.storage.set(HISTORY_KEY, next.map(toJson))
}

export async function enhance(
  orca: OrcaWorkerApi,
  input: { prompt: string; style?: string; terminalId?: string | null },
  options: { signal?: AbortSignal; timeoutMs?: number; withContext?: boolean } = {}
): Promise<{ enhanced: string; model: string; provider: string; settings: Settings }> {
  const prompt = input.prompt.trim()
  if (!prompt) {
    throw hostError('Write a prompt first.', 'invalid_params')
  }
  const settings = await readSettings(orca)
  const style: Style = isStyle(input.style) ? input.style : settings.defaultStyle
  const withContext = options.withContext ?? true
  const context = withContext
    ? await gatherContext(orca, {
        includeWorkspace: settings.includeWorkspaceContext,
        includeProjectFiles: settings.includeProjectFiles,
        terminalLines: settings.includeTerminalLines,
        terminalId: input.terminalId ?? null
      })
    : {}
  const system = buildSystemPrompt({
    style,
    language: settings.outputLanguage,
    customInstructions: settings.customInstructions
  })
  const user = buildUserMessage(prompt, context)
  const timer = deadline(options.timeoutMs ?? settings.timeoutSeconds * 1000, options.signal)
  try {
    const raw = await complete(await llmConfig(orca, settings), system, user, timer.signal)
    return { enhanced: cleanOutput(raw), model: settings.model, provider: settings.provider, settings }
  } catch (error) {
    if (error instanceof LlmError) {
      throw hostError(error.message, error.code)
    }
    throw error
  } finally {
    timer.dispose()
  }
}

const MODE_LABEL: Record<AutoMode, string> = { off: 'off', rules: 'rules', ai: 'AI' }

async function refreshStatusBar(orca: OrcaWorkerApi): Promise<void> {
  if (!orca.host.has('statusBar.update')) {
    return
  }
  const { autoEnhanceMode } = await readSettings(orca)
  await orca.host
    .call('statusBar.update', {
      id: 'auto-enhance',
      text: `Enhance: ${MODE_LABEL[autoEnhanceMode]}`,
      tone: autoEnhanceMode === 'off' ? 'neutral' : 'accent'
    })
    .catch(() => undefined)
}

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('prompt.enhance', async (input, { signal }) => {
    const started = Date.now()
    const result = await enhance(orca, input, { signal })
    await addHistory(orca, result.settings.historyLimit, {
      original: input.prompt.trim(),
      enhanced: result.enhanced,
      style: isStyle(input.style) ? input.style : result.settings.defaultStyle,
      model: result.model,
      source: 'panel'
    }).catch((error) => orca.log(`history: ${(error as Error).message}`))
    return {
      enhanced: result.enhanced,
      model: result.model,
      provider: result.provider,
      ms: Date.now() - started
    }
  })

  orca.panels.handle('prompt.send', async ({ terminalId, text, enter }) => {
    const settings = await readSettings(orca)
    const payload = formatForTerminal(text, settings.sendMode)
    if (!payload) {
      throw hostError('Nothing to send.', 'invalid_params')
    }
    const pressEnter = enter ?? settings.sendPressEnter
    const result = await orca.host.call('terminal.sendText', { terminalId, text: payload })
    if (pressEnter && result.accepted) {
      // Give the agent's TUI a beat to take the paste before submitting it.
      await new Promise((resolve) => setTimeout(resolve, 150))
      await orca.host.call('terminal.sendText', { terminalId, text: '\r' })
    }
    return { accepted: result.accepted }
  })

  orca.panels.handle('prompt.copy', async ({ text }) => copyToClipboard(text))

  orca.panels.handle('targets.list', async () => {
    const targets: { terminalId: string; label: string; agent: string | null }[] = []
    const seen = new Set<string>()
    try {
      const { agents } = await orca.host.call('agents.list', {})
      for (const agent of agents) {
        if (agent.terminalId && !seen.has(agent.terminalId)) {
          seen.add(agent.terminalId)
          targets.push({
            terminalId: agent.terminalId,
            label: `${agent.title ?? agent.agent ?? 'Agent'} · ${agent.state}`,
            agent: agent.agent
          })
        }
      }
    } catch {
      // no agents
    }
    try {
      const context = await orca.host.call('workspace.readContext', {})
      for (const terminal of context?.terminals ?? []) {
        if (!seen.has(terminal.id)) {
          seen.add(terminal.id)
          targets.push({ terminalId: terminal.id, label: terminal.title ?? terminal.id, agent: null })
        }
      }
    } catch {
      // no workspace
    }
    return { targets }
  })

  orca.panels.handle('config.status', async () => {
    const settings = await readSettings(orca)
    const { source } = await resolveKey(orca, settings.provider)
    return {
      provider: settings.provider,
      model: settings.model,
      baseUrl: settings.baseUrl,
      keySource: source,
      envName: DEFAULTS[settings.provider].env,
      autoEnhanceMode: settings.autoEnhanceMode
    }
  })

  orca.panels.handle('config.setKey', async ({ provider, key }) => {
    const name = secretName(normalizeProvider(provider))
    if (key.trim()) {
      await orca.secrets.set(name, key.trim())
    } else {
      await orca.secrets.delete(name)
    }
    return { ok: true as const }
  })

  orca.panels.handle('config.test', async (_input, { signal }) => {
    const started = Date.now()
    try {
      const result = await enhance(
        orca,
        { prompt: 'fix typo in readme', style: 'concise' },
        { signal, timeoutMs: 30_000, withContext: false }
      )
      return { ok: true, message: `${result.provider} · ${result.model} answered.`, ms: Date.now() - started }
    } catch (error) {
      return { ok: false, message: (error as Error).message, ms: Date.now() - started }
    }
  })

  orca.hooks.on('agent.prompt.before', async (event, next) => {
    const settings = await readSettings(orca)
    const prompt = event.prompt
    if (settings.autoEnhanceMode === 'off' || prompt.trim().length < settings.autoEnhanceMinLength) {
      return
    }
    if (settings.autoEnhanceMode === 'rules') {
      const append = settings.autoEnhanceAppend.trim()
      if (!append || prompt.includes(append)) {
        return
      }
      orca.panels.post('hook.enhanced', { agent: event.agent, mode: 'rules' })
      return next({ ...event, prompt: `${prompt.trimEnd()}\n\n${append}` })
    }
    try {
      const result = await enhance(
        orca,
        { prompt, terminalId: event.terminalId },
        { timeoutMs: HOOK_AI_BUDGET_MS, withContext: false }
      )
      void addHistory(orca, settings.historyLimit, {
        original: prompt,
        enhanced: result.enhanced,
        style: settings.defaultStyle,
        model: result.model,
        source: 'hook'
      }).catch(() => undefined)
      orca.panels.post('hook.enhanced', { agent: event.agent, mode: 'ai' })
      return next({ ...event, prompt: result.enhanced })
    } catch (error) {
      orca.log(`auto-enhance skipped: ${(error as Error).message}`)
      return
    }
  })

  orca.commands.register('auto-enhance.cycle', async () => {
    const { autoEnhanceMode } = await readSettings(orca)
    const next = AUTO_MODES[(AUTO_MODES.indexOf(autoEnhanceMode) + 1) % AUTO_MODES.length]
    await orca.settings.set('autoEnhanceMode', next)
    await refreshStatusBar(orca)
    return `Auto-enhance: ${MODE_LABEL[next]}`
  })

  orca.commands.register('auto-enhance.off', async () => {
    await orca.settings.set('autoEnhanceMode', 'off')
    await refreshStatusBar(orca)
    return 'Auto-enhance: off'
  })

  orca.settings.onDidChange(({ key }) => {
    if (key === 'autoEnhanceMode') {
      void refreshStatusBar(orca)
    }
  })
  void refreshStatusBar(orca)
}
