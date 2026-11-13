// actions.ts: what the panel does (what its buttons call): requests to the worker, and the changes
// to the state (state.ts) that follow. No UI here; the web panel (web/src) and the tests call these.
import { files as orcaFiles, plugin, read, set, settings, shell, update, type JsonValue } from 'orca'
import { MAX_RULE_CHARS, MAX_RULES, MAX_SECTIONS, MAX_STRUCTURES, newId, projectScope, type RulesConfig } from '../rules.ts'
import { exportName, feedbackDue, historyMarkdown, ISSUES_URL, targetLabel } from './view.ts'
import { type HistoryEntry } from '../history.ts'
import { attachmentItemId } from '../image-limits.ts'
import { type Message } from '../messages.ts'
import { DEFAULT_MAX_TOKENS, isContextLevel, presetById, type ContextItemView, type ProfileView } from '../presets.ts'
import { isStyle } from '../prompts.ts'
import { t, uiLanguageSetting } from '../i18n.ts'
import { NEEDS_CONSENT, parseOtherAgentsLimits, parsePrivacy } from '../privacy.ts'
import { stepPercent, totalPercent, type Step } from '../progress.ts'
import { PANEL_REQUEST_LIMIT_MS, type ProfileInput } from '../protocol.ts'
import { pathInWorkspaceId, pathKey } from '../workspaces.ts'
import { consents, feedbackAsk, feedbackOff, feedbackShown, files, ruleDraft, ruleScope, structureDraft, type Form, terminalWorkspaces, workspaceChoices, tick, workspaceKey, projectName, parked, MAX_PARKED, type Slot, rulesState, structureChoice, workspaceName, tab, draft, result, style, profileChoice, modelChoice, outputChoice, excluded, target, historyRaw, confirmClearHistory, form, detected, catalogs, catalogLoading, customModel, type Run, run, dataSummary, privacy, confirmWipe, busy, notice, lastRun, contextShown, contextNotes, KEPT, mayKeep, put, forgetSaved, targets, models, defaults, effectiveStyle, effectiveLevel, effectiveEnter, say, message, errorMessage, historyOpen, hookLast, resultFor, sendAfterEnhance, filteredHistory, type NoticeAction } from './state.ts'

let inFlight: AbortController | null = null
/** The project of the run in flight; filled in if the panel learns its key only after the run started. */
let runOrigin: { key: string | null; name: string | null } | null = null
/** Projects Orca has removed: an answer for one of them is dropped, never shown elsewhere. */
const removedWorkspaces = new Set<string>()
/** The key each project was shown under, by its folder (see workspaceRemoved). */
const keyByFolder = new Map<string, string>()

// ---------------------------------------------------------------- projects

/** What the focused project is called in the panel's messages: its own name, else the workspace's. */
const projectTitle = () => read(projectName) ?? read(workspaceName)

/** The composer as it is now, to park under its project. */
function snapshot(): Slot {
  return {
    name: projectTitle(),
    draft: read(draft),
    result: read(result),
    lastRun: read(lastRun),
    contextShown: read(contextShown),
    contextNotes: read(contextNotes),
    excluded: read(excluded),
    files: read(files),
    at: Date.now()
  }
}

const isEmpty = (slot: Slot) => !slot.draft.trim() && !slot.result.trim() && slot.contextShown.length === 0 && (slot.files ?? []).length === 0

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
function switchWorkspace(key: string, name: string | null, sameTerminals = false): void {
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
  // Orca could not tell which workspace this was (several share its name and branch), so the panel
  // knew the project by its name; now Orca knows. It is still the project the composer belongs to
  // when it has the terminals that were shown (a terminal is in one workspace only): what the
  // person wrote stays where it is, and a run in flight answers here. Parking it under the name
  // would lose it, since this project is never known by its name again.
  const running = runOrigin !== null && runOrigin.key === old
  if (sameTerminals && name !== null && old === `name:${name}` && !key.startsWith('name:') && (running || !isEmpty(snapshot()))) {
    put(workspaceKey, key)
    set(workspaceName, name)
    if (runOrigin && running) runOrigin.key = key
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
  put(files, incoming?.files ?? [])
  if (incoming) park(key, { ...incoming, draft: '', result: '', contextShown: [], files: [] })
  // Which request the result on screen was made from is known for the composer that was just
  // put away, not for this one: Ctrl+Enter enhances here until a run says otherwise.
  set(resultFor, null)
  beforeReuse = null
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

/**
 * Orca removed a project: forget what was parked for it. The event names it by another id than the
 * one the panel knows it by (workspaces.ts), so the project is also looked up by its folder.
 */
export function workspaceRemoved(workspaceId: string, path?: string): void {
  const folder = path ?? pathInWorkspaceId(workspaceId)
  const shownAs = folder ? keyByFolder.get(pathKey(folder)) : undefined
  let next = read(parked)
  for (const key of new Set([workspaceId, ...(shownAs ? [shownAs] : [])])) {
    removedWorkspaces.add(key)
    if (next[key]) {
      next = { ...next }
      delete next[key]
    }
  }
  if (next !== read(parked)) put(parked, next)
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
    const { targets: list, workspace, project, workspaceId, workspacePath, choices } = await plugin.request('targets.list', { known: read(terminalWorkspaces) })
    set(workspaceChoices, choices ?? [])
    // Once known, the workspace of these terminals stays known (the next lookup needs no guess).
    if (workspaceId) learnTerminals(list.map((item) => item.terminalId), workspaceId)
    if (workspaceId && workspacePath) keyByFolder.set(pathKey(workspacePath), workspaceId)
    // A project that is open again is not a removed one (a folder added back keeps its id).
    if (workspaceId) removedWorkspaces.delete(workspaceId)
    // Before the terminals: the composer must follow the project first, so that a target of the new
    // project is never shown next to a prompt of the old one.
    const shown = new Set(read(targets).map((item) => item.terminalId))
    switchWorkspace(workspaceId ?? (workspace ? `name:${workspace}` : ''), workspace ?? null, list.some((item) => shown.has(item.terminalId)))
    // After the switch: what was parked just now carries the name of the project it was written in.
    set(projectName, project ?? null)
    set(targets, list)
    const current = read(target)
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

export async function enhanceNow(): Promise<void> {
  await runEnhance()
}

/** What a run left in this composer: the request it was made from, and the prompt it wrote. */
type Enhanced = { prompt: string; enhanced: string }

/**
 * One enhance run. Answers with what it put into the composer on screen, or null when nothing is
 * there to act on: it failed or was cancelled, or its project is no longer the one in focus.
 */
async function runEnhance(): Promise<Enhanced | null> {
  const prompt = read(draft).trim()
  if (!prompt || read(busy)) return null
  let shown: Enhanced | null = null
  const controller = new AbortController()
  inFlight = controller
  const origin = { key: read(workspaceKey), name: projectTitle() }
  runOrigin = origin
  const runId = beginRun(`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, origin)
  set(busy, 'enhance')
  set(notice, null)
  set(feedbackShown, false)
  try {
    const choice = read(profileChoice)
    const input = {
      prompt,
      runId,
      // Orca ends a request after 120 s; a slower run goes on in the worker and is asked about again.
      resumable: true,
      style: read(effectiveStyle),
      ...(read(structureChoice) ? { structureId: read(structureChoice) } : {}),
      ...(read(files).length > 0 ? { files: read(files).map((file) => file.path) } : {}),
      ...knownWorkspaceId(),
      level: read(effectiveLevel),
      terminalId: read(target),
      profileId: choice === 'auto' ? null : choice,
      ...(choice !== 'auto' && read(modelChoice) ? { model: read(modelChoice) } : {}),
      // Leave the key out (not undefined): request inputs must be plain JSON.
      ...(read(outputChoice) === 'default' ? {} : { language: read(outputChoice) }),
      exclude: read(excluded)
    }
    const waiting = { timeoutMs: PANEL_REQUEST_LIMIT_MS, signal: controller.signal }
    let answer = await plugin.request('prompt.enhance', input, waiting)
    // Still going when the request had to answer: wait for it again, until it is done or cancelled.
    while (answer.pending) answer = await plugin.request('prompt.enhance', { prompt, runId, resume: true }, waiting)
    const ran = { model: answer.model, profileName: answer.profileName, ms: answer.ms, attempts: answer.attempts }
    if (origin.key === read(workspaceKey)) {
      put(result, answer.enhanced)
      // While the composer still holds this request, Ctrl+Enter sends the result (enhanceOrSend).
      set(resultFor, prompt)
      put(lastRun, ran)
      showContext(answer.context, answer.notes)
      askForFeedback()
      shown = { prompt, enhanced: answer.enhanced }
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
  return shown
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

export function removeFile(path: string): void {
  put(files, read(files).filter((file) => file.path !== path))
  // Its text leaves the context list with it, ticked or not.
  const id = attachmentItemId(path)
  put(contextShown, read(contextShown).filter((item) => item.id !== id))
  update(excluded, (list) => list.filter((entry) => entry !== id))
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
  await sendTo(terminalId, text, false)
}

/**
 * Types the text into one terminal. An agent that is waiting for an answer from the person is not
 * typed into unasked (the worker refuses): the notice offers to type it without Enter (`force`).
 */
async function sendTo(terminalId: string, text: string, force: boolean): Promise<void> {
  if (read(busy)) return
  set(busy, 'send')
  try {
    await typeInto(terminalId, text, force)
  } finally {
    set(busy, null)
  }
}

/** The request behind sendTo, and the notice that says how it went. The caller holds `busy`. */
async function typeInto(terminalId: string, text: string, force: boolean): Promise<void> {
  const item = read(targets).find((entry) => entry.terminalId === terminalId)
  if (!item) {
    set(notice, { tone: 'warning', text: t('That terminal is no longer open.') })
    return
  }
  const label = targetLabel(item)
  try {
    const { accepted } = await plugin.request('prompt.send', { terminalId, text, enter: read(effectiveEnter), ...(force ? { force: true } : {}) })
    const done = force ? t('Typed into {label}, without Enter.', { label }) : t('Sent to {label}.', { label })
    set(notice, accepted ? { tone: 'success', text: done } : { tone: 'warning', text: t('{label} did not accept the text.', { label }) })
  } catch (error) {
    if (!force && errorMessage(error)?.code === 'error.agent_blocked') {
      set(notice, { tone: 'warning', text: message(error), action: { label: t('Type it without Enter'), run: { kind: 'send.anyway', terminalId, text } } })
    } else set(notice, { tone: 'danger', text: message(error) })
  }
}

/**
 * Ctrl+Enter in the composer: sends the result while it is the one made from what the composer
 * still holds (the person has it in front of them), and enhances otherwise. With "Send right after
 * enhancing" on, the enhance goes on to the send by itself (enhanceAndSend).
 */
export async function enhanceOrSend(): Promise<void> {
  const output = read(result)
  const current = output.trim() !== '' && read(resultFor) !== null && read(resultFor) === read(draft).trim()
  if (current && read(target) && read(busy) === null) return send(output)
  return enhanceAndSend()
}

/** Whether a one-step send is on: its own switch, and "Send to terminals", which it needs. */
export const sendsAfterEnhance = () => read(sendAfterEnhance) && allowed('allowTerminalSend')

/** The agent states in which nothing is going on in the terminal: it sits at its prompt. */
const IDLE_STATES = new Set(['waiting', 'done'])

/**
 * Why a prompt that was just enhanced is not sent by itself, as a sentence for the person, or null
 * when every condition holds. `start` is what was fixed when the run began.
 */
function heldBack(start: { terminalId: string | null; key: string | null }, done: Enhanced): string | null {
  const key = read(workspaceKey)
  // Orca tells several same-named projects apart only by their terminals; while it could not (when
  // the run began, or now), this could be a terminal of another project.
  const unknown = (value: string | null) => value === null || value.startsWith('name:')
  if (unknown(key) || unknown(start.key)) return t('Orca could not tell which project this is.')
  if (key !== start.key) return t('The project in focus changed while it ran; the prompt waits in the project it was written in.')
  const item = read(targets).find((entry) => entry.terminalId === start.terminalId)
  if (!start.terminalId || !item || read(target) !== start.terminalId) return t('The terminal picked when you started is closed or no longer the one picked.')
  const label = targetLabel(item)
  // A plain terminal would run the prompt's first line as a command.
  if (!item.agent) return t('{label} is a plain terminal, not an agent.', { label })
  // A working agent can ask for an answer at any moment, and what is typed then could be taken as it.
  const name = item.title ?? item.agent
  if (item.state === 'working') return t('{name} is still working.', { name })
  if (item.state === 'blocked') return t('{name} is waiting for an answer from you.', { name })
  if (!item.state || !IDLE_STATES.has(item.state)) return t('Orca does not say whether {name} is idle.', { name })
  if (read(draft).trim() !== done.prompt || read(result) !== done.enhanced) return t('The text changed while it ran.')
  return null
}

/**
 * Enhances, then types the result into the picked terminal with no read in between. Only while
 * "Send right after enhancing" is on (Settings: off until the person has read what it does);
 * otherwise this is a plain enhance. Nothing is sent on a doubt, and the result then waits in the
 * composer like any other:
 * - the terminal is fixed when the run starts, and must still be open and still be the one picked;
 * - the project must be one Orca can tell from the others, and the one the run started in;
 * - the agent there must be idle, as Orca reports it once the run is over;
 * - the text sent is the run's own answer, and only while the composer still holds its request.
 * Enter follows the Enter switch, and the worker's own checks (the Send switch, an agent that is
 * waiting for an answer) apply as for any send.
 */
export async function enhanceAndSend(): Promise<void> {
  if (!sendsAfterEnhance()) return enhanceNow()
  const start = { terminalId: read(target), key: read(workspaceKey) }
  const done = await runEnhance()
  if (!done) return
  set(busy, 'send')
  try {
    // The states as they are now, not as they were when the run began.
    await refreshTargets()
    const why = heldBack(start, done)
    if (why) {
      set(notice, { tone: 'warning', text: `${t('Not sent by itself.')} ${why} ${t('Read the prompt and send it yourself.')}` })
      return
    }
    await typeInto(start.terminalId!, done.enhanced, false)
  } finally {
    set(busy, null)
  }
}

/**
 * The switch itself. Turning it on is a confirmation: the Settings section calls this from the
 * dialog that says what it does and what can go wrong.
 */
export function setSendAfterEnhance(on: boolean): void {
  set(sendAfterEnhance, on)
}

/** Runs what a notice's button stands for (state.ts: NoticeAction). */
export async function runNoticeAction(action: NoticeAction): Promise<void> {
  // The composer is in use (a run, a send): what the button would do waits, and says so.
  if (action.kind !== 'history.restore' && read(busy) !== null) {
    set(notice, { tone: 'warning', text: t('Something is still running here. Try again when it has finished.') })
    return
  }
  if (action.kind === 'composer.restore') restoreComposer()
  else if (action.kind === 'send.anyway') await sendTo(action.terminalId, action.text, true)
  else {
    const answer = await plugin.request('history.restore', { id: action.id }).catch(() => ({ restored: false }))
    set(notice, answer.restored ? { tone: 'success', text: t('Back in the history.') } : { tone: 'warning', text: t('It could not be brought back.') })
  }
}

export async function copy(text: string): Promise<void> {
  if (!text.trim()) return
  const answer = await plugin.request('prompt.copy', { text }).catch((error) => ({ copied: false, error: message(error) }))
  set(notice, answer.copied ? { tone: 'success', text: t('Copied to clipboard.') } : { tone: 'danger', text: t('Copy failed: {error}', { error: answer.error ?? 'unknown error' }) })
}

/**
 * Offers a text in Orca's save dialog, as a Markdown file. Called at once, inside the press: Orca
 * opens the dialog only from a gesture. The person picks the place; the plugin never learns it.
 */
async function saveFile(name: string, data: string): Promise<void> {
  try {
    const { status } = await orcaFiles.saveAs({ suggestedName: name, mimeType: 'text/markdown', data })
    if (status === 'saved') set(notice, { tone: 'success', text: t('Saved as a file.') })
  } catch {
    set(notice, { tone: 'danger', text: t('The file could not be saved.') })
  }
}

/** The enhanced prompt as a file, as it reads in the box (edits included). */
export async function savePrompt(text: string): Promise<void> {
  if (!text.trim()) return
  await saveFile(exportName('prompt'), text.endsWith('\n') ? text : `${text}\n`)
}

/** The history entries the list shows (the search and the project filter apply), as one file. */
export async function exportHistory(): Promise<void> {
  const entries = read(filteredHistory)
  if (entries.length === 0) return
  await saveFile(exportName('history'), historyMarkdown(entries))
}

/** What the composer held before a history entry was opened in it, and in which project: for Undo. */
let beforeReuse: { slot: Slot; key: string | null } | null = null

function restoreComposer(): void {
  const kept = beforeReuse
  beforeReuse = null
  // Only in the project it was taken in: a composer never moves to another project.
  if (!kept || kept.key !== read(workspaceKey)) return
  put(draft, kept.slot.draft)
  put(result, kept.slot.result)
  put(lastRun, kept.slot.lastRun)
  put(contextShown, kept.slot.contextShown)
  put(contextNotes, kept.slot.contextNotes)
  set(excluded, kept.slot.excluded)
  put(files, kept.slot.files ?? [])
  set(resultFor, null)
}

/**
 * Opens a history entry in the composer. What the composer held is replaced, so the notice offers
 * Undo; an entry written in another project says so, since it is about to be sent in this one.
 */
export function reuse(entry: HistoryEntry): void {
  const had = snapshot()
  const replaced = !isEmpty(had) && (had.draft !== entry.original || had.result !== entry.enhanced)
  beforeReuse = replaced ? { slot: had, key: read(workspaceKey) } : null
  put(draft, entry.original)
  put(result, entry.enhanced)
  // What the composer showed about its last run was about another prompt.
  put(lastRun, null)
  put(contextShown, [])
  put(contextNotes, [])
  if (isStyle(entry.style)) set(style, entry.style)
  set(tab, 'enhance')
  // Written in another project, or (where Orca cannot tell which project is open) in one that may
  // be another: it says where it is from, and Ctrl+Enter does not send it before it was read.
  const here = read(projectName)
  const elsewhere = entry.project && entry.project !== here ? entry.project : null
  set(resultFor, elsewhere ? null : entry.original.trim())
  if (!elsewhere && !replaced) return
  set(notice, {
    tone: elsewhere ? 'warning' : 'neutral',
    text: elsewhere ? t('This prompt was written in {name}: read it before you send it here.', { name: elsewhere }) : t('Opened from the history. What the composer held was replaced.'),
    ...(replaced ? { action: { label: t('Undo'), run: { kind: 'composer.restore' as const } } } : {})
  })
}

/** History changes go through the worker, in order with the entries it is saving. */
export async function removeEntry(id: string): Promise<void> {
  try {
    await plugin.request('history.remove', { id })
    if (read(historyOpen) === id) set(historyOpen, null)
    // Delete sits next to Copy: one press too many is put right with Undo (the worker keeps the entry for a minute).
    set(notice, { tone: 'neutral', text: t('Removed from the history.'), action: { label: t('Undo'), run: { kind: 'history.restore', id } } })
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
      maxTokens: profile.maxTokens,
      enabled: profile.enabled,
      command: profile.command,
      args: profile.args,
      apiKey: ''
    })
  } else {
    const preset = presetById('openai')
    set(form, { name: preset.label, preset: preset.id, provider: preset.provider, baseUrl: preset.baseUrl, model: preset.model, maxTokens: DEFAULT_MAX_TOKENS, enabled: true, command: '', args: '', apiKey: '' })
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
  if (read(busy)) return
  const preset = presetById(presetId)
  set(busy, 'save')
  try {
    set(
      models,
      await plugin.request('models.save', {
        name: preset.label.replace(/ \(.*\)$/, ''),
        preset: preset.id,
        provider: preset.provider,
        baseUrl: '',
        model: preset.model,
        maxTokens: DEFAULT_MAX_TOKENS,
        enabled: true,
        command: path,
        args: ''
      })
    )
    await detectClis()
    set(notice, { tone: 'success', text: t('Added {name}. Use Test to check it is signed in.', { name: preset.label }) })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  } finally {
    set(busy, null)
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

/** What auto-enhance did with the last prompt it saw (the Settings section shows it). */
export async function refreshHookLast(): Promise<void> {
  set(hookLast, await plugin.request('hook.last').catch(() => null))
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
      set(hookLast, null)
      set(resultFor, null)
      // A confirmation like the others: gone with everything else, and asked for again.
      set(sendAfterEnhance, false)
      beforeReuse = null
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
  // For this project when the panel knows which project this is, else for every project (the
  // workspace's own name is shared by projects: a rule kept under it was followed in all of them).
  const project = read(projectName)
  const scope = read(ruleScope) === 'workspace' && project ? projectScope(project) : ''
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

/**
 * A prompt was enhanced and its result is on screen: shows the note that asks for ideas and feedback
 * when it is due (view.ts: after the first few prompts, then now and then). Prompts are counted only
 * until the note has shown once, and not at all while the person has turned the note off. Exported
 * for tests.
 */
export function askForFeedback(now = Date.now()): void {
  if (read(feedbackOff)) return
  const ask = read(feedbackAsk)
  const counted = ask.shownAt === 0 ? { ...ask, runs: ask.runs + 1 } : ask
  if (feedbackDue(counted, now)) {
    set(feedbackAsk, { ...counted, shownAt: now })
    set(feedbackShown, true)
  } else if (counted !== ask) {
    set(feedbackAsk, counted)
  }
}

export function closeFeedback(): void {
  set(feedbackShown, false)
}

/** The note's button: the plugin's issue page, like Feedback in the settings. */
export async function sendFeedback(): Promise<void> {
  set(feedbackShown, false)
  // Called at once, inside the press: Orca opens a link only from a gesture.
  await openIssues()
}

/** The switch under Feedback in the settings section: whether the note may come at all. */
export function setFeedbackNotes(on: boolean): void {
  set(feedbackOff, !on)
  if (!on) set(feedbackShown, false)
}

/**
 * "Don't ask again" in the note: the same switch, turned off, and a word on where to turn it back
 * on, so the choice is never a dead end.
 */
export function stopFeedback(): void {
  setFeedbackNotes(false)
  set(notice, { tone: 'neutral', text: t('No more feedback notes. To turn them back on, open the gear icon and look under Feedback.') })
}
