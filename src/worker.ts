// The plugin's worker: gathers project context at the chosen level, runs the model chain with
// fallback, sends prompts to agent terminals, keeps history, manages model profiles, and runs the
// optional agent.prompt.before auto-enhance hook.
import type { JsonValue, OrcaWorkerApi } from 'orca/worker'
import { apiCatalog, claudeCatalog, claudeProgramSignature, codexCatalog, geminiCatalog, parseCatalog, type Catalog } from './catalog.ts'
import { CLI_BINARIES, detectClis } from './cli.ts'
import { copyToClipboard } from './clipboard.ts'
import { forgetActivity, recordSave, recordStatus, recordTool } from './context/activity.ts'
import { isSensitive } from './context/files.ts'
import { resolveLanguage, translate } from './i18n-dict.ts'
import { atLeast, cachedStatic, contextItem, findFocusedWorkspace, focusedCandidates, focusedProject, gatherContext, isLocalWorkspace, projectNameOf, staticParts, type ContextItem } from './context/index.ts'
import { forgetTerminals, learnTerminal, loadTerminals } from './context/terminals.ts'
import { workspaceTitle } from './workspaces.ts'
import { imagesBlock, imageSupport, withImagePaths } from './images.ts'
import { cleanAttachments, clearAttachments, loadFiles, putChunk } from './attachments.ts'
import { attachmentItemId } from './image-limits.ts'
import { parseRulesConfig, RULES_KEY, rulesFor, rulesToJson, structureById, type RulesConfig } from './rules.ts'
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
import { buildSystemPrompt, buildUserMessage, cleanOutput, isStyle, PASTE_END, PASTE_START, terminalChunks, terminalSafe, type Style } from './prompts.ts'
import { PANEL_REQUEST_LIMIT_MS, type ModelsView } from './protocol.ts'
import { CONSENTS_KEY, NEEDS_CONSENT, parseConsents, parseOtherAgentsLimits, parsePrivacy, type OtherAgentsLimits, type Privacy, type PrivacyKey } from './privacy.ts'
import { createProgress, planSteps, type StepReporter } from './progress.ts'
import { MODELS_KEY } from './presets.ts'
import { BRAND, BRAND_SHORT } from './brand.ts'
import { LlmError, messageOf } from './llm.ts'
import { english, msg, raw, withMessage, type Message } from './messages.ts'

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
  /** A desktop notification when a long run finishes. */
  notifyWhenDone: boolean
  /** Read other agents' sessions: how many agents and lines (within OTHER_AGENTS_LIMITS). */
  otherAgentsLimits: OtherAgentsLimits
  uiLanguage: string
  /** The switches as the worker may use them (confirmed where they need it). */
  privacy: Privacy
}

const str = (value: JsonValue | undefined, fallback = '') => (typeof value === 'string' ? value : fallback)
const num = (value: JsonValue | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const bool = (value: JsonValue | undefined, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

export async function readSettings(orca: OrcaWorkerApi): Promise<Settings> {
  const [all, consents] = await Promise.all([orca.settings.get(), orca.storage.get(CONSENTS_KEY).catch(() => null)])
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
    notifyWhenDone: bool(all.notifyWhenDone, false),
    otherAgentsLimits: parseOtherAgentsLimits(all),
    uiLanguage: str(all.uiLanguage, 'auto'),
    privacy: parsePrivacy(all, parseConsents(consents))
  }
}

/**
 * An error for the panel: a code, and the message as a code and parameters, which the panel shows
 * in its own language. Orca passes on an error's code and text only, so the message travels inside
 * the text, after the English sentence (messages.ts); `text` is there for callers in this process.
 */
function hostError(text: Message, code: string): Error {
  return Object.assign(new Error(withMessage(text)), { code, text })
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

/**
 * The Rules tab: the saved rules and structures, and the rules that are followed in the focused
 * project. `hint` is what the panel knows this workspace as (several can share a name).
 */
async function ownRules(orca: OrcaWorkerApi, hint?: string | null): Promise<{ config: RulesConfig; rules: string[] }> {
  const config = parseRulesConfig(await orca.storage.get(RULES_KEY).catch(() => null))
  if (config.rules.length === 0) return { config, rules: [] }
  // Only a rule kept for one project needs to know which project this is.
  const where = config.rules.some((rule) => rule.scope) ? await focusedProject(orca, hint) : { workspace: null, project: null }
  return { config, rules: rulesFor(config, where) }
}

/** Makes sure the prompt names every attached file the rewriter left out. */
function withAttachedPaths(prompt: string, paths: readonly string[]): string {
  const missing = paths.filter((path) => !prompt.includes(path))
  return missing.length === 0 ? prompt : `${prompt.trimEnd()}\n\nAttached files (open them):\n${missing.map((path) => `- ${path}`).join('\n')}`
}

/**
 * The Privacy switches a context gather obeys, the same for a run and for Preview: git, the target
 * terminal, and the other agents' sessions (which are terminal output too, so they need both).
 */
export function gatherPrivacy(settings: Settings): {
  allowGit: boolean
  allowTerminal: boolean
  allowOtherAgents: boolean
  otherAgentsLimits?: OtherAgentsLimits
  allowAgentActivity: boolean
  allowEditorSaves: boolean
} {
  const otherAgents = settings.privacy.allowTerminalRead && settings.privacy.allowOtherAgents
  return {
    allowGit: settings.privacy.allowGit,
    allowTerminal: settings.privacy.allowTerminalRead,
    allowOtherAgents: otherAgents,
    // The amounts matter only while the switch is on (and confirmed).
    ...(otherAgents ? { otherAgentsLimits: settings.otherAgentsLimits } : {}),
    allowAgentActivity: settings.privacy.allowAgentActivity,
    allowEditorSaves: settings.privacy.allowEditorSaves
  }
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
    structureId?: string
    /** Attached files of any kind (the panel's paste, drop and picker), by the path attachments.put answered. */
    files?: string[]
    /** Orca's id of the workspace the panel is in (several can share a name and branch). */
    workspaceId?: string
  },
  signal?: AbortSignal,
  progress?: (level: ContextLevel, allowProjectFiles: boolean, readsOtherAgents: boolean) => StepReporter,
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
  const privacy = gatherPrivacy(settings)
  const step = progress?.(level, settings.privacy.allowProjectFiles, privacy.allowOtherAgents) ?? (() => undefined)

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
    ...privacy,
    onStep: step,
    signal,
    workspaceId: typeof input.workspaceId === 'string' ? input.workspaceId : null
  })
  if (level !== requested) gathered.notes.push(PROJECT_FILES_OFF)
  const agentItem = gathered.items.find((entry) => entry.kind === 'agent')
  const language = input.language && /^[a-z]{2,4}$/.test(input.language) ? input.language : settings.outputLanguage
  const own = await ownRules(orca, typeof input.workspaceId === 'string' ? input.workspaceId : null)
  const system = buildSystemPrompt({
    style,
    language,
    customInstructions: settings.customInstructions,
    agent: settings.adaptToAgent ? (agentItem?.content.split(' ')[0] ?? null) : null,
    rules: own.rules,
    structure: structureById(own.config, input.structureId)
  })
  // Attached files, read before any model is called: images are shown to models that read images,
  // text goes in the context, and the user message lists every file by its path.
  const files = await loadFiles((input.files ?? []).filter((path) => typeof path === 'string' && path.trim())).catch((error: unknown) => {
    if (error instanceof LlmError) throw hostError(error.text, error.code)
    throw error
  })
  const images = files.images
  // An attached text is a context item like the others: unticked in the panel, its text is left out
  // (the file stays listed by its path); a long one is an excerpt, marked as trimmed.
  const excluded = new Set(input.exclude ?? [])
  const attachedTexts = files.texts
    .map((file) => contextItem(attachmentItemId(file.path), 'file', raw(file.name), file.content, file.cut > 0 ? msg('why.trimmed') : undefined))
    .filter((entry) => !excluded.has(entry.id))
  if (attachedTexts.length > 0) gathered.items = [...attachedTexts, ...gathered.items]
  const otherFiles = files.paths.filter((path) => !images.some((image) => image.path === path))
  const user = [buildUserMessage(prompt, gathered.items), imagesBlock(images), otherFiles.length > 0 ? `<attached_files>\n${otherFiles.map((path, index) => `${index + 1}. ${path}`).join('\n')}\n</attached_files>` : '']
    .filter(Boolean)
    .join('\n\n')
  const chosenModel = input.model?.trim().slice(0, 200)
  // The picked model applies to the picked profile only; the rest of the chain keeps its own models.
  const list = candidates(config.profiles, input.profileId ?? null, settings.fallbackEnabled).map((profile) =>
    chosenModel && profile.id === input.profileId ? { ...profile, model: chosenModel } : profile
  )
  /** The model being tried, as the progress card names it. */
  let tried = ''
  try {
    const result = await runChain(
      orca,
      list,
      system,
      user,
      chainOptions(settings, signal, {
        ...(deadline === undefined ? {} : { totalMs: left() }),
        images,
        onAttempt: (profile, model, attempt, total) => {
          tried = `${profile.name} · ${model || 'default'}${attempt > 1 ? ` · ${attempt}/${total}` : ''}`
          step('model', 'running', tried)
        }
      })
    )
    step('model', 'done', `${result.profile.name} · ${result.attempts.find((attempt) => attempt.ok)?.model ?? ''}`)
    // A model that cannot see images still got their paths; say so, and keep every path in the prompt.
    if (images.length > 0 && imageSupport(result.profile) === 'none') gathered.notes.push(msg('note.images_paths_only'))
    return {
      enhanced: withAttachedPaths(withImagePaths(cleanOutput(result.text), images), otherFiles),
      profile: result.profile,
      attempts: result.attempts,
      items: gathered.items,
      notes: gathered.notes,
      settings,
      style
    }
  } catch (error) {
    // The step names the model that was tried. Why it failed is the run's error, which the panel
    // shows in its own language (a step's detail is not translated).
    step('model', 'failed', tried || undefined)
    if (error instanceof ChainError) {
      // Every model that was tried ran out of time: say what makes a run faster.
      const slow = error.attempts.length > 0 && error.attempts.every((attempt) => attempt.errorText?.code === 'error.model_timeout')
      throw hostError(slow ? msg('error.too_slow', { reason: error.text }) : error.text, error.code)
    }
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
  const workspace = await findFocusedWorkspace(orca, focused)
  const label = `${workspaceTitle(focused.displayName, workspace?.project)}${focused.branch ? ` (branch ${focused.branch})` : ''}`
  items.push({ id: 'workspace', kind: 'workspace', label: 'Workspace', content: label, chars: label.length })
  if (!allowProjectFiles) return items
  const cached = workspace && isLocalWorkspace(workspace) ? cachedStatic(workspace.path) : null
  if (cached) items.push(...cached.items.filter((entry) => entry.kind !== 'tree'))
  return items
}

const MODE_LABEL: Record<AutoMode, string> = { off: 'off', rules: 'rules', ai: 'AI' }

/** Orca's default shortcut for the right sidebar (`sidebar.right.toggle`, Mod+L). */
const SIDEBAR_KEY = process.platform === 'darwin' ? '⌘L' : 'Ctrl+L'

/** Status bar wording per panel language ('auto' stays English: the worker cannot see Orca's locale). */
const STATUS_TEXT: Record<string, { prefix: string; modes: Record<AutoMode, string>; tooltip: (mode: string) => string }> = {
  en: {
    prefix: BRAND_SHORT,
    modes: { off: 'off', rules: 'rules', ai: 'AI' },
    tooltip: (mode) =>
      `Click: open the right sidebar (${SIDEBAR_KEY}), then the lightbulb tab "${BRAND}".\nAuto-enhance: ${mode} (change it in the panel's Models tab or the command palette).\nSettings and updates: Settings → Plugins → Enhance Prompt.`
  },
  vi: {
    prefix: BRAND_SHORT,
    modes: { off: 'tắt', rules: 'luật', ai: 'AI' },
    tooltip: (mode) =>
      `Bấm: mở thanh bên phải (${SIDEBAR_KEY}), rồi chọn tab bóng đèn "${BRAND}".\nTự cải thiện: ${mode} (đổi trong tab Model của panel hoặc command palette).\nCài đặt và cập nhật: Settings → Plugins → Enhance Prompt.`
  },
  zh: {
    prefix: BRAND_SHORT,
    modes: { off: '关', rules: '规则', ai: 'AI' },
    tooltip: (mode) => `点击：打开右侧边栏（${SIDEBAR_KEY}），再选灯泡标签 “${BRAND}”。\n自动优化：${mode}（在面板的“模型”标签或命令面板中更改）。\n设置与更新：Settings → Plugins → Enhance Prompt。`
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
/** The latest progress of recent runs, by run id, for callers that cannot hear panel events (the web panel's dev server). */
type ProgressSnapshot = Parameters<Parameters<typeof createProgress>[2]>[0]
const latestProgress = new Map<string, ProgressSnapshot>()
const MAX_TRACKED_RUNS = 20

export function progressOf(runId: string): ProgressSnapshot | null {
  return latestProgress.get(runId) ?? null
}

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
    ? (level: ContextLevel, allowProjectFiles: boolean, readsOtherAgents: boolean) =>
        createProgress(runId, planSteps(level, allowProjectFiles, readsOtherAgents), (snapshot) => {
          latestProgress.delete(runId)
          latestProgress.set(runId, snapshot)
          for (const old of [...latestProgress.keys()].slice(0, Math.max(0, latestProgress.size - MAX_TRACKED_RUNS))) latestProgress.delete(old)
          orca.panels.post('enhance.progress', snapshot, { panel: panelId })
        })
    : undefined
  const result = await enhance(orca, input, signal, progress, RUN_LIMITS.budgetMs)
  // The panel gave up while the model was answering: it shows an error, so keep no trace either.
  if (signal.aborted) throw hostError(msg('error.cancelled'), 'cancelled')
  const model = result.attempts.find((attempt) => attempt.ok)?.model ?? result.profile.model
  void notifyDone(orca, result.settings, model, Date.now() - started)
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
  orca.panels.handle('enhance.progress.get', async ({ runId }) => progressOf(runId))

  orca.panels.handle('context.preview', async ({ prompt, terminalId, level, exclude, workspaceId }, { signal }) => {
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
      ...gatherPrivacy(settings),
      signal,
      workspaceId: workspaceId ?? null
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

  // The web panel's pasted, dropped or picked files arrive in chunks (no path on disk in a frame).
  void cleanAttachments()
  orca.panels.handle('attachments.put', async (input) => {
    // A new file: the ones kept for more than a day go now (this worker may have started days ago).
    if (input.index === 0) void cleanAttachments()
    try {
      return await putChunk(input)
    } catch (error) {
      if (error instanceof LlmError) throw hostError(error.text, error.code)
      throw error
    }
  })

  orca.panels.handle('targets.list', async (input) => {
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
    // Which workspace this is: several can share a name and branch. Orca said which workspace each
    // agent's terminal is in (the worker keeps that, see terminals.ts); the panel adds what it noted
    // itself and the folder the person picked.
    const raw = (input ?? {}) as { known?: unknown }
    const known: Record<string, unknown> = raw.known && typeof raw.known === 'object' ? (raw.known as Record<string, unknown>) : {}
    const hints = [...new Set(targets.map((target) => known[target.terminalId]).filter((id): id is string => typeof id === 'string' && id.length > 0))]
    const workspace = context ? await findFocusedWorkspace(orca, context, hints) : null
    const choices = context && !workspace ? await focusedCandidates(orca, context) : []
    return {
      targets,
      workspace: context?.displayName ?? null,
      // The name this project's rules are kept under; null while Orca cannot tell which project it is.
      project: context ? await projectNameOf(orca, context, workspace) : null,
      workspaceId: workspace?.id ?? null,
      // Its folder, so the panel can tell which project Orca removed (that event names it another way).
      ...(workspace ? { workspacePath: workspace.path } : {}),
      ...(choices.length > 0 ? { choices } : {})
    }
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
    const cliKey = `catalog:v3:${preset.id}`
    // Claude Code's list is read from its program: a new version (other size or date) is a new list.
    let cacheKey = provider === 'cli' ? cliKey : `catalog:v3:${provider}:${baseUrl}`
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

/** Privacy section: what is stored, and wiping it. Also the Rules tab's rules and structures. */
function registerDataHandlers(orca: OrcaWorkerApi): void {
  // Saves land in the order they were asked for; the panel sends the whole list each time.
  let rulesQueue: Promise<unknown> = Promise.resolve()
  orca.panels.handle('rules.get', async () => parseRulesConfig(await orca.storage.get(RULES_KEY)))
  orca.panels.handle('rules.save', async ({ config }) => {
    const clean = parseRulesConfig(rulesToJson(config))
    const write = rulesQueue.then(() => orca.storage.set(RULES_KEY, rulesToJson(clean)))
    rulesQueue = write.catch(() => undefined)
    await write
    return clean
  })

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
      await orca.storage.delete(RULES_KEY)
      // Confirmations go too: a switch that needs one asks again; what Orca reported is forgotten.
      await orca.storage.delete(CONSENTS_KEY)
      forgetActivity()
      await forgetTerminals(orca)
      // The copies of attached files (the panel forgets its list of them as well).
      await clearAttachments().catch((error) => orca.log(`attachments: ${(error as Error).message}`))
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
      const own = await ownRules(orca)
      const system = buildSystemPrompt({
        style: settings.defaultStyle,
        language: settings.outputLanguage,
        customInstructions: settings.customInstructions,
        agent: settings.adaptToAgent ? event.agent : null,
        rules: own.rules
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
      // Orca types the rewrite into the agent's terminal: no control characters from a model, and
      // never nothing in place of the prompt that was going out.
      const enhanced = terminalSafe(cleanOutput(result.text)).trim()
      if (!enhanced) {
        orca.log('auto-enhance skipped: the model returned no prompt')
        return
      }
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
        if (workspace && isLocalWorkspace(workspace) && settings.privacy.allowProjectFiles) {
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

// ---- Orca integrations: what agents do, files saved in the editor, new agents, opening files

/**
 * The switches as the worker may use them now, for the hooks and events that fire often (they must
 * not read settings each time). Refreshed when a setting or a confirmation changes.
 */
let live: Privacy = parsePrivacy({}, {})

async function refreshLive(orca: OrcaWorkerApi): Promise<void> {
  const before = live
  live = (await readSettings(orca).catch(() => null))?.privacy ?? live
  // A switch turned off forgets what it had kept.
  if (before.allowAgentActivity && !live.allowAgentActivity) forgetActivity('agents')
  if (before.allowEditorSaves && !live.allowEditorSaves) forgetActivity('saves')
}

/** A relative path inside a workspace, or null (absolute, parent folders, a secret file). */
function workspacePath(path: unknown): string | null {
  if (typeof path !== 'string') return null
  const clean = path.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!clean || clean.length > 500 || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.split('/').includes('..') || isSensitive(clean)) return null
  return clean
}

/** Orca's id of the focused workspace: the panel's, when it knows it, else matched by name and branch. */
async function focusedWorkspaceId(orca: OrcaWorkerApi, hint: unknown): Promise<string | null> {
  const focused = await orca.host.call('workspace.readContext', {}).catch(() => null)
  if (!focused) return null
  return (await findFocusedWorkspace(orca, focused, typeof hint === 'string' ? hint : null))?.id ?? null
}

/** The agent kinds a new agent can be started with: ids as Orca names them (letters, digits, - _). */
const AGENT_KIND = /^[a-z][a-z0-9_-]{0,31}$/

function registerIntegrations(orca: OrcaWorkerApi): void {
  void refreshLive(orca)
  orca.settings.onDidChange(() => void refreshLive(orca))
  orca.storage.onDidChange(({ key }) => {
    if (key === CONSENTS_KEY) void refreshLive(orca)
  })

  // Observe only: Orca does not wait for agent.tool.after; editor.save.before passes at once.
  // Both say which workspace the agent's terminal is in. That pairing of two ids is always kept: it
  // is how the focused workspace is told from others of its name. What the agent did is kept only
  // while its Privacy switch is on.
  void loadTerminals(orca)
  orca.hooks.on('agent.tool.after', (event) => {
    learnTerminal(orca, event.terminalId, event.workspaceId)
    if (live.allowAgentActivity) recordTool(event)
  })
  orca.events.on('agent.status.changed', (event) => {
    learnTerminal(orca, event.terminalId, event.workspaceId)
    if (live.allowAgentActivity) recordStatus(event)
  })
  orca.hooks.on('editor.save.before', (event) => {
    if (live.allowEditorSaves) recordSave(event)
  })

  /** Which confirmations were given, and which switches need one. */
  orca.panels.handle('consents.get', async () => {
    const consents = parseConsents(await orca.storage.get(CONSENTS_KEY).catch(() => null))
    return { granted: [...NEEDS_CONSENT].filter((key) => consents[key] === true), needed: [...NEEDS_CONSENT] }
  })

  /** The person confirmed (or withdrew) a switch after reading what it allows, in the panel. */
  orca.panels.handle('consent.set', async ({ key, granted }) => {
    if (!NEEDS_CONSENT.has(key as PrivacyKey)) throw hostError(msg('error.invalid_request'), 'invalid_params')
    const consents = parseConsents(await orca.storage.get(CONSENTS_KEY).catch(() => null))
    if (granted) consents[key as PrivacyKey] = true
    else delete consents[key as PrivacyKey]
    await orca.storage.set(CONSENTS_KEY, consents as JsonValue)
    await refreshLive(orca)
    return { granted: [...NEEDS_CONSENT].filter((entry) => consents[entry] === true) }
  })

  /** Starts a new agent in the focused workspace with the enhanced prompt (Privacy, confirmed). */
  orca.panels.handle('agent.launch', async ({ agent, prompt, workspaceId }) => {
    const settings = await readSettings(orca)
    if (!settings.privacy.allowAgentLaunch) throw hostError(msg('error.launch_off'), 'not_permitted')
    if (!orca.host.has('agent.launch')) throw hostError(msg('error.unsupported'), 'unavailable')
    if (typeof agent !== 'string' || !AGENT_KIND.test(agent)) throw hostError(msg('error.invalid_request'), 'invalid_params')
    const text = terminalSafe(String(prompt ?? '')).trim().slice(0, 20_000)
    if (!text) throw hostError(msg('error.nothing_to_send'), 'invalid_params')
    const id = await focusedWorkspaceId(orca, workspaceId)
    if (!id) throw hostError(msg('note.no_workspace'), 'invalid_params')
    return orca.host.call('agent.launch', { workspaceId: id, agent, prompt: text })
  })

  /** Opens a file of the focused workspace in Orca's editor (a context item the person clicked). */
  orca.panels.handle('editor.open', async ({ path, workspaceId }) => {
    const settings = await readSettings(orca)
    if (!settings.privacy.allowOpenFiles) throw hostError(msg('error.open_off'), 'not_permitted')
    if (!orca.host.has('editor.open')) throw hostError(msg('error.unsupported'), 'unavailable')
    const clean = workspacePath(path)
    if (!clean) throw hostError(msg('error.invalid_request'), 'invalid_params')
    const id = await focusedWorkspaceId(orca, workspaceId)
    if (!id) throw hostError(msg('note.no_workspace'), 'invalid_params')
    return orca.host.call('editor.open', { workspaceId: id, path: clean })
  })
}

/** After a long panel run: a desktop notification that names the model and time, never the prompt. */
async function notifyDone(orca: OrcaWorkerApi, settings: Settings, model: string, ms: number): Promise<void> {
  if (!settings.notifyWhenDone || ms < NOTIFY_AFTER_MS || !orca.host.has('notifications.show')) return
  const lang = resolveLanguage(settings.uiLanguage, 'en')
  const body = translate(lang, 'Enhanced prompt ready ({model}, {seconds} s)', { model, seconds: (ms / 1000).toFixed(0) })
  await orca.host.call('notifications.show', { title: BRAND, body }).catch(() => undefined)
}
/** Shorter runs end while the person is still looking at the panel. */
const NOTIFY_AFTER_MS = 8000

export default function activate(orca: OrcaWorkerApi): void {
  registerIntegrations(orca)
  registerRunHandlers(orca)
  registerModelHandlers(orca)
  registerDataHandlers(orca)
  registerAutoEnhance(orca)
  registerCommands(orca)
}
