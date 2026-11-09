// view.ts: what both panels show, as plain data (labels, options, progress text). The components
// panel (src/panel/*.tsx) and the web panel (web/src) draw it each in their own way.
import { read, set } from 'orca'
import { CONTEXT_LEVEL_LABELS, CONTEXT_LEVELS, isContextLevel, type ContextItemView, type ProfileView } from '../presets.ts'
import { isStyle, STYLE_LABELS, STYLES } from '../prompts.ts'
import { t } from '../i18n.ts'
import { allStructures, structureById, type RulesConfig } from '../rules.ts'
import { ESTIMATED_STEPS, stepPercent, type Step } from '../progress.ts'
import { type Catalog, catalogs, defaults, enabledProfiles, effectiveLevel, effectiveStyle, modelChoice, outputChoice, profileChoice, rulesState, structureChoice, say } from './state.ts'

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

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

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
    error: () => t('error')
  }
  return kinds[kind]?.() ?? kind
}

/** Why an item is in the context (keyword match, picked by AI, trimmed), after a separator. */
export function itemWhy(item: ContextItemView): string {
  if (item.why) return ` · ${say(item.why)}`
  return item.note ? ` · ${item.note}` : ''
}

export const STEP_LABELS: Record<Step['key'], string> = {
  error: 'Reading the error',
  workspace: 'Reading workspace',
  project: 'Reading project rules and stack',
  git: 'Reading git changes',
  search: 'Finding relevant code',
  pick: 'AI picking files',
  terminal: 'Reading terminal output',
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

export const PRIVACY_ROWS: { key: 'allowProjectFiles' | 'allowGit' | 'allowTerminalRead' | 'allowTerminalSend' | 'saveHistory' | 'allowEnvKeys' | 'allowOnlineModelLists'; label: string; hint: string }[] = [
  { key: 'allowProjectFiles', label: 'Read project files', hint: 'Agent rules, README, manifest files and the file list of the focused workspace (Standard level and above). Off: only workspace and agent names are used.' },
  { key: 'allowGit', label: 'Run git', hint: 'Read-only git status, log, diff, ls-files and grep in the focused workspace (Deep and Max levels).' },
  { key: 'allowTerminalRead', label: 'Read terminal output', hint: 'The last lines of the terminal you picked, at the Max level only.' },
  { key: 'allowTerminalSend', label: 'Send to terminals', hint: 'Type the prompt into the terminal you pick when you click Send. Off: use Copy instead.' },
  { key: 'saveHistory', label: 'Save history', hint: 'Keep your prompts and enhanced prompts in the History tab, on this machine only.' },
  { key: 'allowEnvKeys', label: 'Use API keys from environment variables', hint: 'OPENAI_API_KEY, ANTHROPIC_API_KEY and the others, when a model has no saved key.' },
  { key: 'allowOnlineModelLists', label: 'Fetch model lists online', hint: "GET /models from your API providers and the public Claude Code settings schema, to keep model menus current. CLI lists are always local." }
]

/** The plugin's issue page, in the browser (Orca asks before opening a site the first time). */
export const ISSUES_URL = 'https://github.com/cattfan/orca-enhance-prompt/issues/new'
