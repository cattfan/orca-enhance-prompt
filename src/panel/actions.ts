// actions.ts: what the panel does (what its buttons call): requests to the worker, and the changes
// to the state (state.ts) that follow. No UI here; the web panel (web/src) and the tests call these.
import { plugin, read, set, settings, shell, update, type JsonValue } from 'orca'
import { MAX_RULE_CHARS, MAX_RULES, MAX_SECTIONS, MAX_STRUCTURES, newId, type RulesConfig } from '../rules.ts'
import { ISSUES_URL } from './view.ts'
import { type HistoryEntry } from '../history.ts'
import { type Message } from '../messages.ts'
import { isContextLevel, presetById, type ContextItemView, type ProfileView } from '../presets.ts'
import { isStyle } from '../prompts.ts'
import { t, uiLanguageSetting } from '../i18n.ts'
import { NEEDS_CONSENT, parseOtherAgentsLimits, parsePrivacy } from '../privacy.ts'
import { stepPercent, totalPercent, type Step } from '../progress.ts'
import { MAX_IMAGES } from '../image-limits.ts'
import { PANEL_REQUEST_LIMIT_MS, type ProfileInput } from '../protocol.ts'
import { consents, files, ruleDraft, ruleScope, structureDraft, type Form, terminalWorkspaces, workspaceChoices, images, imageDraft, tick, workspaceKey, parked, MAX_PARKED, type Slot, rulesState, structureChoice, workspaceName, errorTerminal, tab, draft, result, style, profileChoice, modelChoice, outputChoice, excluded, target, historyRaw, confirmClearHistory, form, detected, catalogs, catalogLoading, customModel, type Run, run, dataSummary, privacy, confirmWipe, busy, notice, lastRun, contextShown, contextNotes, KEPT, mayKeep, put, forgetSaved, targets, models, defaults, effectiveStyle, effectiveLevel, effectiveEnter, say, message } from './state.ts'

let inFlight: AbortController | null = null
/** The project of the run in flight; filled in if the panel learns its key only after the run started. */
let runOrigin: { key: string | null; name: string | null } | null = null
/** Projects Orca has removed: an answer for one of them is dropped, never shown elsewhere. */
const removedWorkspaces = new Set<string>()

// ---------------------------------------------------------------- projects

/** The composer as it is now, to park under its project. */
function snapshot(): Slot {
  return {
    name: read(workspaceName),
    draft: read(draft),
    result: read(result),
    lastRun: read(lastRun),
    contextShown: read(contextShown),
    contextNotes: read(contextNotes),
    excluded: read(excluded),
    images: read(images),
    files: read(files),
    at: Date.now()
  }
}

const isEmpty = (slot: Slot) => !slot.draft.trim() && !slot.result.trim() && slot.contextShown.length === 0 && (slot.images ?? []).length === 0 && (slot.files ?? []).length === 0

/** Keeps a project's composer, newest first, at most MAX_PARKED projects. */
function park(key: string, slot: Slot): void {
  const next = { ...read(parked) }
  delete next[key]
  if (!isEmpty(slot)) next[key] = slot
  const keys = Object.keys(next).sort((a, b) => next[b].at - next[a].at)
  for (const old of keys.slice(MAX_PARKED)) delete next[old]
  put(parked, next)
}

/**
 * The focused project changed: what the composer holds goes back to the project it was written in, and
 * the new project's own draft and result (or an empty composer) come in. A prompt is never shown, and
 * so never sent, in a project other than its own.
 */
function switchWorkspace(key: string, name: string | null): void {
  const old = read(workspaceKey)
  if (old === key) {
    set(workspaceName, name)
    return
  }
  if (old === null) {
    // First answer since the panel opened: the composer already belongs to this project.
    put(workspaceKey, key)
    set(workspaceName, name)
    if (runOrigin && runOrigin.key === null) runOrigin.key = key
    return
  }
  park(old, snapshot())
  const incoming = read(parked)[key]
  put(draft, incoming?.draft ?? '')
  put(result, incoming?.result ?? '')
  put(lastRun, incoming?.lastRun ?? null)
  put(contextShown, incoming?.contextShown ?? [])
  put(contextNotes, incoming?.contextNotes ?? [])
  set(excluded, incoming?.excluded ?? [])
  put(images, incoming?.images ?? [])
  put(files, incoming?.files ?? [])
  if (incoming) park(key, { ...incoming, draft: '', result: '', contextShown: [], images: [], files: [] })
  put(workspaceKey, key)
  set(workspaceName, name)
  set(notice, null)
}

/** Remembers the workspace of these terminals (newest 300). */
export function learnTerminals(terminalIds: string[], workspaceId: string): void {
  const known = read(terminalWorkspaces)
  if (terminalIds.every((id) => known[id] === workspaceId)) return
  const next = { ...known }
  for (const id of terminalIds) {
    delete next[id]
    next[id] = workspaceId
  }
  const ids = Object.keys(next)
  for (const id of ids.slice(0, Math.max(0, ids.length - 300))) delete next[id]
  set(terminalWorkspaces, next)
}

/** The person says which folder the focused workspace is: its terminals are remembered as being there. */
export async function pickWorkspace(workspaceId: string): Promise<void> {
  learnTerminals(read(targets).map((item) => item.terminalId), workspaceId)
  set(workspaceChoices, [])
  await refreshTargets()
}

/** Orca's id of the workspace the composer belongs to, when it is known (not just its name). */
export function knownWorkspaceId(): Record<string, string> {
  const key = read(workspaceKey)
  return key && !key.startsWith('name:') ? { workspaceId: key } : {}
}

/** Orca removed a project: forget what was parked for it. */
export function workspaceRemoved(workspaceId: string): void {
  removedWorkspaces.add(workspaceId)
  if (read(parked)[workspaceId]) {
    const next = { ...read(parked) }
    delete next[workspaceId]
    put(parked, next)
  }
}

// ---------------------------------------------------------------- data

export async function refreshDefaults(): Promise<void> {
  const all = await settings.get().catch(() => ({}) as Record<string, JsonValue>)
  set(defaults, {
    style: typeof all.defaultStyle === 'string' && isStyle(all.defaultStyle) ? all.defaultStyle : 'balanced',
    level: typeof all.contextLevel === 'string' && isContextLevel(all.contextLevel) ? all.contextLevel : 'standard',
    pressEnter: all.sendPressEnter === true,
    fallbackEnabled: all.fallbackEnabled !== false,
    fallbackOn: all.fallbackOn === 'transient' ? 'transient' : 'any',
    outputLanguage: typeof all.outputLanguage === 'string' ? all.outputLanguage : 'auto',
    autoEnhanceMode: typeof all.autoEnhanceMode === 'string' ? all.autoEnhanceMode : 'off',
    notifyWhenDone: all.notifyWhenDone === true,
    otherAgents: parseOtherAgentsLimits(all)
  })
  set(uiLanguageSetting, typeof all.uiLanguage === 'string' ? all.uiLanguage : 'auto')
  set(privacy, parsePrivacy(all))
  // Saving history is off: nothing typed or produced stays on disk after the panel closes.
  if (!mayKeep()) forgetSaved()
}

export async function changeUiLanguage(value: string): Promise<void> {
  set(uiLanguageSetting, value)
  await settings.set('uiLanguage', value).catch(() => undefined)
}

export async function refreshModels(): Promise<void> {
  try {
    const view = await plugin.request('models.get')
    set(models, view)
    // Lists come from cache (a day) or the CLI/API; cards use them for quick model switching.
    for (const profile of view.profiles) {
      if (!read(catalogs)[profile.id]) void loadCatalog(profile.id, { preset: profile.preset, profileId: profile.id })
    }
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

export async function loadCatalog(
  key: string,
  input: { preset: string; profileId?: string; baseUrl?: string; provider?: string; command?: string; apiKey?: string },
  refresh = false
): Promise<void> {
  update(catalogLoading, (map) => ({ ...map, [key]: true }))
  try {
    const clean = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ''))
    const catalog = await plugin.request('models.catalog', { preset: input.preset, ...clean, refresh }, { timeoutMs: 40_000 })
    update(catalogs, (map) => ({ ...map, [key]: catalog }))
  } catch (error) {
    update(catalogs, (map) => ({ ...map, [key]: { models: [], source: '', fetchedAt: Date.now(), error: message(error) } }))
  } finally {
    update(catalogLoading, (map) => ({ ...map, [key]: false }))
  }
}

export function formCatalogInput(current: Form) {
  return {
    preset: current.preset,
    ...(current.id ? { profileId: current.id } : {}),
    baseUrl: current.baseUrl,
    provider: current.provider,
    command: current.command ?? '',
    apiKey: current.apiKey
  }
}

export async function refreshTargets(): Promise<void> {
  try {
    const { targets: list, workspace, workspaceId, choices } = await plugin.request('targets.list', { known: read(terminalWorkspaces) })
    set(workspaceChoices, choices ?? [])
    // Once known, the workspace of these terminals stays known (the next lookup needs no guess).
    if (workspaceId) learnTerminals(list.map((item) => item.terminalId), workspaceId)
    // Before the terminals: the composer must follow the project first, so that a target of the new
    // project is never shown next to a prompt of the old one.
    switchWorkspace(workspaceId ?? (workspace ? `name:${workspace}` : ''), workspace ?? null)
    set(targets, list)
    const current = read(target)
    // The error usually sits in a terminal that is not the agent's (build, tests, dev server).
    const errorFrom = read(errorTerminal)
    if (!errorFrom || !list.some((item) => item.terminalId === errorFrom)) {
      set(errorTerminal, list.find((item) => !item.agent)?.terminalId ?? list[0]?.terminalId ?? null)
    }
    if (!current || !list.some((item) => item.terminalId === current)) {
      set(target, list.find((item) => item.agent)?.terminalId ?? list[0]?.terminalId ?? null)
    }
  } catch {
    set(targets, [])
  }
}

export function showContext(items: ContextItemView[], notes: (Message | string)[]): void {
  const ex = new Set(read(excluded))
  const keptExcluded = read(contextShown).filter((item) => ex.has(item.id) && !items.some((i) => i.id === item.id))
  put(contextShown, [...items, ...keptExcluded])
  put(contextNotes, notes)
}

// ---------------------------------------------------------------- actions

export async function enhanceNow(fix?: { terminalId: string; prompt: string }): Promise<void> {
  const prompt = read(draft).trim() || fix?.prompt || ''
  if (!prompt || read(busy)) return
  const controller = new AbortController()
  inFlight = controller
  const origin = { key: read(workspaceKey), name: read(workspaceName) }
  runOrigin = origin
  const runId = beginRun(`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, origin)
  set(busy, 'enhance')
  set(notice, null)
  try {
    const choice = read(profileChoice)
    const answer = await plugin.request(
      'prompt.enhance',
      {
        prompt,
        runId,
        // Fixing an error is a bug-fix brief whatever the composer's style.
        style: fix ? 'bugfix' : read(effectiveStyle),
        ...(fix ? { errorTerminalId: fix.terminalId } : {}),
        ...(read(structureChoice) ? { structureId: read(structureChoice) } : {}),
        ...(read(images).length > 0 ? { images: read(images).map((image) => image.path) } : {}),
        ...(read(files).length > 0 ? { files: read(files).map((file) => file.path) } : {}),
        ...knownWorkspaceId(),
        level: read(effectiveLevel),
        terminalId: read(target),
        profileId: choice === 'auto' ? null : choice,
        ...(choice !== 'auto' && read(modelChoice) ? { model: read(modelChoice) } : {}),
        // Leave the key out (not undefined): request inputs must be plain JSON.
        ...(read(outputChoice) === 'default' ? {} : { language: read(outputChoice) }),
        exclude: read(excluded)
      },
      { timeoutMs: PANEL_REQUEST_LIMIT_MS, signal: controller.signal }
    )
    const ran = { model: answer.model, profileName: answer.profileName, ms: answer.ms, attempts: answer.attempts }
    if (origin.key === read(workspaceKey)) {
      put(result, answer.enhanced)
      put(lastRun, ran)
      showContext(answer.context, answer.notes)
    } else if (origin.key !== null && !removedWorkspaces.has(origin.key)) {
      // The person moved to another project meanwhile: the prompt waits in its own project.
      const slot = read(parked)[origin.key]
      park(origin.key, { ...(slot ?? snapshotFor(origin.name)), result: answer.enhanced, lastRun: ran, contextShown: answer.context, contextNotes: answer.notes, at: Date.now() })
      set(notice, { tone: 'neutral', text: t('The enhanced prompt is kept for {name}: go back to that project to send it.', { name: origin.name ?? '?' }) })
    } else {
      // Its project is gone (or unknown): showing it here could send it to the wrong agent.
      set(notice, { tone: 'warning', text: t('The project this prompt was written for is closed, so its enhanced prompt was dropped.') })
    }
    finishRun(runId, 'done')
  } catch (error) {
    if (controller.signal.aborted) finishRun(runId, 'cancelled')
    else finishRun(runId, 'error', message(error))
  } finally {
    if (inFlight === controller) inFlight = null
    if (runOrigin === origin) runOrigin = null
    set(busy, null)
  }
}

/** An empty composer of a project that has nothing parked. */
function snapshotFor(name: string | null): Slot {
  return { name, draft: '', result: '', lastRun: null, contextShown: [], contextNotes: [], excluded: [], at: Date.now() }
}

/** Starts a fresh run; progress from an older run is ignored by its id. Exported for tests. */
export function beginRun(runId: string, workspace?: { key: string | null; name: string | null }): string {
  const now = Date.now()
  // The card's clock only moves while a run goes: start it with the run, or the time since the last
  // run would show as a negative duration until the first tick.
  set(tick, now)
  set(run, { runId, startedAt: now, steps: [], status: 'running', ...(workspace ? { workspace } : {}) })
  startTicking()
  return runId
}

let ticker: ReturnType<typeof setInterval> | null = null
/** Moves the run card's clock while a run goes, so time-estimated shares grow; stops on its own. */
function startTicking(): void {
  if (ticker) return
  ticker = setInterval(() => {
    if (read(run)?.status !== 'running') stopTicking()
    else set(tick, Date.now())
  }, 500)
}
export function stopTicking(): void {
  if (ticker) clearInterval(ticker)
  ticker = null
}

/** Takes a worker snapshot when it belongs to the running run. Exported for tests. */
export function applyProgress(snapshot: { runId: string; startedAt: number; steps: { key: string; status: Step['status']; detail?: string; fraction?: number; startedAt?: number }[] }): void {
  const current = read(run)
  if (current && current.runId === snapshot.runId && current.status === 'running') {
    set(run, { ...current, startedAt: snapshot.startedAt, steps: snapshot.steps.map((entry) => ({ ...entry, key: entry.key as Step['key'] })) })
  }
}

/** What a step still running becomes when the run ends this way. */
export const OPEN_STEP_ENDS: Record<Run['status'], Step['status']> = { running: 'running', done: 'done', error: 'failed', cancelled: 'skipped' }

/** Ends a run: a step still running is done, failed or (when cancelled) skipped. */
export function finishRun(runId: string, status: Run['status'], error?: string): void {
  const current = read(run)
  if (!current || current.runId !== runId || current.status !== 'running') return
  const now = Date.now()
  // A step still running keeps the share it had reached (its estimate included), so the card shows
  // where the run stopped; the bar keeps the run's share at that moment and never jumps to 100.
  const steps: Step[] = current.steps.map((entry) => {
    if (entry.status !== 'running') return entry
    const reached = (stepPercent(entry, now) ?? 0) / 100
    return { ...entry, status: OPEN_STEP_ENDS[status], ...(status === 'done' ? {} : { fraction: reached }) }
  })
  const endPercent = status === 'done' ? 100 : totalPercent(current.steps, now)
  set(run, { ...current, steps, status, finishedAt: now, endPercent, ...(error ? { error } : {}) })
  set(tick, now)
  stopTicking()
}

/** Attaches an image by its path: the worker checks it (absolute path, PNG/JPEG/GIF/WebP, 5 MB). */
export async function addImage(): Promise<void> {
  const path = read(imageDraft).trim()
  if (!path) return
  if (read(images).length >= MAX_IMAGES) {
    set(notice, { tone: 'warning', text: t('At most {max} images per prompt.', { max: MAX_IMAGES }) })
    return
  }
  try {
    const image = await plugin.request('images.inspect', { path })
    if (!read(images).some((entry) => entry.path === image.path)) put(images, [...read(images), image])
    set(imageDraft, '')
    set(notice, null)
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

export function removeFile(path: string): void {
  put(files, read(files).filter((file) => file.path !== path))
}

export function removeImage(path: string): void {
  put(images, read(images).filter((image) => image.path !== path))
}

/** "Fix this error": a bug-fix prompt about the latest error in the chosen terminal, for the target agent. */
export async function fixError(): Promise<void> {
  const terminalId = read(errorTerminal)
  if (!terminalId) return
  const name = read(targets).find((item) => item.terminalId === terminalId)?.label ?? terminalId
  await enhanceNow({ terminalId, prompt: t('Fix the error shown in the output of {name}: find the root cause, fix it, and verify the fix.', { name }) })
}

export async function previewContext(): Promise<void> {
  set(busy, 'preview')
  try {
    const answer = await plugin.request(
      'context.preview',
      { prompt: read(draft), level: read(effectiveLevel), terminalId: read(target), exclude: read(excluded), ...knownWorkspaceId() },
      { timeoutMs: 60_000 }
    )
    showContext(answer.context, answer.notes)
    set(notice, null)
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  } finally {
    set(busy, null)
  }
}

export function cancel(): void {
  // The request's signal stops the worker; enhanceNow then records the run as cancelled.
  inFlight?.abort()
}

export function toggleItem(id: string, include: boolean): void {
  update(excluded, (list) => (include ? list.filter((entry) => entry !== id) : [...new Set([...list, id])]))
}

export async function send(text: string): Promise<void> {
  const terminalId = read(target)
  if (!terminalId || !text.trim()) return
  set(busy, 'send')
  try {
    const { accepted } = await plugin.request('prompt.send', { terminalId, text, enter: read(effectiveEnter) })
    const label = read(targets).find((item) => item.terminalId === terminalId)?.label ?? 'terminal'
    set(notice, accepted ? { tone: 'success', text: t('Sent to {label}.', { label }) } : { tone: 'warning', text: t('{label} did not accept the text.', { label }) })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  } finally {
    set(busy, null)
  }
}

export async function copy(text: string): Promise<void> {
  if (!text.trim()) return
  const answer = await plugin.request('prompt.copy', { text }).catch((error) => ({ copied: false, error: message(error) }))
  set(notice, answer.copied ? { tone: 'success', text: t('Copied to clipboard.') } : { tone: 'danger', text: t('Copy failed: {error}', { error: answer.error ?? 'unknown error' }) })
}

export function reuse(entry: HistoryEntry): void {
  put(draft, entry.original)
  put(result, entry.enhanced)
  if (isStyle(entry.style)) set(style, entry.style)
  set(tab, 'enhance')
}

/** History changes go through the worker, in order with the entries it is saving. */
export async function removeEntry(id: string): Promise<void> {
  try {
    await plugin.request('history.remove', { id })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

export async function clearHistory(): Promise<void> {
  set(confirmClearHistory, false)
  try {
    await plugin.request('history.clear')
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

export async function setSetting(key: string, value: JsonValue): Promise<void> {
  try {
    await settings.set(key, value)
    await refreshDefaults()
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

// ---- model profiles

export function openForm(profile?: ProfileView): void {
  set(customModel, false)
  if (profile) {
    set(form, {
      id: profile.id,
      name: profile.name,
      preset: profile.preset,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      temperature: profile.temperature,
      maxTokens: profile.maxTokens,
      enabled: profile.enabled,
      command: profile.command,
      args: profile.args,
      apiKey: ''
    })
  } else {
    const preset = presetById('openai')
    set(form, { name: preset.label, preset: preset.id, provider: preset.provider, baseUrl: preset.baseUrl, model: preset.model, temperature: 0.3, maxTokens: 2000, enabled: true, command: '', args: '', apiKey: '' })
  }
  const current = read(form)
  if (current) void loadCatalog('form', formCatalogInput(current))
}

export async function detectClis(): Promise<void> {
  try {
    const { found } = await plugin.request('models.detect')
    set(detected, found)
  } catch {
    set(detected, [])
  }
}

/** One click: adds a detected subscription CLI as a model with its defaults. */
export async function addDetected(presetId: string, path: string): Promise<void> {
  const preset = presetById(presetId)
  try {
    set(
      models,
      await plugin.request('models.save', {
        name: preset.label.replace(/ \(.*\)$/, ''),
        preset: preset.id,
        provider: preset.provider,
        baseUrl: '',
        model: preset.model,
        temperature: 0.3,
        maxTokens: 2000,
        enabled: true,
        command: path,
        args: ''
      })
    )
    await detectClis()
    set(notice, { tone: 'success', text: t('Added {name}. Use Test to check it is signed in.', { name: preset.label }) })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

export function applyPreset(id: string): void {
  const preset = presetById(id)
  update(form, (current) => {
    if (!current) return current
    const name = current.id ? current.name : preset.label
    return { ...current, preset: preset.id, provider: preset.provider, baseUrl: preset.baseUrl, model: preset.model, command: '', args: '', name }
  })
  const current = read(form)
  if (current) void loadCatalog('form', formCatalogInput(current))
}

export const patchForm = (patch: Partial<Form>) => update(form, (current) => (current ? { ...current, ...patch } : current))

export async function saveForm(): Promise<void> {
  const current = read(form)
  if (!current) return
  set(busy, 'save')
  try {
    const { apiKey, ...rest } = current
    // Editing: an empty key field keeps the saved key.
    const input: ProfileInput = { ...rest, ...(apiKey.trim() || !current.id ? { apiKey: apiKey.trim() } : {}) }
    set(models, await plugin.request('models.save', input))
    set(form, null)
    set(notice, { tone: 'success', text: t('Saved {name}.', { name: current.name }) })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  } finally {
    set(busy, null)
  }
}

export async function modelAction(action: { remove: string } | { move: string; to: number }): Promise<void> {
  try {
    const next =
      'remove' in action
        ? await plugin.request('models.delete', { id: action.remove })
        : await plugin.request('models.move', { id: action.move, to: action.to })
    set(models, next)
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

export async function toggleProfile(profile: ProfileView, enabled: boolean): Promise<void> {
  try {
    set(models, await plugin.request('models.save', { ...profile, enabled }))
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

export async function testProfile(id: string): Promise<void> {
  set(busy, 'test')
  try {
    const answer = await plugin.request('models.test', { id }, { timeoutMs: 40_000 })
    set(notice, { tone: answer.ok ? 'success' : 'danger', text: answer.ok ? `${say(answer.text ?? answer.message)} (${answer.ms} ms)` : say(answer.text ?? answer.message) })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  } finally {
    set(busy, null)
  }
}

export async function setRoles(patch: { hookProfileId?: string | null; selectorProfileId?: string | null }): Promise<void> {
  const current = read(models)
  try {
    set(
      models,
      await plugin.request('models.roles', {
        hookProfileId: patch.hookProfileId !== undefined ? patch.hookProfileId : (current?.hookProfileId ?? null),
        selectorProfileId: patch.selectorProfileId !== undefined ? patch.selectorProfileId : (current?.selectorProfileId ?? null)
      })
    )
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

export async function switchModel(profile: ProfileView, model: string): Promise<void> {
  try {
    set(models, await plugin.request('models.save', { ...profile, model }))
    set(notice, { tone: 'success', text: t('{name} now uses {model}.', { name: profile.name, model: model || t('CLI default') }) })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

// ---- Orca integrations

export async function refreshConsents(): Promise<void> {
  const answer = await plugin.request('consents.get').catch(() => null)
  if (answer) set(consents, answer.granted)
}

/** A switch that needs confirmation: the person read what it allows and pressed Turn on. */
export async function confirmSwitch(key: string): Promise<void> {
  try {
    set(consents, (await plugin.request('consent.set', { key, granted: true })).granted)
    await setSetting(key, true)
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

/** Turning a switch off also withdraws its confirmation: on again asks again. */
export async function turnSwitchOff(key: string): Promise<void> {
  await setSetting(key, false)
  if (read(consents).includes(key)) {
    const answer = await plugin.request('consent.set', { key, granted: false }).catch(() => null)
    if (answer) set(consents, answer.granted)
  }
}

/** What the worker may really do: the switch, and its confirmation when it needs one. */
export function allowed(key: string): boolean {
  const on = read(privacy)[key] === true
  return NEEDS_CONSENT.has(key as never) ? on && read(consents).includes(key) : on
}

/** Starts a new agent of this kind in the focused workspace with the prompt. */
export async function launchAgent(agent: string, prompt: string): Promise<void> {
  if (!prompt.trim()) return
  set(busy, 'send')
  try {
    await plugin.request('agent.launch', { agent, prompt, ...knownWorkspaceId() })
    set(notice, { tone: 'success', text: t('Started a new {agent} agent with the prompt.', { agent }) })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  } finally {
    set(busy, null)
  }
}

/** Opens a file of the project in Orca's editor. */
export async function openFile(path: string): Promise<void> {
  try {
    await plugin.request('editor.open', { path, ...knownWorkspaceId() })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

export async function refreshDataSummary(): Promise<void> {
  set(dataSummary, await plugin.request('data.summary').catch(() => null))
}

export async function clearData(what: 'history' | 'catalogs' | 'all'): Promise<void> {
  try {
    await plugin.request('data.clear', { what })
    if (what === 'history' || what === 'all') set(historyRaw, [])
    if (what === 'catalogs' || what === 'all') set(catalogs, {})
    if (what === 'all') {
      set(consents, [])
      for (const [now, , empty] of KEPT) set(now, empty as never)
      set(rulesState, { rules: [], structures: [] })
      forgetSaved()
    }
    set(confirmWipe, false)
    const done: Record<typeof what, () => string> = {
      all: () => t('All plugin data deleted.'),
      history: () => t('History cleared.'),
      catalogs: () => t('Model lists cleared.')
    }
    set(notice, { tone: 'success', text: done[what]() })
    await refreshModels()
    await refreshDataSummary()
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

// ---- rules and structures

export async function refreshRules(): Promise<void> {
  set(rulesState, await plugin.request('rules.get').catch(() => read(rulesState)))
}

/** Shown at once; the worker saves it and answers with what it kept. */
export function saveRules(change: (config: RulesConfig) => RulesConfig): void {
  const next = change(read(rulesState))
  set(rulesState, next)
  plugin.request('rules.save', { config: next }).catch((error: unknown) => set(notice, { tone: 'danger', text: message(error) }))
}

export function addRule(): void {
  const text = read(ruleDraft).trim().slice(0, MAX_RULE_CHARS)
  if (!text) return
  const scope = read(ruleScope) === 'workspace' ? (read(workspaceName) ?? '') : ''
  saveRules((config) => ({ ...config, rules: [...config.rules, { id: newId('rule'), text, enabled: true, scope }].slice(0, MAX_RULES) }))
  set(ruleDraft, '')
}

/** Saves the structure form: a new structure, or (with an id) an edit of one, built-in ones included. */
export function addStructure(id?: string): void {
  const { name, sections } = read(structureDraft)
  const list = sections
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, MAX_SECTIONS)
  if (!name.trim() || list.length === 0) return
  const structure = { id: id ?? newId('structure'), name: name.trim().slice(0, 40), sections: list }
  saveRules((config) => {
    const exists = config.structures.some((entry) => entry.id === structure.id)
    const structures = exists ? config.structures.map((entry) => (entry.id === structure.id ? structure : entry)) : [...config.structures, structure]
    return { ...config, structures: structures.slice(0, MAX_STRUCTURES) }
  })
  set(structureDraft, { name: '', sections: '' })
}

export function removeStructure(id: string): void {
  saveRules((config) => ({ ...config, structures: config.structures.filter((structure) => structure.id !== id) }))
  if (read(structureChoice) === id) set(structureChoice, '')
}

/** The plugin's issue page, in the browser (Orca asks before opening a site the first time). */
export async function openIssues(): Promise<void> {
  const opened = await shell.openExternal(ISSUES_URL).catch(() => ({ opened: false }))
  if (!opened.opened) set(notice, { tone: 'neutral', text: t('Open {url} in your browser.', { url: ISSUES_URL }) })
}
