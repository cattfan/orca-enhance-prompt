// The plugin's worker: gathers project context at the chosen level, runs the model chain with
// fallback, sends prompts to agent terminals, keeps history, manages model profiles, and runs the
// optional agent.prompt.before auto-enhance hook.
import type { JsonValue, OrcaWorkerApi } from 'orca/worker'
import { copyToClipboard } from './clipboard'
import { atLeast, cachedStatic, findFocusedWorkspace, gatherContext, staticParts, type ContextItem } from './context/index'
import { HISTORY_KEY, parseHistory, toJson, type HistoryEntry } from './history'
import {
  candidates,
  ChainError,
  loadModels,
  resolveKey,
  runChain,
  saveModels,
  secretName,
  viewProfiles,
  type ChainOptions
} from './models'
import { isContextLevel, newProfileId, normalizeProfile, PRESETS, type ContextLevel, type ModelsConfig } from './presets'
import { buildSystemPrompt, buildUserMessage, cleanOutput, formatForTerminal, isStyle, type Style } from './prompts'
import type { ModelsView } from './protocol'

const AUTO_MODES = ['off', 'rules', 'ai'] as const
type AutoMode = (typeof AUTO_MODES)[number]
/** Orca waits 2 s for a hook; leave room to answer. */
const HOOK_BUDGET_MS = 1700

export type Settings = {
  defaultStyle: Style
  outputLanguage: string
  customInstructions: string
  contextLevel: ContextLevel
  terminalLines: number
  extraContextFiles: string[]
  excludePatterns: string
  adaptToAgent: boolean
  fallbackEnabled: boolean
  fallbackOn: 'any' | 'transient'
  timeoutSeconds: number
  sendMode: string
  sendPressEnter: boolean
  historyLimit: number
  autoEnhanceMode: AutoMode
  autoEnhanceAppend: string
  autoEnhanceMinLength: number
  autoEnhanceContext: boolean
}

const str = (value: JsonValue | undefined, fallback = '') => (typeof value === 'string' ? value : fallback)
const num = (value: JsonValue | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const bool = (value: JsonValue | undefined, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

export async function readSettings(orca: OrcaWorkerApi): Promise<Settings> {
  const all = await orca.settings.get()
  const mode = str(all.autoEnhanceMode, 'off')
  const style = str(all.defaultStyle, 'balanced')
  const level = str(all.contextLevel, 'standard')
  return {
    defaultStyle: isStyle(style) ? style : 'balanced',
    outputLanguage: str(all.outputLanguage, 'auto'),
    customInstructions: str(all.customInstructions),
    contextLevel: isContextLevel(level) ? level : 'standard',
    terminalLines: num(all.terminalLines, 100),
    extraContextFiles: str(all.extraContextFiles)
      .split('\n')
      .map((line) => line.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
      .filter((line) => line && !line.startsWith('/') && !line.includes('..'))
      .slice(0, 10),
    excludePatterns: str(all.excludePatterns),
    adaptToAgent: bool(all.adaptToAgent, true),
    fallbackEnabled: bool(all.fallbackEnabled, true),
    fallbackOn: str(all.fallbackOn) === 'transient' ? 'transient' : 'any',
    timeoutSeconds: num(all.timeoutSeconds, 60),
    sendMode: str(all.sendMode, 'paste'),
    sendPressEnter: bool(all.sendPressEnter, false),
    historyLimit: num(all.historyLimit, 50),
    autoEnhanceMode: (AUTO_MODES as readonly string[]).includes(mode) ? (mode as AutoMode) : 'off',
    autoEnhanceAppend: str(all.autoEnhanceAppend),
    autoEnhanceMinLength: num(all.autoEnhanceMinLength, 8),
    autoEnhanceContext: bool(all.autoEnhanceContext, true)
  }
}

function hostError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

function chainOptions(settings: Settings, signal?: AbortSignal, extra: Partial<ChainOptions> = {}): ChainOptions {
  return {
    signal,
    timeoutMs: settings.timeoutSeconds * 1000,
    fallback: settings.fallbackEnabled,
    fallbackOn: settings.fallbackOn,
    ...extra
  }
}

async function addHistory(orca: OrcaWorkerApi, limit: number, entry: Omit<HistoryEntry, 'id' | 'at'>): Promise<void> {
  if (limit <= 0) return
  const list = parseHistory(await orca.storage.get(HISTORY_KEY))
  const at = Date.now()
  const next: HistoryEntry[] = [
    { id: `${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, ...entry },
    ...list
  ].slice(0, limit)
  await orca.storage.set(HISTORY_KEY, next.map(toJson))
}

/** Asks a model to choose relevant files from a list; answers a JSON array of paths. */
async function pickFilesWithModel(
  orca: OrcaWorkerApi,
  config: ModelsConfig,
  settings: Settings,
  tree: string[],
  prompt: string,
  signal?: AbortSignal
): Promise<string[]> {
  const system =
    'You pick source files relevant to a coding task. Answer ONLY a JSON array of up to 8 file paths copied exactly from the list, most relevant first. No prose.'
  const user = `<task>\n${prompt}\n</task>\n<files>\n${tree.join('\n')}\n</files>`
  const list = candidates(config.profiles, config.selectorProfileId, settings.fallbackEnabled)
  const { text } = await runChain(orca, list, system, user, chainOptions(settings, signal, { timeoutMs: 25_000 }))
  const match = /\[[\s\S]*\]/.exec(text)
  if (!match) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return []
  }
  return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string').slice(0, 8) : []
}

export async function enhance(
  orca: OrcaWorkerApi,
  input: { prompt: string; style?: string; terminalId?: string | null; level?: string; profileId?: string | null; exclude?: string[] },
  signal?: AbortSignal
) {
  const prompt = input.prompt.trim()
  if (!prompt) throw hostError('Write a prompt first.', 'invalid_params')
  const settings = await readSettings(orca)
  const config = await loadModels(orca)
  const style: Style = isStyle(input.style) ? input.style : settings.defaultStyle
  const level: ContextLevel = isContextLevel(input.level) ? input.level : settings.contextLevel

  const gathered = await gatherContext(orca, {
    level,
    prompt,
    terminalId: input.terminalId ?? null,
    terminalLines: settings.terminalLines,
    exclude: new Set(input.exclude ?? []),
    extraFiles: settings.extraContextFiles,
    excludePatterns: settings.excludePatterns,
    pickFiles: (tree, task) => pickFilesWithModel(orca, config, settings, tree, task, signal)
  })
  const agentItem = gathered.items.find((entry) => entry.kind === 'agent')
  const system = buildSystemPrompt({
    style,
    language: settings.outputLanguage,
    customInstructions: settings.customInstructions,
    agent: settings.adaptToAgent ? (agentItem?.content.split(' ')[0] ?? null) : null
  })
  const user = buildUserMessage(prompt, gathered.items)
  const list = candidates(config.profiles, input.profileId ?? null, settings.fallbackEnabled)
  try {
    const result = await runChain(orca, list, system, user, chainOptions(settings, signal))
    return {
      enhanced: cleanOutput(result.text),
      profile: result.profile,
      attempts: result.attempts,
      items: gathered.items,
      notes: gathered.notes,
      settings,
      style
    }
  } catch (error) {
    if (error instanceof ChainError) throw hostError(error.message, error.code)
    throw error
  }
}

const view = (items: ContextItem[]) => items.map(({ content: _content, ...rest }) => rest)

async function modelsView(orca: OrcaWorkerApi): Promise<ModelsView> {
  const config = await loadModels(orca)
  return {
    profiles: await viewProfiles(orca, config.profiles),
    hookProfileId: config.hookProfileId,
    selectorProfileId: config.selectorProfileId,
    fromEnv: config.fromEnv,
    presets: PRESETS
  }
}

/** Stored profiles only; env-derived ones become real profiles once the person edits anything. */
async function editableModels(orca: OrcaWorkerApi): Promise<ModelsConfig> {
  const { fromEnv: _fromEnv, ...config } = await loadModels(orca)
  return config
}

/** Prompt-independent context for the hook: whatever the cache holds for the focused workspace. */
async function hookContext(orca: OrcaWorkerApi): Promise<ContextItem[]> {
  const focused = await orca.host.call('workspace.readContext', {}).catch(() => null)
  if (!focused) return []
  const items: ContextItem[] = []
  const label = `${focused.displayName}${focused.branch ? ` (branch ${focused.branch})` : ''}`
  items.push({ id: 'workspace', kind: 'workspace', label: 'Workspace', content: label, chars: label.length })
  const workspace = await findFocusedWorkspace(orca, focused)
  const cached = workspace && workspace.hostId === null ? cachedStatic(workspace.path) : null
  if (cached) items.push(...cached.items.filter((entry) => entry.kind !== 'tree'))
  return items
}

const MODE_LABEL: Record<AutoMode, string> = { off: 'off', rules: 'rules', ai: 'AI' }

async function refreshStatusBar(orca: OrcaWorkerApi): Promise<void> {
  if (!orca.host.has('statusBar.update')) return
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
    const result = await enhance(orca, input, signal)
    const model = result.attempts.find((attempt) => attempt.ok)?.model ?? result.profile.model
    await addHistory(orca, result.settings.historyLimit, {
      original: input.prompt.trim(),
      enhanced: result.enhanced,
      style: result.style,
      model,
      source: 'panel'
    }).catch((error) => orca.log(`history: ${(error as Error).message}`))
    return {
      enhanced: result.enhanced,
      model,
      profileName: result.profile.name,
      ms: Date.now() - started,
      attempts: result.attempts,
      context: view(result.items),
      notes: result.notes
    }
  })

  orca.panels.handle('context.preview', async ({ prompt, terminalId, level, exclude }) => {
    const settings = await readSettings(orca)
    const gathered = await gatherContext(orca, {
      level: isContextLevel(level) ? level : settings.contextLevel,
      prompt,
      terminalId: terminalId ?? null,
      terminalLines: settings.terminalLines,
      exclude: new Set(exclude ?? []),
      extraFiles: settings.extraContextFiles,
      excludePatterns: settings.excludePatterns
    })
    const notes = [...gathered.notes]
    if (level === 'max') notes.push('Preview skips the AI file picker.')
    return { context: view(gathered.items), notes, chars: gathered.items.reduce((sum, entry) => sum + entry.chars, 0) }
  })

  orca.panels.handle('prompt.send', async ({ terminalId, text, enter }) => {
    const settings = await readSettings(orca)
    const payload = formatForTerminal(text, settings.sendMode)
    if (!payload) throw hostError('Nothing to send.', 'invalid_params')
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
    const agents = await orca.host.call('agents.list', {}).catch(() => null)
    for (const agent of agents?.agents ?? []) {
      if (agent.terminalId && !seen.has(agent.terminalId)) {
        seen.add(agent.terminalId)
        targets.push({ terminalId: agent.terminalId, label: `${agent.title ?? agent.agent ?? 'Agent'} · ${agent.state}`, agent: agent.agent })
      }
    }
    const context = await orca.host.call('workspace.readContext', {}).catch(() => null)
    for (const terminal of context?.terminals ?? []) {
      if (!seen.has(terminal.id)) {
        seen.add(terminal.id)
        targets.push({ terminalId: terminal.id, label: terminal.title ?? terminal.id, agent: null })
      }
    }
    return { targets }
  })

  // ---- model profiles ----

  orca.panels.handle('models.get', async () => modelsView(orca))

  orca.panels.handle('models.save', async (input) => {
    const config = await editableModels(orca)
    const existing = input.id ? config.profiles.findIndex((profile) => profile.id === input.id) : -1
    const id = existing >= 0 ? config.profiles[existing].id : newProfileId(input.name || input.preset)
    const profile = normalizeProfile({ ...input, id })
    if (!profile) throw hostError('Invalid model profile.', 'invalid_params')
    if (existing >= 0) config.profiles[existing] = profile
    else config.profiles.push(profile)
    await saveModels(orca, config)
    if (input.apiKey !== undefined) {
      if (input.apiKey.trim()) await orca.secrets.set(secretName(id), input.apiKey.trim())
      else await orca.secrets.delete(secretName(id)).catch(() => undefined)
    }
    return modelsView(orca)
  })

  orca.panels.handle('models.delete', async ({ id }) => {
    const config = await editableModels(orca)
    config.profiles = config.profiles.filter((profile) => profile.id !== id)
    if (config.hookProfileId === id) config.hookProfileId = null
    if (config.selectorProfileId === id) config.selectorProfileId = null
    await saveModels(orca, config)
    await orca.secrets.delete(secretName(id)).catch(() => undefined)
    return modelsView(orca)
  })

  orca.panels.handle('models.move', async ({ id, direction }) => {
    const config = await editableModels(orca)
    const index = config.profiles.findIndex((profile) => profile.id === id)
    const target = direction === 'up' ? index - 1 : index + 1
    if (index >= 0 && target >= 0 && target < config.profiles.length) {
      const [moved] = config.profiles.splice(index, 1)
      config.profiles.splice(target, 0, moved)
      await saveModels(orca, config)
    }
    return modelsView(orca)
  })

  orca.panels.handle('models.roles', async ({ hookProfileId, selectorProfileId }) => {
    const config = await editableModels(orca)
    const valid = (id: string | null) => (id && config.profiles.some((profile) => profile.id === id) ? id : null)
    config.hookProfileId = valid(hookProfileId)
    config.selectorProfileId = valid(selectorProfileId)
    await saveModels(orca, config)
    return modelsView(orca)
  })

  orca.panels.handle('models.test', async ({ id }, { signal }) => {
    const config = await loadModels(orca)
    const profile = config.profiles.find((entry) => entry.id === id)
    if (!profile) return { ok: false, message: 'Unknown profile.', ms: 0 }
    const settings = await readSettings(orca)
    const started = Date.now()
    try {
      const { attempts } = await runChain(
        orca,
        [profile],
        'Reply with exactly: OK',
        'ping',
        chainOptions(settings, signal, { timeoutMs: 30_000, fallback: false })
      )
      const keySource = (await resolveKey(orca, profile)).source
      return { ok: true, message: `${profile.name} · ${attempts[0]?.model} answered (key: ${keySource}).`, ms: Date.now() - started }
    } catch (error) {
      return { ok: false, message: (error as Error).message, ms: Date.now() - started }
    }
  })

  // ---- auto-enhance hook ----

  orca.hooks.on('agent.prompt.before', async (event, next) => {
    const started = Date.now()
    const settings = await readSettings(orca)
    const prompt = event.prompt
    if (settings.autoEnhanceMode === 'off' || prompt.trim().length < settings.autoEnhanceMinLength) return
    if (settings.autoEnhanceMode === 'rules') {
      const append = settings.autoEnhanceAppend.trim()
      if (!append || prompt.includes(append)) return
      orca.panels.post('hook.enhanced', { agent: event.agent, mode: 'rules' })
      return next({ ...event, prompt: `${prompt.trimEnd()}\n\n${append}` })
    }
    try {
      const config = await loadModels(orca)
      const items = settings.autoEnhanceContext ? await hookContext(orca) : []
      const system = buildSystemPrompt({
        style: settings.defaultStyle,
        language: settings.outputLanguage,
        customInstructions: settings.customInstructions,
        agent: settings.adaptToAgent ? event.agent : null
      })
      const list = candidates(config.profiles, config.hookProfileId, settings.fallbackEnabled)
      const result = await runChain(
        orca,
        list,
        system,
        buildUserMessage(prompt, items),
        chainOptions(settings, undefined, { totalMs: HOOK_BUDGET_MS - (Date.now() - started) })
      )
      const enhanced = cleanOutput(result.text)
      const model = result.attempts.find((attempt) => attempt.ok)?.model ?? result.profile.model
      void addHistory(orca, settings.historyLimit, {
        original: prompt,
        enhanced,
        style: settings.defaultStyle,
        model,
        source: 'hook'
      }).catch(() => undefined)
      orca.panels.post('hook.enhanced', { agent: event.agent, mode: 'ai', model })
      return next({ ...event, prompt: enhanced })
    } catch (error) {
      orca.log(`auto-enhance skipped: ${(error as Error).message}`)
      return
    }
  })

  // Keep the prompt-independent context warm, so the hook has it within its 2 s.
  let warmTimer: ReturnType<typeof setTimeout> | null = null
  orca.events.on('workspace.changed', ({ context }) => {
    if (!context) return
    if (warmTimer) clearTimeout(warmTimer)
    warmTimer = setTimeout(async () => {
      try {
        const settings = await readSettings(orca)
        const wantsHook = settings.autoEnhanceMode === 'ai' && settings.autoEnhanceContext
        if (!wantsHook && !atLeast(settings.contextLevel, 'standard')) return
        const workspace = await findFocusedWorkspace(orca, context)
        if (workspace && workspace.hostId === null) await staticParts(workspace.path, settings.extraContextFiles, true)
      } catch (error) {
        orca.log(`context warm-up: ${(error as Error).message}`)
      }
    }, 1500)
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
    if (key === 'autoEnhanceMode') void refreshStatusBar(orca)
  })
  void refreshStatusBar(orca)
}
