// The plugin's worker: gathers project context at the chosen level, runs the model chain with
// fallback, sends prompts to agent terminals, keeps history, manages model profiles, and runs the
// optional agent.prompt.before auto-enhance hook.
import type { JsonValue, OrcaWorkerApi } from 'orca/worker'
import { apiCatalog, claudeCatalog, claudeProgramSignature, codexCatalog, geminiCatalog, parseCatalog, type Catalog } from './catalog.ts'
import { CLI_BINARIES, detectClis } from './cli.ts'
import { copyToClipboard } from './clipboard.ts'
import { atLeast, cachedStatic, contextItem, findFocusedWorkspace, fitBudget, gatherContext, staticParts, type ContextItem } from './context/index.ts'
import { extractError } from './terminal-error.ts'
import { capHistory, HISTORY_KEY, parseHistory, toJson, trimForHistory, type HistoryEntry } from './history.ts'
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
} from './models.ts'
import { isContextLevel, newProfileId, normalizeProfile, presetById, PRESETS, type ContextLevel, type ModelProfile, type ModelsConfig } from './presets.ts'
import { buildSystemPrompt, buildUserMessage, cleanOutput, isStyle, PASTE_END, PASTE_START, terminalChunks, type Style } from './prompts.ts'
import { PANEL_REQUEST_LIMIT_MS, type ModelsView } from './protocol.ts'
import { parsePrivacy, type Privacy } from './privacy.ts'
import { createProgress, planSteps, type StepReporter } from './progress.ts'
import { MODELS_KEY } from './presets.ts'
import { messageOf } from './llm.ts'
import { english, msg, type Message } from './messages.ts'

const AUTO_MODES = ['off', 'rules', 'ai'] as const
type AutoMode = (typeof AUTO_MODES)[number]
/** Orca waits 2 s for a hook; leave room to answer. */
const HOOK_BUDGET_MS = 1700
/**
 * A panel run must answer before the panel stops waiting: the whole run (AI file picker and every
 * model of the fallback chain) shares this budget, a few seconds under the panel's limit. Mutable
 * for tests only.
 */
export const RUN_LIMITS = { budgetMs: PANEL_REQUEST_LIMIT_MS - 5_000, pickerMs: 25_000 }

/** Model lists are fetched again after a day, or on Refresh. */
const CATALOG_TTL_MS = 24 * 3600_000

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
  privacy: Privacy
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
    autoEnhanceContext: bool(all.autoEnhanceContext, true),
    privacy: parsePrivacy(all)
  }
}

/**
 * An error for the panel: English message (logs), a code, and `text`, the message as a code and
 * parameters that the panel shows in its language (extra fields reach the panel as they are).
 */
function hostError(text: Message, code: string): Error {
  return Object.assign(new Error(english(text)), { code, text })
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

/**
 * History is read, changed and written back, so two writers at once (a panel run and the hook, or
 * Clear history) would lose one change. Every history change runs after the previous one.
 */
let historyQueue: Promise<unknown> = Promise.resolve()
export function withHistory<T>(change: () => Promise<T>): Promise<T> {
  const next = historyQueue.then(change, change)
  historyQueue = next.catch(() => undefined)
  return next
}

async function addHistory(orca: OrcaWorkerApi, settings: Settings, entry: Omit<HistoryEntry, 'id' | 'at'>): Promise<void> {
  if (settings.historyLimit <= 0 || !settings.privacy.saveHistory) return
  await withHistory(async () => {
    const list = parseHistory(await orca.storage.get(HISTORY_KEY))
    const at = Date.now()
    const added: HistoryEntry = {
      id: `${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      at,
      ...entry,
      original: trimForHistory(entry.original),
      enhanced: trimForHistory(entry.enhanced)
    }
    const next = capHistory([added, ...list], settings.historyLimit)
    await orca.storage.set(HISTORY_KEY, next.map(toJson))
  })
}

/** Asks a model to choose relevant files from a list; answers a JSON array of paths. */
async function pickFilesWithModel(
  orca: OrcaWorkerApi,
  config: ModelsConfig,
  settings: Settings,
  tree: string[],
  prompt: string,
  signal?: AbortSignal,
  totalMs: number = RUN_LIMITS.pickerMs
): Promise<string[]> {
  const system =
    'You pick source files relevant to a coding task. Answer ONLY a JSON array of up to 8 file paths copied exactly from the list, most relevant first. No prose.'
  const user = `<task>\n${prompt}\n</task>\n<files>\n${tree.join('\n')}\n</files>`
  const list = candidates(config.profiles, config.selectorProfileId, settings.fallbackEnabled)
  const { text } = await runChain(orca, list, system, user, chainOptions(settings, signal, { timeoutMs: RUN_LIMITS.pickerMs, totalMs }))
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

/** The latest error in a terminal's output, as a context item. */
async function readErrorOutput(orca: OrcaWorkerApi, terminalId: string, step: StepReporter, signal?: AbortSignal): Promise<ContextItem> {
  step('error', 'running')
  const read = await orca.host.call('terminal.read', { terminalId, maxLines: 400 }, signal ? { signal } : undefined).catch(() => null)
  const { text, found } = extractError(read?.lines ?? [])
  if (!text) {
    step('error', 'failed')
    throw hostError(msg('error.no_error_output'), 'invalid_params')
  }
  const focused = await orca.host.call('workspace.readContext', {}).catch(() => null)
  const name = focused?.terminals.find((terminal) => terminal.id === terminalId)?.title ?? terminalId
  step('error', 'done', String(text.split('\n').length))
  const note = found ? '' : '(no error line found: the last lines of the output)\n'
  return contextItem('error', 'error', msg('label.error', { name }), note + text)
}

/** Privacy: without project files, nothing beyond workspace and agent names. */
export function allowedLevel(requested: ContextLevel, settings: Settings): ContextLevel {
  return !settings.privacy.allowProjectFiles && atLeast(requested, 'standard') ? 'basic' : requested
}

const PROJECT_FILES_OFF = msg('note.project_files_off')

export async function enhance(
  orca: OrcaWorkerApi,
  input: {
    prompt: string
    style?: string
    terminalId?: string | null
    level?: string
    profileId?: string | null
    model?: string
    language?: string
    exclude?: string[]
    errorTerminalId?: string
  },
  signal?: AbortSignal,
  progress?: (level: ContextLevel, allowProjectFiles: boolean, readsError: boolean) => StepReporter,
  budgetMs?: number
) {
  const deadline = budgetMs === undefined ? undefined : Date.now() + budgetMs
  /** What is left of the run's budget; undefined without one. */
  const left = () => (deadline === undefined ? undefined : Math.max(0, deadline - Date.now()))
  const prompt = input.prompt.trim()
  if (!prompt) throw hostError(msg('error.no_prompt'), 'invalid_params')
  const settings = await readSettings(orca)
  const config = await loadModels(orca)
  const style: Style = isStyle(input.style) ? input.style : settings.defaultStyle
  const requested: ContextLevel = isContextLevel(input.level) ? input.level : settings.contextLevel
  const level = allowedLevel(requested, settings)
  const errorTerminalId = typeof input.errorTerminalId === 'string' && input.errorTerminalId ? input.errorTerminalId.slice(0, 200) : null
  // "Fix this error" reads a terminal: the same Privacy switch as terminal output in the context.
  if (errorTerminalId && !settings.privacy.allowTerminalRead) throw hostError(msg('error.terminal_read_off'), 'not_permitted')
  const step = progress?.(level, settings.privacy.allowProjectFiles, Boolean(errorTerminalId)) ?? (() => undefined)
  const errorItem = errorTerminalId ? await readErrorOutput(orca, errorTerminalId, step, signal) : null

  const gathered = await gatherContext(orca, {
    level,
    prompt,
    terminalId: input.terminalId ?? null,
    terminalLines: settings.terminalLines,
    exclude: new Set(input.exclude ?? []),
    extraFiles: settings.extraContextFiles,
    excludePatterns: settings.excludePatterns,
    // The picker gets its own share, so the rewrite itself always has time left.
    pickFiles: (tree, task) => pickFilesWithModel(orca, config, settings, tree, task, signal, Math.min(RUN_LIMITS.pickerMs, (left() ?? Infinity) / 2)),
    allowGit: settings.privacy.allowGit,
    allowTerminal: settings.privacy.allowTerminalRead,
    onStep: step,
    signal
  })
  if (level !== requested) gathered.notes.push(PROJECT_FILES_OFF)
  // The error comes first and is never trimmed away by the context budget.
  if (errorItem) gathered.items = [errorItem, ...fitBudget(gathered.items, Math.max(0, 45_000 - errorItem.chars))]
  const agentItem = gathered.items.find((entry) => entry.kind === 'agent')
  const language = input.language && /^[a-z]{2,4}$/.test(input.language) ? input.language : settings.outputLanguage
  const system = buildSystemPrompt({
    style,
    language,
    customInstructions: settings.customInstructions,
    agent: settings.adaptToAgent ? (agentItem?.content.split(' ')[0] ?? null) : null
  })
  const user = buildUserMessage(prompt, gathered.items)
  const chosenModel = input.model?.trim().slice(0, 200)
  // The picked model applies to the picked profile only; the rest of the chain keeps its own models.
  const list = candidates(config.profiles, input.profileId ?? null, settings.fallbackEnabled).map((profile) =>
    chosenModel && profile.id === input.profileId ? { ...profile, model: chosenModel } : profile
  )
  try {
    const result = await runChain(
      orca,
      list,
      system,
      user,
      chainOptions(settings, signal, {
        ...(deadline === undefined ? {} : { totalMs: left() }),
        onAttempt: (profile, model, attempt, total) =>
          step('model', 'running', `${profile.name} · ${model || 'default'}${attempt > 1 ? ` · ${attempt}/${total}` : ''}`)
      })
    )
    step('model', 'done', `${result.profile.name} · ${result.attempts.find((attempt) => attempt.ok)?.model ?? ''}`)
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
    step('model', 'failed', (error as Error).message.slice(0, 160))
    if (error instanceof ChainError) throw hostError(error.text, error.code)
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
async function hookContext(orca: OrcaWorkerApi, allowProjectFiles: boolean): Promise<ContextItem[]> {
  const focused = await orca.host.call('workspace.readContext', {}).catch(() => null)
  if (!focused) return []
  const items: ContextItem[] = []
  const label = `${focused.displayName}${focused.branch ? ` (branch ${focused.branch})` : ''}`
  items.push({ id: 'workspace', kind: 'workspace', label: 'Workspace', content: label, chars: label.length })
  if (!allowProjectFiles) return items
  const workspace = await findFocusedWorkspace(orca, focused)
  const cached = workspace && workspace.hostId === null ? cachedStatic(workspace.path) : null
  if (cached) items.push(...cached.items.filter((entry) => entry.kind !== 'tree'))
  return items
}

const MODE_LABEL: Record<AutoMode, string> = { off: 'off', rules: 'rules', ai: 'AI' }

/** Orca's default shortcut for the right sidebar (`sidebar.right.toggle`, Mod+L). */
const SIDEBAR_KEY = process.platform === 'darwin' ? '⌘L' : 'Ctrl+L'

/** Status bar wording per panel language ('auto' stays English: the worker cannot see Orca's locale). */
const STATUS_TEXT: Record<string, { prefix: string; modes: Record<AutoMode, string>; tooltip: (mode: string) => string }> = {
  en: {
    prefix: 'Enhance',
    modes: { off: 'off', rules: 'rules', ai: 'AI' },
    tooltip: (mode) =>
      `Click: open the right sidebar (${SIDEBAR_KEY}), then the lightbulb tab "Enhance Prompt".\nAuto-enhance: ${mode} (change it in the panel's Models tab or the command palette).\nSettings and updates: Settings → Plugins → Enhance Prompt.`
  },
  vi: {
    prefix: 'Enhance',
    modes: { off: 'tắt', rules: 'luật', ai: 'AI' },
    tooltip: (mode) =>
      `Bấm: mở thanh bên phải (${SIDEBAR_KEY}), rồi chọn tab bóng đèn "Enhance Prompt".\nTự cải thiện: ${mode} (đổi trong tab Model của panel hoặc command palette).\nCài đặt và cập nhật: Settings → Plugins → Enhance Prompt.`
  },
  zh: {
    prefix: '优化',
    modes: { off: '关', rules: '规则', ai: 'AI' },
    tooltip: (mode) => `点击：打开右侧边栏（${SIDEBAR_KEY}），再选灯泡标签 “Enhance Prompt”。\n自动优化：${mode}（在面板的“模型”标签或命令面板中更改）。\n设置与更新：Settings → Plugins → Enhance Prompt。`
  }
}

async function refreshStatusBar(orca: OrcaWorkerApi): Promise<void> {
  if (!orca.host.has('statusBar.update')) return
  const all = await orca.settings.get()
  const { autoEnhanceMode } = await readSettings(orca)
  const display = typeof all.statusBarItem === 'string' ? all.statusBarItem : 'full'
  const words = STATUS_TEXT[typeof all.uiLanguage === 'string' ? all.uiLanguage : 'en'] ?? STATUS_TEXT.en
  const mode = words.modes[autoEnhanceMode]
  await orca.host
    .call('statusBar.update', {
      id: 'auto-enhance',
      visible: display !== 'hidden',
      text: display === 'icon' ? '' : `${words.prefix}: ${mode}`,
      icon: autoEnhanceMode === 'off' ? 'lightbulb' : 'zap',
      tone: autoEnhanceMode === 'off' ? 'neutral' : 'accent',
      tooltip: words.tooltip(mode)
    })
    .catch(() => undefined)
}

async function setMode(orca: OrcaWorkerApi, mode: AutoMode): Promise<string> {
  await orca.settings.set('autoEnhanceMode', mode)
  await refreshStatusBar(orca)
  return `Auto-enhance: ${MODE_LABEL[mode]}`
}

/**
 * Writes the pieces in order. If a piece is refused or fails after a bracketed paste has started,
 * the paste is closed, so the agent's input is not left waiting for the end of a paste.
 */
export async function sendPieces(orca: OrcaWorkerApi, terminalId: string, pieces: string[]): Promise<{ accepted: boolean }> {
  const pasting = pieces.length > 1 && pieces[0].startsWith(PASTE_START) && pieces[pieces.length - 1].endsWith(PASTE_END)
  let sent = 0
  try {
    for (const piece of pieces) {
      const result = await orca.host.call('terminal.sendText', { terminalId, text: piece })
      if (!result.accepted) break
      sent++
    }
  } finally {
    if (pasting && sent > 0 && sent < pieces.length) {
      await orca.host.call('terminal.sendText', { terminalId, text: PASTE_END }).catch(() => undefined)
    }
  }
  return { accepted: sent === pieces.length }
}

/** Fetches one model list from its source: the CLI itself, or the provider's API. */
async function fetchCatalog(
  orca: OrcaWorkerApi,
  source: { presetId: string; env: string; provider: string; baseUrl: string; command: string; profile?: ModelProfile; typedKey?: string }
): Promise<Catalog> {
  const { privacy } = await readSettings(orca)
  const online = privacy.allowOnlineModelLists
  if (source.presetId === 'claude-code') return claudeCatalog(source.command, online)
  if (source.presetId === 'codex') return codexCatalog(source.command)
  if (source.presetId === 'gemini-cli') return geminiCatalog(source.command, online)
  if (source.provider === 'cli') return { models: [], source: 'custom CLI', fetchedAt: Date.now() }
  if (!online) return { models: [], source: 'GET /models', fetchedAt: Date.now(), error: 'online model lists are off in Privacy' }
  // Privacy: an environment key is used only while "Use API keys from environment variables" is on.
  const envKey = privacy.allowEnvKeys && source.env ? (process.env[source.env] ?? null) : null
  const savedKey = source.profile ? (await resolveKey(orca, source.profile)).key : null
  return apiCatalog(source.provider === 'anthropic' ? 'anthropic' : 'openai', source.baseUrl, source.typedKey || savedKey || envKey)
}

/**
 * One Enhance from the panel. It answers within the panel's wait (RUN_LIMITS.budgetMs); when the panel
 * has stopped waiting (closed, cancelled or timed out), the result is dropped and nothing is saved.
 */
export async function enhanceRequest(
  orca: OrcaWorkerApi,
  input: Parameters<typeof enhance>[1] & { runId?: string },
  signal: AbortSignal,
  panelId: string
) {
  const started = Date.now()
  const runId = typeof input.runId === 'string' ? input.runId.slice(0, 64) : ''
  // Progress goes only to the panel that asked, and only when it asked for it.
  const progress = runId
    ? (level: ContextLevel, allowProjectFiles: boolean, readsError: boolean) =>
        createProgress(runId, planSteps(level, allowProjectFiles, readsError), (snapshot) =>
          orca.panels.post('enhance.progress', snapshot, { panel: panelId })
        )
    : undefined
  const result = await enhance(orca, input, signal, progress, RUN_LIMITS.budgetMs)
  // The panel gave up while the model was answering: it shows an error, so keep no trace either.
  if (signal.aborted) throw hostError(msg('error.cancelled'), 'cancelled')
  const model = result.attempts.find((attempt) => attempt.ok)?.model ?? result.profile.model
  await addHistory(orca, result.settings, {
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
}

/** Enhance, Preview context, Send, Copy and the list of terminals to send to. */
function registerRunHandlers(orca: OrcaWorkerApi): void {
  orca.panels.handle('prompt.enhance', async (input, { signal, panel }) => enhanceRequest(orca, input, signal, panel.id))

  orca.panels.handle('context.preview', async ({ prompt, terminalId, level, exclude }, { signal }) => {
    const settings = await readSettings(orca)
    const requested: ContextLevel = isContextLevel(level) ? level : settings.contextLevel
    // Preview reads exactly what a run would: the same Privacy switches apply.
    const allowed = allowedLevel(requested, settings)
    const gathered = await gatherContext(orca, {
      level: allowed,
      prompt,
      terminalId: terminalId ?? null,
      terminalLines: settings.terminalLines,
      exclude: new Set(exclude ?? []),
      extraFiles: settings.extraContextFiles,
      excludePatterns: settings.excludePatterns,
      allowGit: settings.privacy.allowGit,
      allowTerminal: settings.privacy.allowTerminalRead,
      signal
    })
    const notes = [...gathered.notes]
    if (allowed !== requested) notes.push(PROJECT_FILES_OFF)
    if (allowed === 'max') notes.push(msg('note.preview_no_picker'))
    return { context: view(gathered.items), notes, chars: gathered.items.reduce((sum, entry) => sum + entry.chars, 0) }
  })

  orca.panels.handle('prompt.send', async ({ terminalId, text, enter }) => {
    const settings = await readSettings(orca)
    if (!settings.privacy.allowTerminalSend) throw hostError(msg('error.send_off'), 'not_permitted')
    const pieces = terminalChunks(text, settings.sendMode)
    if (pieces.length === 0) throw hostError(msg('error.nothing_to_send'), 'invalid_params')
    const pressEnter = enter ?? settings.sendPressEnter
    // Long prompts go in pieces: Orca accepts at most 4096 characters per call, and keeps writes to
    // one terminal in order.
    const result = await sendPieces(orca, terminalId, pieces)
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
}

/** Model profiles, their live model lists and the subscription CLIs found on this machine. */
function registerModelHandlers(orca: OrcaWorkerApi): void {
  const catalogsInFlight = new Map<string, Promise<Catalog>>()

  orca.panels.handle('models.get', async () => modelsView(orca))

  orca.panels.handle('models.save', async (input) => {
    const config = await editableModels(orca)
    const existing = input.id ? config.profiles.findIndex((profile) => profile.id === input.id) : -1
    const id = existing >= 0 ? config.profiles[existing].id : newProfileId(input.name || input.preset)
    const profile = normalizeProfile({ ...input, id })
    if (!profile) throw hostError(msg('error.invalid_profile'), 'invalid_params')
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

  orca.panels.handle('models.move', async ({ id, direction, to }) => {
    const config = await editableModels(orca)
    const index = config.profiles.findIndex((profile) => profile.id === id)
    const step = direction === 'up' ? -1 : 1
    const target = typeof to === 'number' ? Math.round(to) : index + step
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
    // The hook cannot use a CLI model (too slow for its 2 s), so it is never stored as the hook's.
    const hook = valid(hookProfileId)
    config.hookProfileId = hook && config.profiles.find((profile) => profile.id === hook)?.provider !== 'cli' ? hook : null
    config.selectorProfileId = valid(selectorProfileId)
    await saveModels(orca, config)
    return modelsView(orca)
  })

  orca.panels.handle('models.test', async ({ id }, { signal }) => {
    const config = await loadModels(orca)
    const profile = config.profiles.find((entry) => entry.id === id)
    if (!profile) return { ok: false, message: english(msg('error.unknown_profile')), text: msg('error.unknown_profile'), ms: 0 }
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
      const text = msg('result.test_ok', { name: profile.name, model: attempts[0]?.model || 'default', key: keySource })
      return { ok: true, message: english(text), text, ms: Date.now() - started }
    } catch (error) {
      const text = messageOf(error)
      return { ok: false, message: english(text), text, ms: Date.now() - started }
    }
  })

  orca.panels.handle('models.catalog', async (input) => {
    const preset = presetById(input.preset)
    const config = await loadModels(orca)
    const profile = input.profileId ? config.profiles.find((entry) => entry.id === input.profileId) : undefined
    const provider = profile?.provider ?? (input.provider === 'anthropic' ? 'anthropic' : preset.provider)
    const baseUrl = (input.baseUrl ?? profile?.baseUrl ?? '').trim() || preset.baseUrl
    const command = (input.command ?? profile?.command ?? '').trim()
    // CLIs share one catalog per preset; APIs one per endpoint (keys differ per profile, lists rarely do).
    const cliKey = `catalog:v2:${preset.id}`
    // Claude Code's list is read from its program: a new version (other size or date) is a new list.
    let cacheKey = provider === 'cli' ? cliKey : `catalog:v2:${provider}:${baseUrl}`
    if (preset.id === 'claude-code') cacheKey = `${cliKey}:${await claudeProgramSignature(command)}`
    if (!input.refresh) {
      const cached = parseCatalog(await orca.storage.get(cacheKey))
      if (cached && cached.models.length > 0 && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) {
        return cached
      }
    }
    // Opening the panel asks for every profile's list at once; requests for the same list share one
    // fetch (a Claude Code scan reads its whole program file). A key typed in the form is its own fetch.
    const flightKey = `${cacheKey}${input.apiKey?.trim() ? ':typed' : ''}`
    const running = catalogsInFlight.get(flightKey)
    if (running) return running
    const fetching = (async (): Promise<Catalog> => {
      const catalog = await fetchCatalog(orca, { presetId: preset.id, env: preset.env, provider, baseUrl, command, profile, typedKey: input.apiKey?.trim() })
      if (catalog.models.length > 0) {
        await orca.storage.set(cacheKey, { ...catalog, models: catalog.models.map((model) => ({ ...model })) })
        // Lists of earlier Claude Code versions are never read again.
        if (preset.id === 'claude-code') {
          for (const key of await orca.storage.keys()) {
            if ((key === cliKey || key.startsWith(`${cliKey}:`)) && key !== cacheKey) await orca.storage.delete(key)
          }
        }
      }
      return catalog
    })()
    catalogsInFlight.set(flightKey, fetching)
    try {
      return await fetching
    } finally {
      catalogsInFlight.delete(flightKey)
    }
  })

  orca.panels.handle('models.detect', async () => {
    const config = await loadModels(orca)
    const found = detectClis().map(({ kind, path }) => ({
      preset: kind,
      label: presetById(kind).label,
      path,
      added: config.profiles.some(
        (profile) => profile.preset === kind && (!profile.command || profile.command === path || profile.command === CLI_BINARIES[kind])
      )
    }))
    return { found }
  })
}

/** Privacy section: what is stored, and wiping it. */
function registerDataHandlers(orca: OrcaWorkerApi): void {
  // History edits from the panel go through the same queue as new entries, so none is lost.
  orca.panels.handle('history.remove', async ({ id }) => {
    await withHistory(async () => {
      const list = parseHistory(await orca.storage.get(HISTORY_KEY))
      const next = list.filter((entry) => entry.id !== id)
      if (next.length !== list.length) await orca.storage.set(HISTORY_KEY, next.map(toJson))
    })
    return { ok: true as const }
  })

  orca.panels.handle('history.clear', async () => {
    await withHistory(() => orca.storage.delete(HISTORY_KEY))
    return { ok: true as const }
  })

  orca.panels.handle('data.summary', async () => {
    const keys = await orca.storage.keys()
    const config = await loadModels(orca)
    const history = parseHistory(await orca.storage.get(HISTORY_KEY))
    let secretsStored = 0
    for (const profile of config.profiles) if (await orca.secrets.get(secretName(profile.id)).catch(() => null)) secretsStored++
    return {
      history: history.length,
      profiles: config.fromEnv ? 0 : config.profiles.length,
      keys: secretsStored,
      catalogs: keys.filter((key) => key.startsWith('catalog:')).length
    }
  })

  orca.panels.handle('data.clear', async ({ what }) => {
    const keys = await orca.storage.keys()
    if (what === 'history' || what === 'all') await withHistory(() => orca.storage.delete(HISTORY_KEY))
    if (what === 'catalogs' || what === 'all') {
      for (const key of keys.filter((entry) => entry.startsWith('catalog:'))) await orca.storage.delete(key)
    }
    if (what === 'all') {
      const config = await loadModels(orca)
      for (const profile of config.profiles) await orca.secrets.delete(secretName(profile.id)).catch(() => undefined)
      await orca.storage.delete(MODELS_KEY)
    }
    return { ok: true as const }
  })
}

/** The agent.prompt.before hook, and keeping its project context warm. */
function registerAutoEnhance(orca: OrcaWorkerApi): void {
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
      const items = settings.autoEnhanceContext ? await hookContext(orca, settings.privacy.allowProjectFiles) : []
      const system = buildSystemPrompt({
        style: settings.defaultStyle,
        language: settings.outputLanguage,
        customInstructions: settings.customInstructions,
        agent: settings.adaptToAgent ? event.agent : null
      })
      // CLI models take seconds to start; the hook has under 2 s, so it uses API models only.
      const list = candidates(config.profiles, config.hookProfileId, settings.fallbackEnabled).filter(
        (profile) => profile.enabled && profile.provider !== 'cli'
      )
      if (list.length === 0) {
        // The panel's Auto-enhance section warns about this; the prompt goes through unchanged.
        orca.log('auto-enhance skipped: no enabled API model (subscription CLIs are too slow for the hook)')
        return
      }
      const result = await runChain(
        orca,
        list,
        system,
        buildUserMessage(prompt, items),
        chainOptions(settings, undefined, { totalMs: HOOK_BUDGET_MS - (Date.now() - started) })
      )
      const enhanced = cleanOutput(result.text)
      const model = result.attempts.find((attempt) => attempt.ok)?.model ?? result.profile.model
      void addHistory(orca, settings, {
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
        if (workspace && workspace.hostId === null && settings.privacy.allowProjectFiles) {
          await staticParts(workspace.path, settings.extraContextFiles, true, settings.privacy.allowGit)
        }
      } catch (error) {
        orca.log(`context warm-up: ${(error as Error).message}`)
      }
    }, 1500)
  })
}

/** Commands and the status bar item. */
function registerCommands(orca: OrcaWorkerApi): void {
  orca.commands.register('auto-enhance.cycle', async () => {
    const { autoEnhanceMode } = await readSettings(orca)
    const next = AUTO_MODES[(AUTO_MODES.indexOf(autoEnhanceMode) + 1) % AUTO_MODES.length]
    await orca.settings.set('autoEnhanceMode', next)
    await refreshStatusBar(orca)
    return `Auto-enhance: ${MODE_LABEL[next]}`
  })

  orca.commands.register('auto-enhance.off', async () => setMode(orca, 'off'))
  orca.commands.register('auto-enhance.rules', async () => setMode(orca, 'rules'))
  orca.commands.register('auto-enhance.ai', async () => setMode(orca, 'ai'))

  orca.commands.register('status-bar.toggle', async () => {
    const all = await orca.settings.get()
    const next = all.statusBarItem === 'hidden' ? 'full' : 'hidden'
    await orca.settings.set('statusBarItem', next)
    await refreshStatusBar(orca)
    return next === 'hidden' ? 'Status bar item hidden' : 'Status bar item shown'
  })

  orca.settings.onDidChange(({ key }) => {
    if (key === 'autoEnhanceMode' || key === 'statusBarItem' || key === 'uiLanguage') void refreshStatusBar(orca)
  })
  void refreshStatusBar(orca)
}

export default function activate(orca: OrcaWorkerApi): void {
  registerRunHandlers(orca)
  registerModelHandlers(orca)
  registerDataHandlers(orca)
  registerAutoEnhance(orca)
  registerCommands(orca)
}
