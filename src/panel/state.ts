// state.ts: what the panel knows (its atoms), with no UI in it. The web panel (web/src) draws it and
// the tests read it; actions.ts changes it, view.ts turns it into labels and options, setup.ts wires
// Orca's events to it.
import { atom, derived, read, set, type Atom, type JsonValue } from 'orca'
import { HISTORY_KEY, parseHistory } from '../history.ts'
import type { RulesConfig } from '../rules.ts'
import { isMessage, messageIn, plainText, render, type Message } from '../messages.ts'
import { type ContextItemView } from '../presets.ts'
import { t } from '../i18n.ts'
import { type Step } from '../progress.ts'
import { type AttemptView, type ModelsView, type ProfileInput } from '../protocol.ts'

export type Target = { terminalId: string; label: string; agent: string | null }
export type Notice = { tone: 'success' | 'danger' | 'warning' | 'neutral'; text: string } | null
export type Defaults = {
  style: string
  level: string
  pressEnter: boolean
  fallbackEnabled: boolean
  fallbackOn: string
  outputLanguage: string
  autoEnhanceMode: string
  notifyWhenDone: boolean
  /** Read other agents' sessions: how many agents, how many lines each. */
  otherAgents: { agents: number; lines: number }
}
export type Form = Omit<ProfileInput, 'apiKey'> & { apiKey: string }

// Keyed atoms survive hot reloads; `persist: 'plugin'` ones survive panel runs.
export const tab = atom('tab', 'enhance', { persist: 'plugin' })
export const draft = atom('')
export const result = atom('')
export const style = atom<string | null>('style', null, { persist: 'plugin' })
export const level = atom<string | null>('level', null, { persist: 'plugin' })
export const profileChoice = atom('profileChoice', 'auto', { persist: 'plugin' })
/** The model picked for that profile in the composer; '' = the profile's own model. */
export const modelChoice = atom('modelChoice', '', { persist: 'plugin' })
/** Per-prompt output language: 'default' uses the setting. */
export const outputChoice = atom('outputChoice', 'default', { persist: 'plugin' })
export const excluded = atom<string[]>('excluded', [])
export const target = atom<string | null>('target', null)
export const pressEnter = atom<boolean | null>('pressEnter', null)
export const historyRaw = atom<JsonValue>(HISTORY_KEY, [], { persist: 'storage' })
/**
 * Rules tab: rules and structures as the worker last saved them, and its two forms. Saved through the
 * worker (not a storage atom): quick edits in a row could otherwise be undone by a late echo.
 */
export const rulesState = atom<RulesConfig>({ rules: [], structures: [] })
export const ruleDraft = atom('')
export const ruleScope = atom('all')
export const structureDraft = atom({ name: '', sections: '' })
/** The structure picked in the composer's options; '' = the style's own shape. */
export const structureChoice = atom('structureChoice', '', { persist: 'plugin' })
/**
 * Which workspace a terminal belongs to, by Orca's id: learnt from Orca's agent events and from the
 * person's pick, since several workspaces can share a name and branch (all "main", say).
 */
export const terminalWorkspaces = atom<Record<string, string>>('terminalWorkspaces', {}, { persist: 'plugin' })
/** The folders the focused workspace could be, when Orca cannot tell (the person picks one). */
export const workspaceChoices = atom<{ id: string; path: string; project?: string }[]>([])
/** The focused workspace's name as Orca gives it; several projects can share it ("main"). */
export const workspaceName = atom<string | null>(null)
/**
 * The focused project's own name (its repository's name in Orca): what its rules are kept under,
 * and what the panel calls it. Null while it is not known which of several same-named projects this is.
 */
export const projectName = atom<string | null>(null)
export const historyFilter = atom('historyFilter', '')
/** History entries drawn at once; "Show more" adds a page. */
export const HISTORY_PAGE = 50
export const historyShown = atom(HISTORY_PAGE)
export const confirmClearHistory = atom(false)
export const form = atom<Form | null>('form', null)
export const detected = atom<{ preset: string; label: string; path: string; added: boolean }[]>([])
export type Catalog = { models: { id: string; label: string; description?: string; isDefault?: boolean }[]; source: string; fetchedAt: number; error?: string }
/** Model lists by profile id, or 'form' for the add/edit form. */
export const catalogs = atom<Record<string, Catalog>>({})
export const catalogLoading = atom<Record<string, boolean>>({})
export const CUSTOM_MODEL = '__custom__'
/** Select values cannot be empty: this stands for "the CLI's own default model" (stored as ''). */
export const CLI_DEFAULT = '__cli_default__'
export const toModel = (value: string) => (value === CLI_DEFAULT ? '' : value)
/** The form's model picker is on "Other (type the id)". */
export const customModel = atom(false)
/** The current enhance run: its real steps from the worker, and how it ended. */
export type Run = {
  runId: string
  startedAt: number
  /** The project the run was started in (its key and name): its answer belongs there. */
  workspace?: { key: string | null; name: string | null }
  steps: Step[]
  status: 'running' | 'done' | 'error' | 'cancelled'
  error?: string
  finishedAt?: number
  /** The run's share when it ended (failed or cancelled): the bar stops there instead of jumping. */
  endPercent?: number
}
/** The clock the run card reads, moved every half second while a run goes (model estimates grow). */
export const tick = atom(Date.now())
export const run = atom<Run | null>(null)

/** What the Settings tab shows: stored data counts and the switches. */
export const dataSummary = atom<{ history: number; profiles: number; keys: number; catalogs: number } | null>(null)
export const privacy = atom<Record<string, boolean>>({})
/** "Delete everything" asks for a second press. */
export const confirmWipe = atom(false)
/** The Privacy switches the person confirmed in the panel (the worker keeps them); see NEEDS_CONSENT. */
export const consents = atom<string[]>([])
/** The composer's options (style, context, output, Enter) are shown. */
export const optionsOpen = atom('optionsOpen', false, { persist: 'plugin' })

export const busy = atom<'enhance' | 'preview' | 'send' | 'test' | 'save' | null>(null)
export const notice = atom<Notice>(null)
export type LastRun = { model: string; profileName: string; ms: number; attempts: AttemptView[] } | null
export const lastRun = atom<LastRun>(null)
/** Every context item seen for the current draft, so excluded ones stay listed (unchecked). */
export const contextShown = atom<ContextItemView[]>([])
/** Notes are Messages; an older version saved plain strings. */
export const contextNotes = atom<(Message | string)[]>([])
/**
 * The note that asks for ideas and feedback, under a result now and then (view.ts says when): how
 * many prompts were enhanced before it first showed, and when it last showed. Kept by the panel on
 * this machine; nothing about it is sent anywhere.
 */
export type FeedbackAsk = { runs: number; shownAt: number }
export const feedbackAsk = atom<FeedbackAsk>('feedbackAsk', { runs: 0, shownAt: 0 }, { persist: 'plugin' })
/**
 * The person turned the note off ("Don't ask again" in the note, or the switch under Feedback). Kept
 * here and not as a setting in the manifest: Orca counts a new setting as more access and asks every
 * user to approve the update again, and until they do, they get no update at all.
 */
export const feedbackOff = atom('feedbackOff', false, { persist: 'plugin' })
/** The note is on screen: until it is closed, used or turned off, or the next prompt is enhanced. */
export const feedbackShown = atom(false)
/**
 * Files attached in the panel (pasted, dropped or picked): the worker keeps a copy on disk and
 * answers with its path. Images among them are shown to models that read images.
 */
export type AttachedFile = { path: string; name: string; bytes: number; type: string }
export const files = atom<AttachedFile[]>([])

/**
 * Which project (workspace) the composer below belongs to: its key (Orca's workspace id, or its name
 * and branch when Orca cannot tell the id) and name. The draft, the result and what the last run used
 * belong to that project; switching projects parks them under its key and brings back the new one's.
 */
export const workspaceKey = atom<string | null>(null)
/** What a project left in the composer, kept while you work in another one. */
export type Slot = {
  name: string | null
  draft: string
  result: string
  lastRun: LastRun
  contextShown: ContextItemView[]
  contextNotes: (Message | string)[]
  excluded: string[]
  files?: AttachedFile[]
  at: number
}
/** Parked composers by project key; the oldest go past MAX_PARKED. */
export const parked = atom<Record<string, Slot>>({})
export const MAX_PARKED = 20

/**
 * The draft, the last result and what the last run used are kept across panel runs (Orca writes
 * `persist: 'plugin'` atoms to panel-state.json in the plugin's data folder) only while "Save history"
 * is on. The panel works on the in-memory atoms above; `put` mirrors them into these saved copies,
 * or empties the copies when saving is off. Same keys as before, so earlier saved values still load.
 */
export const KEPT: [Atom<never>, Atom<never>, unknown][] = [
  [draft, atom('draft', '', { persist: 'plugin' }), ''],
  [result, atom('result', '', { persist: 'plugin' }), ''],
  [lastRun, atom<LastRun>('lastRun', null, { persist: 'plugin' }), null],
  [contextShown, atom<ContextItemView[]>('contextShown', [], { persist: 'plugin' }), []],
  [contextNotes, atom<(Message | string)[]>('contextNotes', [], { persist: 'plugin' }), []],
  [files, atom<AttachedFile[]>('files', [], { persist: 'plugin' }), []],
  [workspaceKey, atom<string | null>('workspaceKey', null, { persist: 'plugin' }), null],
  [parked, atom<Record<string, Slot>>('parked', {}, { persist: 'plugin' }), {}]
] as never

export const mayKeep = () => read(privacy).saveHistory !== false

/** Sets an atom of KEPT, and its saved copy when saving is allowed. */
export function put<T>(target: Atom<T>, value: T): void {
  set(target, value)
  const pair = KEPT.find(([now]) => (now as unknown) === target)
  if (pair) set(pair[1], (mayKeep() ? value : pair[2]) as never)
}

/** Empties every saved copy (saving turned off, or Delete everything). */
export function forgetSaved(): void {
  for (const [, saved, empty] of KEPT) set(saved, empty as never)
}

/** On open: the saved copies become the working values. */
export function restoreSaved(): void {
  for (const [now, saved] of KEPT) set(now, read(saved))
}
export const targets = atom<Target[]>([])
export const models = atom<ModelsView | null>(null)
export const defaults = atom<Defaults>({
  style: 'balanced',
  level: 'standard',
  pressEnter: false,
  fallbackEnabled: true,
  fallbackOn: 'any',
  outputLanguage: 'auto',
  autoEnhanceMode: 'off',
  notifyWhenDone: false,
  otherAgents: { agents: 4, lines: 80 }
})

export const history = derived(() => parseHistory(read(historyRaw)))
export const filteredHistory = derived(() => {
  const query = read(historyFilter).trim().toLowerCase()
  const list = read(history)
  return query
    ? list.filter((entry) => entry.original.toLowerCase().includes(query) || entry.enhanced.toLowerCase().includes(query))
    : list
})
export const effectiveStyle = derived(() => read(style) ?? read(defaults).style)
export const effectiveLevel = derived(() => read(level) ?? read(defaults).level)
export const effectiveEnter = derived(() => read(pressEnter) ?? read(defaults).pressEnter)
export const enabledProfiles = derived(() => (read(models)?.profiles ?? []).filter((profile) => profile.enabled))

/** A worker Message in the panel's language; a plain string (saved by an older version) as is. */
export function say(text: Message | string): string {
  return typeof text === 'string' ? text : render(text, (template, params) => t(template, params))
}

/**
 * An error in the panel's language. The worker's message comes inside the error's text (Orca passes
 * on a thrown error's code and text only; see messages.ts); without one, the text is shown as it is.
 */
export const message = (error: unknown) => {
  const text = error && typeof error === 'object' && 'text' in error ? (error as { text: unknown }).text : null
  if (isMessage(text)) return say(text)
  if (!(error instanceof Error)) return String(error)
  const carried = messageIn(error.message)
  return carried ? say(carried) : plainText(error.message)
}
