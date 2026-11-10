// view.ts: what the panel shows, as plain data (labels, options, progress text, the small decisions
// about what to offer). The web panel (web/src) draws it; the tests check it.
import { read, set } from 'orca'
import { CONTEXT_LEVEL_LABELS, CONTEXT_LEVELS, isContextLevel, type ContextItemView, type ProfileView } from '../presets.ts'
import { isStyle, STYLE_LABELS, STYLES } from '../prompts.ts'
import { t } from '../i18n.ts'
import { allStructures, structureById, type RulesConfig } from '../rules.ts'
import { ESTIMATED_STEPS, stepPercent, type Step } from '../progress.ts'
import type { PrivacyKey } from '../privacy.ts'
import { type Catalog, type FeedbackAsk, type Run, catalogs, defaults, enabledProfiles, effectiveLevel, effectiveStyle, modelChoice, models, outputChoice, profileChoice, rulesState, structureChoice, say } from './state.ts'

/** The names of the panel's sections, on its header icons (the Enhance section shows the brand instead). */
export const SECTION_LABELS: Record<string, string> = { history: 'History', models: 'Models', rules: 'Rules', privacy: 'Privacy' }

/** What each auto-enhance mode does, said under its switch. */
export const AUTO_MODE_HINTS: Record<string, string> = {
  off: 'Prompts Orca sends to agents go out as they are.',
  rules: 'Adds your fixed text to the end of each prompt Orca sends to an agent. Instant, no model. The text is in Orca Settings → Plugins → Enhance Prompt.',
  ai: 'A fast API model rewrites each prompt Orca sends to an agent (a new agent with a task, the task board, orchestration). Orca waits at most 2 s, then sends the original.'
}

export const UI_LANGUAGE_LABELS: Record<string, string> = { auto: 'Auto', en: 'EN', vi: 'VI', zh: '中文' }
export const OUTPUT_LANGUAGE_LABELS: Record<string, string> = {
  auto: 'Output: same as prompt',
  en: 'Output: English',
  vi: 'Output: Vietnamese',
  zh: 'Output: Chinese'
}

export function outputOptions() {
  const fallback = read(defaults).outputLanguage
  const defaultLabel = OUTPUT_LANGUAGE_LABELS[fallback] ? t(OUTPUT_LANGUAGE_LABELS[fallback]) : fallback
  return [
    { value: 'default', label: t('Output: default ({value})', { value: defaultLabel.replace(/^[^:：]+[:：]\s*/, '') }) },
    ...Object.entries(OUTPUT_LANGUAGE_LABELS).map(([value, label]) => ({ value, label: t(label) }))
  ]
}

export function modelOptions(catalog: Catalog | undefined, current: string) {
  const options = (catalog?.models ?? []).map((model) => ({
    value: model.id,
    label: model.isDefault ? `${modelName(model.id, model.label, model.description)} · ${t('your default')}` : modelName(model.id, model.label, model.description)
  }))
  if (current && !options.some((option) => option.value === current)) options.unshift({ value: current, label: current })
  return options
}

export const styleOptions = () => STYLES.map((value) => ({ value, label: t(STYLE_LABELS[value]) }))
export const levelOptions = () => CONTEXT_LEVELS.map((value) => ({ value, label: t(CONTEXT_LEVEL_LABELS[value]) }))
export const KEY_LABEL: Record<ProfileView['keySource'], string> = {
  secret: 'key saved',
  env: 'key from env',
  none: 'no key',
  'not-needed': 'local',
  subscription: 'subscription'
}

/** The Max tokens offered for a model; one saved with another value (an older version, a hand-edited profile) is offered too. */
export const maxTokenChoices = (current: number): number[] => [...new Set([1000, 2000, 4000, 8000, 16000, current])].sort((a, b) => a - b)

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/**
 * How long a run has taken, for its card: up to `now` while it runs, then up to its end. Never below
 * zero: the worker's clock starts a moment after the panel's, and "-0.0 s" must not show.
 */
export function runSeconds(current: Pick<Run, 'status' | 'startedAt' | 'finishedAt'>, now: number): string {
  const end = current.status === 'running' ? now : (current.finishedAt ?? now)
  return seconds(Math.max(0, end - current.startedAt))
}

/** Why Enhance cannot answer yet, for the warning under the composer: no enabled model, or none with a key. */
export function modelWarning(): 'no-model' | 'no-key' | null {
  // Not loaded yet is not "none".
  if (read(models) === null) return null
  const profiles = read(enabledProfiles)
  if (profiles.length === 0) return 'no-model'
  return profiles.every((profile) => profile.keySource === 'none') ? 'no-key' : null
}

/** The models the auto-enhance hook can use: it has 2 s, so enabled API models only (a subscription CLI starts too slowly). */
export function hookModels(): ProfileView[] {
  return (read(models)?.profiles ?? []).filter((profile) => profile.enabled && profile.provider !== 'cli')
}

/** The hook's model as its menu shows it: the saved one while it can still answer in time, else "Same as the chain". */
export function hookChoice(): string {
  const saved = read(models)?.hookProfileId
  return saved && hookModels().some((profile) => profile.id === saved) ? saved : 'chain'
}

export const MODEL_SEP = '|'
export const PROFILE_DEFAULT = '__profile_default__'

/** "sonnet: Sonnet, newest" -> "Sonnet, newest"; display names stay as they are. */
export const modelDisplay = (label: string) => (label.includes(': ') ? label.slice(label.indexOf(': ') + 2) : label)

/** Aliases ("sonnet: Sonnet, newest") read "sonnet — Sonnet, newest"; named models read "Fable 5.1 — For…". */
export function modelName(id: string, label: string, description?: string): string {
  if (label.includes(': ')) return `${id} — ${modelDisplay(label)}`
  const short = description ? (description.length > 42 ? `${description.slice(0, 40)}…` : description) : ''
  return short ? `${label} — ${short}` : label
}

/** Composer names: "Fable 5.1", "GPT-6.1-Sol", or for an alias "sonnet (latest)". */
export function shortModelName(id: string, label: string): string {
  if (label.includes(': ')) return `${id} (${t('latest')})`
  return label || id
}

/** Context item names and kinds come from the worker in English; show them in the panel's language. */
export function contextKind(kind: string): string {
  const kinds: Record<string, () => string> = {
    workspace: () => t('workspace'),
    agent: () => t('agent'),
    rules: () => t('rules'),
    stack: () => t('stack'),
    tree: () => t('tree'),
    git: () => t('git'),
    file: () => t('file'),
    terminal: () => t('terminal'),
    agents: () => t('agents'),
    session: () => t('agent session'),
    activity: () => t('activity'),
    saved: () => t('saved files')
  }
  return kinds[kind]?.() ?? kind
}

/** Why an item is in the context (keyword match, picked by AI, trimmed), after a separator. */
export function itemWhy(item: ContextItemView): string {
  if (item.why) return ` · ${say(item.why)}`
  return item.note ? ` · ${item.note}` : ''
}

export const STEP_LABELS: Record<Step['key'], string> = {
  workspace: 'Reading workspace',
  project: 'Reading project rules and stack',
  git: 'Reading git changes',
  search: 'Finding relevant code',
  pick: 'AI picking files',
  terminal: 'Reading terminal output',
  agents: "Reading other agents' sessions",
  model: 'Writing the prompt'
}
export const STEP_GLYPH: Record<Step['status'], string> = { pending: '○', running: '●', done: '✓', skipped: '–', failed: '✕' }

export function stepText(entry: Step): string {
  const label = t(STEP_LABELS[entry.key])
  if (!entry.detail) return label
  const count = Number(entry.detail)
  if (entry.key === 'workspace' || entry.key === 'model' || !Number.isFinite(count)) return `${label} · ${entry.detail}`
  if (entry.key === 'terminal') return `${label} · ${t('{count} lines', { count })}`
  if (entry.key === 'git') return `${label} · ${t('{count} changed', { count })}`
  if (entry.key === 'agents') return `${label} · ${t('{count} agents', { count })}`
  return `${label} · ${t('{count} files', { count })}`
}

/** A step's share as shown: "≈" when estimated from time, "–" when skipped. */
export function stepShare(entry: Step, now: number): string {
  const share = stepPercent(entry, now)
  if (share === null) return '–'
  const estimated = entry.status === 'running' && entry.fraction === undefined && ESTIMATED_STEPS.has(entry.key)
  return `${estimated ? '≈' : ''}${share}%`
}

/** The word before ":" in a level label: "Deep: + git…" → "Deep". */
export const shortLabel = (label: string) => label.split(/[:：]/)[0].trim()

/** One line naming the current options, used as the options button's tooltip. */
export function optionsSummary(): string {
  const styleValue = read(effectiveStyle)
  const levelValue = read(effectiveLevel)
  const output = outputOptions().find((option) => option.value === read(outputChoice))
  return [
    t(STYLE_LABELS[isStyle(styleValue) ? styleValue : 'balanced']),
    shortLabel(t(CONTEXT_LEVEL_LABELS[isContextLevel(levelValue) ? levelValue : 'standard'])),
    read(outputChoice) !== 'default' && output ? output.label.replace(/^[^:：]+[:：]\s*/, '') : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The saved rules and structures, as the panel edits them. */
export const rulesConfig = (): RulesConfig => read(rulesState)

/** "By style" plus every built-in and saved structure. */
export function structureOptions() {
  const config = rulesConfig()
  return [
    { value: 'style', label: t('By style') },
    ...allStructures(config).map(({ structure, builtIn, edited }) => ({ value: structure.id, label: builtIn && !edited ? t(structure.name) : structure.name }))
  ]
}

/** The picked structure, or "By style" when it was deleted. */
export function structureValue(): string {
  const id = read(structureChoice)
  return id && structureById(rulesConfig(), id) ? id : 'style'
}

/** Every model of every enabled profile, from its live list, plus Auto. */
export function modelMenu() {
  const options: { value: string; label: string }[] = [
    { value: 'auto', label: read(defaults).fallbackEnabled ? t('Auto (fallback)') : t('Auto') }
  ]
  for (const profile of read(enabledProfiles)) {
    const catalog = read(catalogs)[profile.id]
    const listed = catalog?.models ?? []
    const seen = new Set<string>()
    const add = (id: string, label: string) => {
      if (seen.has(id)) return
      seen.add(id)
      const saved = id !== '' && id === profile.effectiveModel
      options.push({
        value: `${profile.id}${MODEL_SEP}${id || PROFILE_DEFAULT}`,
        label: `${profile.name} · ${label}${saved ? ` · ${t('default')}` : ''}`
      })
    }
    if (profile.provider === 'cli' && !profile.effectiveModel) add('', t('CLI default'))
    else if (profile.effectiveModel && !listed.some((model) => model.id === profile.effectiveModel)) add(profile.effectiveModel, profile.effectiveModel)
    for (const model of listed) add(model.id, shortModelName(model.id, model.label))
  }
  return options
}

export function currentModelValue(): string {
  const choice = read(profileChoice)
  if (choice === 'auto') return 'auto'
  const profile = read(enabledProfiles).find((entry) => entry.id === choice)
  if (!profile) return 'auto'
  const model = read(modelChoice) || profile.effectiveModel
  return `${choice}${MODEL_SEP}${model || PROFILE_DEFAULT}`
}

export function pickModel(value: string): void {
  if (value === 'auto') {
    set(profileChoice, 'auto')
    set(modelChoice, '')
    return
  }
  const [profileId, model] = value.split(MODEL_SEP)
  const profile = read(enabledProfiles).find((entry) => entry.id === profileId)
  set(profileChoice, profileId)
  // The profile's own model is stored as '' so a later change to the profile follows through.
  set(modelChoice, model === PROFILE_DEFAULT || model === profile?.effectiveModel ? '' : model)
}

export const PRIVACY_ROWS: { key: PrivacyKey; label: string; hint: string }[] = [
  { key: 'allowProjectFiles', label: 'Read project files', hint: 'Agent rules, README, manifest files and the file list of the focused workspace (Standard level and above). Off: only workspace and agent names are used.' },
  { key: 'allowGit', label: 'Run git', hint: 'Read-only git status, log, diff, ls-files and grep in the focused workspace (Deep and Max levels).' },
  { key: 'allowTerminalRead', label: 'Read terminal output', hint: 'The last lines of the terminal you picked, at the Max level only.' },
  { key: 'allowOtherAgents', label: "Read other agents' sessions", hint: "At the Max level: the other agents running in this workspace (kind, title, state) and the last lines of their terminals, with keys and passwords masked. Needs Read terminal output too. Off until you turn it on." },
  { key: 'allowAgentActivity', label: 'Watch what agents do', hint: 'Deep and Max levels: each tool an agent runs in Orca (its name and its target: a file path or a command, never its output) and how sessions end. Kept in memory for 45 minutes, never saved to disk.' },
  { key: 'allowEditorSaves', label: 'Notice files you save', hint: "Deep and Max levels: the paths of files you save in Orca's editor (never their text), kept in memory for 45 minutes; they rank first in the code search." },
  { key: 'allowTerminalSend', label: 'Send to terminals', hint: 'Type the prompt into the terminal you pick when you click Send. Off: use Copy instead.' },
  { key: 'allowAgentLaunch', label: 'Start new agents', hint: 'A button that starts a new agent (Claude Code, Codex…) in this workspace with the enhanced prompt, only when you press it.' },
  { key: 'allowOpenFiles', label: 'Open files in Orca', hint: 'Clicking a file in the context list opens it in an editor tab.' },
  { key: 'saveHistory', label: 'Save history', hint: 'Keep your prompts and enhanced prompts in the History tab, on this machine only.' },
  { key: 'allowEnvKeys', label: 'Use API keys from environment variables', hint: 'OPENAI_API_KEY, ANTHROPIC_API_KEY and the others, when a model has no saved key.' },
  { key: 'allowOnlineModelLists', label: 'Fetch model lists online', hint: "GET /models from your API providers and the public Claude Code settings schema, to keep model menus current. CLI lists are always local." }
]

/**
 * What the person reads before turning on a switch that needs confirmation: what it reads or does,
 * where that goes, what stays, and how to stop it. Nothing is left out.
 */
export const DISCLOSURES: Partial<Record<PrivacyKey, string[]>> = {
  allowOtherAgents: [
    'Reads which other agents run in this workspace (kind, title, state) and the last lines of each one\'s terminal, every time you enhance at the Max level: as many agents and lines as you set below the switch (4 agents and 80 lines by default, at most 8 and 300).',
    'That text is sent with your prompt to the model you run (your API provider, or the subscription CLI and its provider). It can contain code, file contents, command output and anything the agents printed.',
    'Values that look like keys, tokens or passwords are masked first, but masking cannot catch everything.',
    'Nothing of it is saved by the plugin. You can untick it in the context list for one run, or turn this switch off at any time.'
  ],
  allowAgentActivity: [
    'Orca tells the plugin each tool an agent runs in its terminals: the tool name and what it acted on (a file path, a command line, a search pattern or a URL), never the tool\'s output. Orca also tells it when a session finishes and how.',
    'This is kept in the plugin\'s memory only, for 45 minutes and 60 entries per workspace, and forgotten when you turn this off, delete everything, or Orca restarts.',
    'At the Deep and Max levels, the recent entries of the focused workspace are sent with your prompt to the model you run. Command lines are masked for obvious keys and passwords.',
    'The plugin only watches: it never changes or blocks what an agent does.'
  ],
  allowAgentLaunch: [
    'Adds a button that starts a new agent (Claude Code, Codex, Gemini…) in a new terminal of this workspace, and types the enhanced prompt into it once it is ready.',
    'The agent runs with your user account, exactly as if you had opened it yourself: it can read and change files and run commands, within that agent\'s own permission settings.',
    'It only happens when you press the button. The plugin never starts an agent by itself.'
  ]
}

/** The plugin's issue page, in the browser (Orca asks before opening a site the first time). */
export const ISSUES_URL = 'https://github.com/cattfan/orca-enhance-prompt/issues/new'

/**
 * The note that asks for ideas and feedback: first once someone has enhanced this many prompts (they
 * know the plugin by then), afterwards at most once in this many days.
 */
export const FEEDBACK_FIRST_RUNS = 5
export const FEEDBACK_EVERY_DAYS = 14

/**
 * Whether the note is due now that a prompt was enhanced. A clock set back does not silence it for
 * good: a last time further than the interval away counts, before or after now.
 */
export function feedbackDue(ask: FeedbackAsk, now: number): boolean {
  if (ask.shownAt === 0) return ask.runs >= FEEDBACK_FIRST_RUNS
  return Math.abs(now - ask.shownAt) >= FEEDBACK_EVERY_DAYS * 24 * 3600_000
}
