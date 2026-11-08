// The plugin's worker: gathers project context at the chosen level, runs the model chain with
// fallback, sends prompts to agent terminals, keeps history, manages model profiles, and runs the
// optional agent.prompt.before auto-enhance hook.
import type { JsonValue, OrcaWorkerApi } from 'orca/worker'
import { apiCatalog, claudeCatalog, codexCatalog, geminiCatalog, parseCatalog, type Catalog } from './catalog'
import { CLI_BINARIES, detectClis } from './cli'
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
import { isContextLevel, newProfileId, normalizeProfile, presetById, PRESETS, type ContextLevel, type ModelsConfig } from './presets'
import { buildSystemPrompt, buildUserMessage, cleanOutput, formatForTerminal, isStyle, type Style } from './prompts'
import type { ModelsView } from './protocol'
import { parsePrivacy, type Privacy } from './privacy'
import { MODELS_KEY } from './presets'

const AUTO_MODES = ['off', 'rules', 'ai'] as const
type AutoMode = (typeof AUTO_MODES)[number]
/** Orca waits 2 s for a hook; leave room to answer. */
const HOOK_BUDGET_MS = 1700
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
  if ((await orca.settings.get('saveHistory').catch(() => true)) === false) return
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
  input: {
    prompt: string
    style?: string
    terminalId?: string | null
    level?: string
    profileId?: string | null
    model?: string
    language?: string
    exclude?: string[]
  },
  signal?: AbortSignal
) {
  const prompt = input.prompt.trim()
  if (!prompt) throw hostError('Write a prompt first.', 'invalid_params')
  const settings = await readSettings(orca)
  const config = await loadModels(orca)
  const style: Style = isStyle(input.style) ? input.style : settings.defaultStyle
  const requested: ContextLevel = isContextLevel(input.level) ? input.level : settings.contextLevel
  // Privacy: without project files, nothing beyond workspace and agent names.
  const level: ContextLevel = !settings.privacy.allowProjectFiles && atLeast(requested, 'standard') ? 'basic' : requested

  const gathered = await gatherContext(orca, {
    level,
    prompt,
    terminalId: input.terminalId ?? null,
    terminalLines: settings.terminalLines,
    exclude: new Set(input.exclude ?? []),
    extraFiles: settings.extraContextFiles,
    excludePatterns: settings.excludePatterns,
    pickFiles: (tree, task) => pickFilesWithModel(orca, config, settings, tree, task, signal),
    allowGit: settings.privacy.allowGit,
    allowTerminal: settings.privacy.allowTerminalRead
  })
  if (level !== requested) gathered.notes.push('Project files are off in Privacy: workspace and agent only.')
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
    if (!settings.privacy.allowTerminalSend) throw hostError('Sending to terminals is off in Privacy.', 'not_permitted')
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

  orca.panels.handle('models.move', async ({ id, direction, to }) => {
    const config = await editableModels(orca)
    const index = config.profiles.findIndex((profile) => profile.id === id)
    const target = typeof to === 'number' ? Math.round(to) : direction === 'up' ? index - 1 : index + 1
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

  orca.panels.handle('models.catalog', async (input) => {
    const preset = presetById(input.preset)
    const config = await loadModels(orca)
    const profile = input.profileId ? config.profiles.find((entry) => entry.id === input.profileId) : undefined
    const provider = profile?.provider ?? (input.provider === 'anthropic' ? 'anthropic' : preset.provider)
    const baseUrl = (input.baseUrl ?? profile?.baseUrl ?? '').trim() || preset.baseUrl
    const command = (input.command ?? profile?.command ?? '').trim()
    // CLIs share one catalog per preset; APIs one per endpoint (keys differ per profile, lists rarely do).
    const cacheKey = provider === 'cli' ? `catalog:${preset.id}` : `catalog:${provider}:${baseUrl}`
    if (!input.refresh) {
      const cached = parseCatalog(await orca.storage.get(cacheKey))
      if (cached && cached.models.length > 0 && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) {
        return cached
      }
    }
    let catalog: Catalog
    const online = (await readSettings(orca)).privacy.allowOnlineModelLists
    if (preset.id === 'claude-code') catalog = await claudeCatalog(command, online)
    else if (preset.id === 'codex') catalog = await codexCatalog(command)
    else if (preset.id === 'gemini-cli') catalog = await geminiCatalog()
    else if (provider === 'cli') catalog = { models: [], source: 'custom CLI', fetchedAt: Date.now() }
    else {
      const key = input.apiKey?.trim() || (profile ? (await resolveKey(orca, profile)).key : null) || (preset.env ? (process.env[preset.env] ?? null) : null)
      catalog = online
        ? await apiCatalog(provider, baseUrl, key)
        : { models: [], source: 'GET /models', fetchedAt: Date.now(), error: 'online model lists are off in Privacy' }
    }
    if (catalog.models.length > 0) {
      await orca.storage.set(cacheKey, { ...catalog, models: catalog.models.map((model) => ({ ...model })) })
    }
    return catalog
  })

  // Privacy tab: what is stored, and wiping it.
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
    if (what === 'history' || what === 'all') await orca.storage.delete(HISTORY_KEY)
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
      // CLI models take seconds to start; the hook has under 2 s, so it uses API models only.
      const list = candidates(config.profiles, config.hookProfileId, settings.fallbackEnabled).filter(
        (profile) => profile.provider !== 'cli'
      )
      if (list.length === 0) return
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
        if (workspace && workspace.hostId === null && settings.privacy.allowProjectFiles) {
          await staticParts(workspace.path, settings.extraContextFiles, true, settings.privacy.allowGit)
        }
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
