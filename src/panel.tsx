// No build step: Orca strips the types and compiles the JSX when the panel loads.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Checkbox,
  Collapsible,
  derived,
  EmptyState,
  Heading,
  Grid,
  Separator,
  IconButton,
  Input,
  on,
  plugin,
  read,
  RelativeTime,
  Row,
  Select,
  set,
  settings,
  Spinner,
  Stack,
  Switch,
  Tab,
  Tabs,
  Text,
  Textarea,
  update,
  type JsonValue,
  type OrcaNode,
  type PanelContext
} from 'orca'
import { HISTORY_KEY, parseHistory, toJson, type HistoryEntry } from './history'
import {
  CONTEXT_LEVEL_LABELS,
  CONTEXT_LEVELS,
  isContextLevel,
  presetById,
  type ContextItemView,
  type ProfileView
} from './presets'
import { isStyle, STYLE_LABELS, STYLES } from './prompts'
import { t, UI_LANGUAGES, uiLanguageSetting } from './i18n'
import type { AttemptView, ModelsView, ProfileInput } from './protocol'

type Target = { terminalId: string; label: string; agent: string | null }
type Notice = { tone: 'success' | 'danger' | 'warning' | 'neutral'; text: string } | null
type Defaults = {
  style: string
  level: string
  pressEnter: boolean
  fallbackEnabled: boolean
  fallbackOn: string
  outputLanguage: string
  autoEnhanceMode: string
}
type Form = Omit<ProfileInput, 'apiKey'> & { apiKey: string }

// Keyed atoms survive hot reloads; `persist: 'plugin'` ones survive panel runs.
const tab = atom('tab', 'enhance', { persist: 'plugin' })
const draft = atom('draft', '', { persist: 'plugin' })
const result = atom('result', '', { persist: 'plugin' })
const style = atom<string | null>('style', null, { persist: 'plugin' })
const level = atom<string | null>('level', null, { persist: 'plugin' })
const profileChoice = atom('profileChoice', 'auto', { persist: 'plugin' })
/** The model picked for that profile in the composer; '' = the profile's own model. */
const modelChoice = atom('modelChoice', '', { persist: 'plugin' })
/** Per-prompt output language: 'default' uses the setting. */
const outputChoice = atom('outputChoice', 'default', { persist: 'plugin' })
const excluded = atom<string[]>('excluded', [])
const target = atom<string | null>('target', null)
const pressEnter = atom<boolean | null>('pressEnter', null)
const historyRaw = atom<JsonValue>(HISTORY_KEY, [], { persist: 'storage' })
const historyFilter = atom('historyFilter', '')
const form = atom<Form | null>('form', null)
const detected = atom<{ preset: string; label: string; path: string; added: boolean }[]>([])
type Catalog = { models: { id: string; label: string; description?: string; isDefault?: boolean }[]; source: string; fetchedAt: number; error?: string }
/** Model lists by profile id, or 'form' for the add/edit form. */
const catalogs = atom<Record<string, Catalog>>({})
const catalogLoading = atom<Record<string, boolean>>({})
const CUSTOM_MODEL = '__custom__'
/** Select values cannot be empty: this stands for "the CLI's own default model" (stored as ''). */
const CLI_DEFAULT = '__cli_default__'
const toModel = (value: string) => (value === CLI_DEFAULT ? '' : value)
/** The form's model picker is on "Other (type the id)". */
const customModel = atom(false)

const busy = atom<'enhance' | 'preview' | 'send' | 'test' | 'save' | null>(null)
const notice = atom<Notice>(null)
const lastRun = atom<{ model: string; profileName: string; ms: number; attempts: AttemptView[] } | null>('lastRun', null, { persist: 'plugin' })
/** Every context item seen for the current draft, so excluded ones stay listed (unchecked). */
const contextShown = atom<ContextItemView[]>('contextShown', [], { persist: 'plugin' })
const contextNotes = atom<string[]>('contextNotes', [], { persist: 'plugin' })
const targets = atom<Target[]>([])
const models = atom<ModelsView | null>(null)
const defaults = atom<Defaults>({
  style: 'balanced',
  level: 'standard',
  pressEnter: false,
  fallbackEnabled: true,
  fallbackOn: 'any',
  outputLanguage: 'auto',
  autoEnhanceMode: 'off'
})

const history = derived(() => parseHistory(read(historyRaw)))
const filteredHistory = derived(() => {
  const query = read(historyFilter).trim().toLowerCase()
  const list = read(history)
  return query
    ? list.filter((entry) => entry.original.toLowerCase().includes(query) || entry.enhanced.toLowerCase().includes(query))
    : list
})
const effectiveStyle = derived(() => read(style) ?? read(defaults).style)
const effectiveLevel = derived(() => read(level) ?? read(defaults).level)
const effectiveEnter = derived(() => read(pressEnter) ?? read(defaults).pressEnter)
const enabledProfiles = derived(() => (read(models)?.profiles ?? []).filter((profile) => profile.enabled))

let inFlight: AbortController | null = null

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// ---------------------------------------------------------------- data

async function refreshDefaults(): Promise<void> {
  const all = await settings.get().catch(() => ({}) as Record<string, JsonValue>)
  set(defaults, {
    style: typeof all.defaultStyle === 'string' && isStyle(all.defaultStyle) ? all.defaultStyle : 'balanced',
    level: typeof all.contextLevel === 'string' && isContextLevel(all.contextLevel) ? all.contextLevel : 'standard',
    pressEnter: all.sendPressEnter === true,
    fallbackEnabled: all.fallbackEnabled !== false,
    fallbackOn: all.fallbackOn === 'transient' ? 'transient' : 'any',
    outputLanguage: typeof all.outputLanguage === 'string' ? all.outputLanguage : 'auto',
    autoEnhanceMode: typeof all.autoEnhanceMode === 'string' ? all.autoEnhanceMode : 'off'
  })
  set(uiLanguageSetting, typeof all.uiLanguage === 'string' ? all.uiLanguage : 'auto')
}

async function changeUiLanguage(value: string): Promise<void> {
  set(uiLanguageSetting, value)
  await settings.set('uiLanguage', value).catch(() => undefined)
}

const UI_LANGUAGE_LABELS: Record<string, string> = { auto: 'Auto', en: 'EN', vi: 'VI', zh: '中文' }
const OUTPUT_LANGUAGE_LABELS: Record<string, string> = {
  auto: 'Output: same as prompt',
  en: 'Output: English',
  vi: 'Output: Vietnamese',
  zh: 'Output: Chinese'
}

function outputOptions() {
  const fallback = read(defaults).outputLanguage
  const defaultLabel = OUTPUT_LANGUAGE_LABELS[fallback] ? t(OUTPUT_LANGUAGE_LABELS[fallback]) : fallback
  return [
    { value: 'default', label: t('Output: default ({value})', { value: defaultLabel.replace(/^[^:：]+[:：]\s*/, '') }) },
    ...Object.entries(OUTPUT_LANGUAGE_LABELS).map(([value, label]) => ({ value, label: t(label) }))
  ]
}

async function refreshModels(): Promise<void> {
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

async function loadCatalog(
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

function formCatalogInput(current: Form) {
  return {
    preset: current.preset,
    ...(current.id ? { profileId: current.id } : {}),
    baseUrl: current.baseUrl,
    provider: current.provider,
    command: current.command ?? '',
    apiKey: current.apiKey
  }
}

function modelOptions(catalog: Catalog | undefined, current: string) {
  const options = (catalog?.models ?? []).map((model) => ({
    value: model.id,
    label: model.isDefault ? `${model.label} · ${t('your default')}` : model.label
  }))
  if (current && !options.some((option) => option.value === current)) options.unshift({ value: current, label: current })
  return options
}

async function refreshTargets(): Promise<void> {
  try {
    const { targets: list } = await plugin.request('targets.list')
    set(targets, list)
    const current = read(target)
    if (!current || !list.some((item) => item.terminalId === current)) {
      set(target, list.find((item) => item.agent)?.terminalId ?? list[0]?.terminalId ?? null)
    }
  } catch {
    set(targets, [])
  }
}

function showContext(items: ContextItemView[], notes: string[]): void {
  const ex = new Set(read(excluded))
  const keptExcluded = read(contextShown).filter((item) => ex.has(item.id) && !items.some((i) => i.id === item.id))
  set(contextShown, [...items, ...keptExcluded])
  set(contextNotes, notes)
}

// ---------------------------------------------------------------- actions

async function enhanceNow(): Promise<void> {
  const prompt = read(draft).trim()
  if (!prompt || read(busy)) return
  inFlight = new AbortController()
  set(busy, 'enhance')
  set(notice, null)
  try {
    const choice = read(profileChoice)
    const answer = await plugin.request(
      'prompt.enhance',
      {
        prompt,
        style: read(effectiveStyle),
        level: read(effectiveLevel),
        terminalId: read(target),
        profileId: choice === 'auto' ? null : choice,
        ...(choice !== 'auto' && read(modelChoice) ? { model: read(modelChoice) } : {}),
        // Leave the key out (not undefined): request inputs must be plain JSON.
        ...(read(outputChoice) === 'default' ? {} : { language: read(outputChoice) }),
        exclude: read(excluded)
      },
      { timeoutMs: 120_000, signal: inFlight.signal }
    )
    set(result, answer.enhanced)
    set(lastRun, { model: answer.model, profileName: answer.profileName, ms: answer.ms, attempts: answer.attempts })
    showContext(answer.context, answer.notes)
  } catch (error) {
    if (!inFlight?.signal.aborted) set(notice, { tone: 'danger', text: message(error) })
  } finally {
    inFlight = null
    set(busy, null)
  }
}

async function previewContext(): Promise<void> {
  set(busy, 'preview')
  try {
    const answer = await plugin.request(
      'context.preview',
      { prompt: read(draft), level: read(effectiveLevel), terminalId: read(target), exclude: read(excluded) },
      { timeoutMs: 60_000 }
    )
    showContext(answer.context, answer.notes)
    set(notice, { tone: 'neutral', text: t('{count} context items, {chars} chars.', { count: answer.context.length, chars: answer.chars.toLocaleString() }) })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  } finally {
    set(busy, null)
  }
}

function cancel(): void {
  inFlight?.abort()
  set(busy, null)
  set(notice, { tone: 'neutral', text: t('Cancelled.') })
}

function toggleItem(id: string, include: boolean): void {
  update(excluded, (list) => (include ? list.filter((entry) => entry !== id) : [...new Set([...list, id])]))
}

async function send(text: string): Promise<void> {
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

async function copy(text: string): Promise<void> {
  if (!text.trim()) return
  const answer = await plugin.request('prompt.copy', { text }).catch((error) => ({ copied: false, error: message(error) }))
  set(notice, answer.copied ? { tone: 'success', text: t('Copied to clipboard.') } : { tone: 'danger', text: t('Copy failed: {error}', { error: answer.error ?? 'unknown error' }) })
}

function reuse(entry: HistoryEntry): void {
  set(draft, entry.original)
  set(result, entry.enhanced)
  if (isStyle(entry.style)) set(style, entry.style)
  set(tab, 'enhance')
}

function removeEntry(id: string): void {
  update(historyRaw, (list) => parseHistory(list).filter((entry) => entry.id !== id).map(toJson))
}

async function setSetting(key: string, value: JsonValue): Promise<void> {
  try {
    await settings.set(key, value)
    await refreshDefaults()
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

// ---- model profiles

function openForm(profile?: ProfileView): void {
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

async function detectClis(): Promise<void> {
  try {
    const { found } = await plugin.request('models.detect')
    set(detected, found)
  } catch {
    set(detected, [])
  }
}

/** One click: adds a detected subscription CLI as a model with its defaults. */
async function addDetected(presetId: string, path: string): Promise<void> {
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

function applyPreset(id: string): void {
  const preset = presetById(id)
  update(form, (current) =>
    current
      ? { ...current, preset: preset.id, provider: preset.provider, baseUrl: preset.baseUrl, model: preset.model, command: '', args: '', name: current.id ? current.name : preset.label }
      : current
  )
  const current = read(form)
  if (current) void loadCatalog('form', formCatalogInput(current))
}

const patchForm = (patch: Partial<Form>) => update(form, (current) => (current ? { ...current, ...patch } : current))

async function saveForm(): Promise<void> {
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

async function modelAction(action: { remove: string } | { move: string; direction: 'up' | 'down' }): Promise<void> {
  try {
    const next =
      'remove' in action
        ? await plugin.request('models.delete', { id: action.remove })
        : await plugin.request('models.move', { id: action.move, direction: action.direction })
    set(models, next)
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

async function toggleProfile(profile: ProfileView, enabled: boolean): Promise<void> {
  try {
    set(models, await plugin.request('models.save', { ...profile, enabled }))
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

async function testProfile(id: string): Promise<void> {
  set(busy, 'test')
  try {
    const answer = await plugin.request('models.test', { id }, { timeoutMs: 40_000 })
    set(notice, { tone: answer.ok ? 'success' : 'danger', text: answer.ok ? `${answer.message} (${answer.ms} ms)` : answer.message })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  } finally {
    set(busy, null)
  }
}

async function setRoles(patch: { hookProfileId?: string | null; selectorProfileId?: string | null }): Promise<void> {
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

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    settings.onDidChange(() => void refreshDefaults()),
    on('workspace.changed', () => void refreshTargets()),
    on('agent.status.changed', () => void refreshTargets()),
    plugin.on('hook.enhanced', ({ agent, mode, model }) =>
      set(notice, { tone: 'neutral', text: t('Auto-enhanced ({mode}) a prompt for {agent}.', { mode: model ? `${mode}, ${model}` : mode, agent: agent ?? t('an agent') }) })
    )
  )
  void refreshDefaults()
  void refreshModels()
  void refreshTargets()
  void detectClis()
}

// ---------------------------------------------------------------- view

const styleOptions = () => STYLES.map((value) => ({ value, label: t(STYLE_LABELS[value]) }))
const levelOptions = () => CONTEXT_LEVELS.map((value) => ({ value, label: t(CONTEXT_LEVEL_LABELS[value]) }))
const KEY_LABEL: Record<ProfileView['keySource'], string> = {
  secret: 'key saved',
  env: 'key from env',
  none: 'no key',
  'not-needed': 'local',
  subscription: 'subscription'
}

function NoticeBar() {
  const current = read(notice)
  if (!current) return null
  return (
    <Callout tone={current.tone === 'neutral' ? undefined : current.tone}>
      <Row justify="between" gap="xs">
        <Text size="sm">{current.text}</Text>
        <IconButton icon="close" label={t('Dismiss')} size="sm" variant="ghost" onPress={() => set(notice, null)} />
      </Row>
    </Callout>
  )
}

function TargetPicker() {
  const list = read(targets)
  return (
    <Row gap="xs">
      <Select
        label={t('Send to')}
        labelHidden
        placeholder={list.length === 0 ? t('No terminals in this workspace') : t('Choose a terminal')}
        value={read(target) ?? undefined}
        options={list.map((item) => ({ value: item.terminalId, label: item.label }))}
        onChange={(value) => set(target, value)}
        disabled={list.length === 0}
      />
      <IconButton icon="refresh" label={t('Refresh terminals')} variant="ghost" onPress={() => void refreshTargets()} />
    </Row>
  )
}

function ContextPanel() {
  const shown = read(contextShown)
  const notes = read(contextNotes)
  if (shown.length === 0 && notes.length === 0) return null
  const ex = new Set(read(excluded))
  const included = shown.filter((item) => !ex.has(item.id))
  const chars = included.reduce((sum, item) => sum + item.chars, 0)
  return (
    <Collapsible title={t('Context used: {count} items, {chars} chars', { count: included.length, chars: chars.toLocaleString() })} description={t('Untick to leave an item out next time')}>
      <Stack gap="xs">
        {shown.map((item) => (
          <Checkbox
            key={item.id}
            label={item.label}
            description={`${t('{kind} · {chars} chars', { kind: item.kind, chars: item.chars.toLocaleString() })}${item.note ? ` · ${item.note}` : ''}`}
            checked={!ex.has(item.id)}
            onChange={(checked) => toggleItem(item.id, checked)}
          />
        ))}
        {notes.map((note) => (
          <Text key={note} muted size="xs">
            {note}
          </Text>
        ))}
      </Stack>
    </Collapsible>
  )
}

function RunInfo() {
  const run = read(lastRun)
  if (!run) return null
  const failed = run.attempts.filter((attempt) => !attempt.ok)
  return (
    <Stack gap="none">
      <Text muted size="xs">
        {t('{profile} · {model} · {seconds} s · edit freely before sending', { profile: run.profileName, model: run.model, seconds: (run.ms / 1000).toFixed(1) })}
      </Text>
      {failed.length > 0 ? (
        <Text tone="warning" size="xs">
          {t('Fell back after: {list}', { list: failed.map((attempt) => `${attempt.name} (${attempt.error ?? 'failed'})`).join(', ') })}
        </Text>
      ) : null}
    </Stack>
  )
}

/** The word before ":" in a level label: "Deep: + git…" → "Deep". */
const shortLabel = (label: string) => label.split(/[:：]/)[0].trim()

/** Style, context, output and model, folded under a one-line summary of the current choice. */
function PromptOptions() {
  const styleValue = read(effectiveStyle)
  const levelValue = read(effectiveLevel)
  const output = outputOptions().find((option) => option.value === read(outputChoice))
  const summary = [
    t(STYLE_LABELS[isStyle(styleValue) ? styleValue : 'balanced']),
    shortLabel(t(CONTEXT_LEVEL_LABELS[isContextLevel(levelValue) ? levelValue : 'standard'])),
    read(outputChoice) !== 'default' && output ? output.label.replace(/^[^:：]+[:：]\s*/, '') : ''
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Collapsible title={summary} description={t('Style, context and output language')}>
      <Grid columns={2} gap="sm">
        <Select label={t('Style')} value={styleValue} options={styleOptions()} onChange={(value) => set(style, value)} />
        <Select label={t('Context')} value={levelValue} options={levelOptions()} onChange={(value) => set(level, value)} />
        <Select label={t('Output language')} value={read(outputChoice)} options={outputOptions()} onChange={(value) => set(outputChoice, value)} />
      </Grid>
    </Collapsible>
  )
}

const MODEL_SEP = '|'
const PROFILE_DEFAULT = '__profile_default__'

/** "sonnet: Sonnet, newest" -> "Sonnet, newest"; display names stay as they are. */
const modelDisplay = (label: string) => (label.includes(': ') ? label.slice(label.indexOf(': ') + 2) : label)

/** Every model of every enabled profile, from its live list, plus Auto. */
function modelMenu() {
  const options: { value: string; label: string }[] = [
    { value: 'auto', label: read(defaults).fallbackEnabled ? t('Auto (chain with fallback)') : t('Auto (first model)') }
  ]
  for (const profile of read(enabledProfiles)) {
    const catalog = read(catalogs)[profile.id]
    const listed = catalog?.models ?? []
    const seen = new Set<string>()
    const add = (id: string, label: string) => {
      if (seen.has(id)) return
      seen.add(id)
      const saved = id !== '' && id === profile.model
      options.push({
        value: `${profile.id}${MODEL_SEP}${id || PROFILE_DEFAULT}`,
        label: `${profile.name} · ${label}${saved ? ` · ${t('default')}` : ''}`
      })
    }
    if (profile.provider === 'cli' && !profile.model) add('', t('CLI default'))
    else if (profile.model && !listed.some((model) => model.id === profile.model)) add(profile.model, profile.model)
    for (const model of listed) add(model.id, modelDisplay(model.label))
  }
  return options
}

/** Short name of the model picked in the composer, for the header badge. */
function pickedModelLabel(): string {
  if (read(profileChoice) === 'auto') return t('Auto')
  const option = modelMenu().find((entry) => entry.value === currentModelValue())
  return option?.label.split(' · ')[1] ?? t('Auto')
}

function currentModelValue(): string {
  const choice = read(profileChoice)
  if (choice === 'auto') return 'auto'
  const profile = read(enabledProfiles).find((entry) => entry.id === choice)
  if (!profile) return 'auto'
  const model = read(modelChoice) || profile.model
  return `${choice}${MODEL_SEP}${model || PROFILE_DEFAULT}`
}

function pickModel(value: string): void {
  if (value === 'auto') {
    set(profileChoice, 'auto')
    set(modelChoice, '')
    return
  }
  const [profileId, model] = value.split(MODEL_SEP)
  const profile = read(enabledProfiles).find((entry) => entry.id === profileId)
  set(profileChoice, profileId)
  // The profile's own model is stored as '' so a later change to the profile follows through.
  set(modelChoice, model === PROFILE_DEFAULT || model === profile?.model ? '' : model)
}

/** The model menu in the composer: every model you can use right now, one click away. */
function ComposerModelPicker() {
  const options = modelMenu()
  const value = currentModelValue()
  return (
    <Select
      label={t('Model')}
      labelHidden
      value={options.some((option) => option.value === value) ? value : 'auto'}
      options={options}
      onChange={pickModel}
    />
  )
}

function ResultCard({ output }: { output: string }) {
  const working = read(busy)
  return (
    <Box gap="sm" padding="md" border radius="lg">
      <Row justify="between">
        <Text weight="semibold">{t('Enhanced prompt')}</Text>
        <Row gap="none">
          <IconButton icon="copy" label={t('Copy')} size="sm" variant="ghost" onPress={() => void copy(output)} />
          <IconButton icon="delete" label={t('Clear')} size="sm" variant="ghost" onPress={() => set(result, '')} />
        </Row>
      </Row>
      <Textarea label={t('Enhanced prompt')} labelHidden rows={12} value={output} onChange={(value) => set(result, value)} onSubmit={(value) => void send(value)} />
      <RunInfo />
      <Separator />
      <Text weight="semibold" size="sm">
        {t('Send to')}
      </Text>
      <TargetPicker />
      <Switch label={t('Press Enter after sending')} checked={read(effectiveEnter)} onChange={(value) => set(pressEnter, value)} />
      <Row gap="xs" wrap>
        <Button variant="solid" icon="play" onPress={() => void send(output)} disabled={!read(target) || working !== null}>
          {t('Send to agent')}
        </Button>
        <Button
          variant="outline"
          icon="refresh"
          tooltip={t('Use the enhanced prompt as the new input')}
          onPress={() => {
            set(draft, output)
            set(result, '')
          }}
        >
          {t('Refine')}
        </Button>
      </Row>
    </Box>
  )
}

function EnhanceTab() {
  const working = read(busy)
  const text = read(draft)
  const output = read(result)
  const view = read(models)
  const profiles = read(enabledProfiles)
  const noModel = view !== null && profiles.length === 0
  const allKeyless = profiles.length > 0 && profiles.every((p) => p.keySource === 'none')
  return (
    <Stack gap="md">
      {noModel || allKeyless ? (
        <Callout tone="warning" title={noModel ? t('No model yet') : t('No API key yet')}>
          <Stack gap="xs">
            <Text size="sm">{t('Add a model and its API key in the Models tab (keys are stored encrypted by Orca).')}</Text>
            <Row>
              <Button size="sm" variant="outline" icon="settings" onPress={() => set(tab, 'models')}>
                {t('Open Models')}
              </Button>
            </Row>
          </Stack>
        </Callout>
      ) : null}
      <Textarea
        label={t('Your prompt')}
        placeholder={t('Describe what you want the agent to do…')}
        rows={5}
        value={text}
        onChange={(value) => set(draft, value)}
        onSubmit={() => void enhanceNow()}
      />
      <PromptOptions />
      <Row gap="xs" wrap>
        <ComposerModelPicker />
        {working === 'enhance' ? (
          <Row gap="xs">
            <Spinner label={t('Enhancing')} />
            <Button variant="ghost" icon="stop" onPress={cancel}>
              {t('Cancel')}
            </Button>
          </Row>
        ) : (
          <Button variant="solid" icon="lightbulb" tooltip={t('Ctrl+Enter (⌘Enter on macOS)')} onPress={() => void enhanceNow()} disabled={!text.trim() || working !== null}>
            {t('Enhance')}
          </Button>
        )}
        <IconButton
          icon="search"
          label={working === 'preview' ? t('Gathering…') : t('Preview context')}
          variant="ghost"
          onPress={() => void previewContext()}
          disabled={working !== null}
        />
      </Row>
      <NoticeBar />
      <ContextPanel />
      {output ? (
        <ResultCard output={output} />
      ) : (
        <EmptyState
          icon="lightbulb"
          title={t('Your enhanced prompt appears here')}
          description={t('Nothing reaches the agent until you click Send.')}
        >
          {text.trim() && read(target) ? (
            <Button variant="ghost" size="sm" icon="play" onPress={() => void send(text)} disabled={working !== null}>
              {t('Send as is')}
            </Button>
          ) : null}
        </EmptyState>
      )}
    </Stack>
  )
}

function HistoryTab() {
  const all = read(history)
  const list = read(filteredHistory)
  if (all.length === 0) {
    return <EmptyState icon="book" title={t('No history yet')} description={t('Enhanced prompts show up here.')} />
  }
  return (
    <Stack gap="sm">
      <Input label={t('Search history')} labelHidden type="search" placeholder={t('Search history')} value={read(historyFilter)} onChange={(value) => set(historyFilter, value)} />
      <Stack gap="xs">
        {list.map((entry) => (
          <Box key={entry.id} gap="xs" padding="sm" border radius="md">
            <Text weight="medium" truncate>
              {entry.original.split('\n')[0].slice(0, 160)}
            </Text>
            <Row gap="xs" justify="between">
              <Text muted size="xs">
                {t(STYLE_LABELS[isStyle(entry.style) ? entry.style : 'balanced'])} · {entry.model}
                {entry.source === 'hook' ? ` · ${t('auto')}` : ''} · <RelativeTime at={entry.at} />
              </Text>
              <Row gap="xs">
                <IconButton icon="edit" label={t('Open in Enhance tab')} size="sm" variant="ghost" onPress={() => reuse(entry)} />
                <IconButton icon="copy" label={t('Copy enhanced prompt')} size="sm" variant="ghost" onPress={() => void copy(entry.enhanced)} />
                <IconButton icon="delete" label={t('Delete')} size="sm" variant="ghost" onPress={() => removeEntry(entry.id)} />
              </Row>
            </Row>
          </Box>
        ))}
      </Stack>
      <Row justify="between">
        <Text muted size="xs">
          {t('{shown} of {total}', { shown: list.length, total: all.length })}
        </Text>
        <Button variant="ghost" tone="danger" size="sm" icon="delete" onPress={() => set(historyRaw, [])}>
          {t('Clear history')}
        </Button>
      </Row>
    </Stack>
  )
}

/** A list of the models the CLI or API offers now, with "Other" to type any id. */
function ModelPicker({ current }: { current: Form }) {
  const catalog = read(catalogs).form
  const loading = read(catalogLoading).form === true
  const cli = current.provider === 'cli'
  const options = modelOptions(catalog, current.model)
  const inList = options.some((option) => option.value === current.model)
  const typing = read(customModel) || (current.model !== '' && !inList)
  const label = cli ? t('Model (optional)') : t('Model')
  return (
    <Stack gap="xs">
      <Row gap="xs">
        {options.length > 0 ? (
          <Select
            label={label}
            placeholder={cli ? t('CLI default') : t('Choose a model')}
            value={typing ? CUSTOM_MODEL : current.model || (cli ? CLI_DEFAULT : undefined)}
            options={[...(cli ? [{ value: CLI_DEFAULT, label: t('CLI default') }] : []), ...options, { value: CUSTOM_MODEL, label: t('Other (type the id)…') }]}
            onChange={(value) => {
              set(customModel, value === CUSTOM_MODEL)
              if (value !== CUSTOM_MODEL) patchForm({ model: toModel(value) })
            }}
          />
        ) : (
          <Input
            label={label}
            placeholder={presetById(current.preset).model || (cli ? t('CLI default') : 'model-id')}
            value={current.model}
            onChange={(value) => patchForm({ model: value })}
          />
        )}
        <IconButton
          icon="refresh"
          label={t('Refresh model list')}
          variant="ghost"
          disabled={loading}
          onPress={() => void loadCatalog('form', formCatalogInput(current), true)}
        />
      </Row>
      {options.length > 0 && typing ? (
        <Input label={t('Model id')} labelHidden placeholder="model-id" value={current.model} onChange={(value) => patchForm({ model: value })} />
      ) : null}
      <Text muted size="xs">
        {loading
          ? t('Loading the model list…')
          : catalog?.error
            ? t('Could not load the list ({error}). Type the model id.', { error: catalog.error })
            : catalog && catalog.models.length > 0
              ? t('{count} models from {source}, refreshed daily.', { count: catalog.models.length, source: catalog.source })
              : cli
                ? t('Uses the model set in the CLI itself.')
                : t('Add the API key to list the models.')}
      </Text>
    </Stack>
  )
}

function ProfileForm() {
  const current = read(form)
  const view = read(models)
  if (!current || !view) return null
  const custom = current.preset === 'custom'
  const cli = current.provider === 'cli'
  const editing = Boolean(current.id)
  const keyHint = editing
    ? t('Leave empty to keep the saved key')
    : presetById(current.preset).env
      ? t('Or set {env}', { env: presetById(current.preset).env })
      : t('Not needed for local servers')
  return (
    <Box gap="sm" padding="md" border="accent" radius="md">
      <Text weight="semibold">{editing ? t('Edit {name}', { name: current.name }) : t('Add a model')}</Text>
      <Select label={t('Preset')} value={current.preset} options={view.presets.map((preset) => ({ value: preset.id, label: preset.label }))} onChange={applyPreset} />
      <Input label={t('Name')} value={current.name} onChange={(value) => patchForm({ name: value })} />
      {custom ? (
        <Select
          label={t('API format')}
          value={current.provider}
          options={[
            { value: 'openai', label: 'OpenAI-compatible (/chat/completions)' },
            { value: 'anthropic', label: 'Anthropic (/v1/messages)' }
          ]}
          onChange={(value) => patchForm({ provider: value === 'anthropic' ? 'anthropic' : 'openai' })}
        />
      ) : null}
      {cli ? (
        <Stack gap="sm">
          <Row gap="xs">
            <Text muted size="xs">
              {t('Uses your subscription')}
            </Text>
            <Hint text={t('Runs the CLI already signed in on this machine, so it uses your subscription instead of an API key. Slower than an API (a few seconds per call), so it is skipped by auto-enhance.')} />
          </Row>
          <Input
            label={t('Command')}
            placeholder={current.preset === 'custom-cli' ? 'my-llm' : t('Found on PATH automatically; or a full path')}
            value={current.command ?? ''}
            onChange={(value) => patchForm({ command: value })}
          />
          {current.preset === 'custom-cli' ? (
            <Input label={t('Arguments')} placeholder="run --quiet" value={current.args ?? ''} onChange={(value) => patchForm({ args: value })} />
          ) : null}
        </Stack>
      ) : (
        <Input label={t('Base URL')} placeholder="https://…" value={current.baseUrl} onChange={(value) => patchForm({ baseUrl: value })} />
      )}
      <ModelPicker current={current} />
      {cli ? null : (
        <Input label={t('API key')} type="password" placeholder={keyHint} value={current.apiKey} onChange={(value) => patchForm({ apiKey: value })} />
      )}
      {cli ? null : <Row gap="xs" wrap>
        <Select
          label={t('Temperature')}
          value={String(current.temperature)}
          options={['0', '0.2', '0.3', '0.5', '0.7', '1'].map((value) => ({ value, label: t('Temperature {value}', { value }) }))}
          onChange={(value) => patchForm({ temperature: Number(value) })}
        />
        <Select
          label={t('Max tokens')}
          value={String(current.maxTokens)}
          options={['1000', '2000', '4000', '8000', '16000'].map((value) => ({ value, label: t('{value} tokens', { value }) }))}
          onChange={(value) => patchForm({ maxTokens: Number(value) })}
        />
      </Row>}
      <Row gap="xs">
        <Button
          icon="check"
          onPress={() => void saveForm()}
          disabled={
            !current.name.trim() ||
            (cli ? current.preset === 'custom-cli' && !current.command?.trim() : !current.baseUrl.trim()) ||
            read(busy) === 'save'
          }
        >
          {t('Save')}
        </Button>
        <Button variant="ghost" onPress={() => set(form, null)}>
          {t('Cancel')}
        </Button>
      </Row>
    </Box>
  )
}

/** The profile's model, switchable in place from the live list. */
function QuickModel({ profile, fromEnv }: { profile: ProfileView; fromEnv: boolean }) {
  const catalog = read(catalogs)[profile.id]
  const where = profile.provider === 'cli' ? `${presetById(profile.preset).label.replace(/ \(.*\)$/, '')} CLI` : profile.baseUrl
  const options = modelOptions(catalog, profile.model)
  if (fromEnv || options.length < 2) {
    return (
      <Text muted size="xs" truncate>
        {`${profile.model || t('CLI default')} · ${where}`}
      </Text>
    )
  }
  return (
    <Row gap="xs">
      <Select
        label={t('Model')}
        labelHidden
        value={profile.model || CLI_DEFAULT}
        options={[...(profile.provider === 'cli' ? [{ value: CLI_DEFAULT, label: t('CLI default') }] : []), ...options]}
        onChange={(value) => void switchModel(profile, toModel(value))}
      />
      <Text muted size="xs" truncate>
        {where}
      </Text>
    </Row>
  )
}

async function switchModel(profile: ProfileView, model: string): Promise<void> {
  try {
    set(models, await plugin.request('models.save', { ...profile, model }))
    set(notice, { tone: 'success', text: t('{name} now uses {model}.', { name: profile.name, model: model || t('CLI default') }) })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

function ProfileCard({ profile, index, count, fromEnv }: { profile: ProfileView; index: number; count: number; fromEnv: boolean }) {
  return (
    <Box gap="xs" padding="sm" border radius="md" background={profile.enabled ? 'none' : 'muted'}>
      <Row justify="between" gap="xs">
        <Row gap="xs">
          <Badge tone={profile.enabled ? 'accent' : 'neutral'}>{index + 1}</Badge>
          <Text weight="medium" truncate>
            {profile.name}
          </Text>
        </Row>
        <Badge tone={profile.keySource === 'none' ? 'warning' : 'success'}>{t(KEY_LABEL[profile.keySource])}</Badge>
      </Row>
      <QuickModel profile={profile} fromEnv={fromEnv} />
      <Row justify="between" gap="xs">
        {fromEnv ? (
          <Text muted size="xs">{t('From environment')}</Text>
        ) : (
          <Switch label={t('Enabled')} checked={profile.enabled} onChange={(value) => void toggleProfile(profile, value)} />
        )}
        <Row gap="none">
          <IconButton icon="check" label={t('Test')} size="sm" variant="ghost" onPress={() => void testProfile(profile.id)} disabled={read(busy) === 'test'} />
          {fromEnv ? null : (
            <Row gap="none">
              <IconButton icon="collapse" label={t('Move up (try earlier)')} size="sm" variant="ghost" disabled={index === 0} onPress={() => void modelAction({ move: profile.id, direction: 'up' })} />
              <IconButton icon="expand" label={t('Move down (try later)')} size="sm" variant="ghost" disabled={index === count - 1} onPress={() => void modelAction({ move: profile.id, direction: 'down' })} />
              <IconButton icon="edit" label={t('Edit')} size="sm" variant="ghost" onPress={() => openForm(profile)} />
              <IconButton icon="delete" label={t('Delete')} size="sm" variant="ghost" tone="danger" onPress={() => void modelAction({ remove: profile.id })} />
            </Row>
          )}
        </Row>
      </Row>
    </Box>
  )
}

/** Subscription CLIs found on this machine that are not added yet: one click to use them. */
function SubscriptionCallout() {
  const available = read(detected).filter((entry) => !entry.added)
  if (available.length === 0) return null
  return (
    <Callout tone="success" title={t('Use your subscription, no API key')} icon="agent">
      <Stack gap="xs">
        <Text size="sm">{t('Found on this machine. Uses the account the CLI is signed in with.')}</Text>
        <Row gap="xs" wrap>
          {available.map((entry) => (
            <Button key={entry.preset} size="sm" variant="outline" icon="add" tooltip={entry.path} onPress={() => void addDetected(entry.preset, entry.path)}>
              {entry.label}
            </Button>
          ))}
        </Row>
      </Stack>
    </Callout>
  )
}

/** Help text behind an info icon: hover shows it, a press shows it as a notice (touch, keyboard). */
function Hint({ text }: { text: string }) {
  return <IconButton icon="info" label={text} size="sm" variant="ghost" onPress={() => set(notice, { tone: 'neutral', text })} />
}

function Section({ title, hint, children }: { title: string; hint?: string; children?: OrcaNode }) {
  return (
    <Stack gap="sm">
      <Row gap="xs">
        <Heading level={3}>{title}</Heading>
        {hint ? <Hint text={hint} /> : null}
      </Row>
      {children}
    </Stack>
  )
}

function ModelsTab() {
  const view = read(models)
  const prefs = read(defaults)
  if (!view) return <Spinner label={t('Loading')} />
  const roleOptions = [
    { value: 'chain', label: t('Same as the chain') },
    ...view.profiles.map((profile) => ({ value: profile.id, label: `${profile.name} · ${profile.model || t('CLI default')}` }))
  ]
  return (
    <Stack gap="lg">
      <Section title={t('Your models')} hint={t('Models are tried top to bottom. Disabled models are skipped.')}>
        {view.fromEnv && view.profiles.length > 0 ? (
          <Callout tone="accent" title={t('Using API keys from your environment')}>
            <Text size="sm">{t('Add a model below to customize; then only your saved models are used.')}</Text>
          </Callout>
        ) : null}
        <SubscriptionCallout />
        {view.profiles.length === 0 && !read(form) ? (
          <EmptyState
            icon="agent"
            title={t('No models yet')}
            description={t('Use a subscription CLI above, or add OpenAI, Anthropic, OpenRouter, Gemini, Groq, DeepSeek, Mistral, Ollama, LM Studio or any OpenAI-compatible endpoint.')}
          />
        ) : null}
        <Stack gap="xs">
          {view.profiles.map((profile, index) => (
            <ProfileCard key={profile.id} profile={profile} index={index} count={view.profiles.length} fromEnv={view.fromEnv} />
          ))}
        </Stack>
        <NoticeBar />
        {read(form) ? (
          <ProfileForm />
        ) : (
          <Row>
            <Button variant="outline" icon="add" onPress={() => openForm()}>
              {t('Add model')}
            </Button>
          </Row>
        )}
      </Section>
      <Separator />
      <Section title={t('Fallback')}>
        <Switch label={t('Fallback to the next model when one fails')} checked={prefs.fallbackEnabled} onChange={(value) => void setSetting('fallbackEnabled', value)} />
        <Select
          label={t('Fall back on')}
          value={prefs.fallbackOn}
          disabled={!prefs.fallbackEnabled}
          options={[
            { value: 'any', label: t('Any error (bad key, unknown model, network…)') },
            { value: 'transient', label: t('Only network, timeout, rate limit, 5xx') }
          ]}
          onChange={(value) => void setSetting('fallbackOn', value)}
        />
      </Section>
      <Separator />
      <Section
        title={t('Auto-enhance')}
        hint={t('Launch, task and orchestration prompts. Prompts you type yourself are never changed. The text for Rules is in Settings → Plugins → Enhance Prompt.')}
      >
        <Select
          label={t('Auto-enhance prompts Orca sends to agents')}
          labelHidden
          value={prefs.autoEnhanceMode}
          options={[
            { value: 'off', label: t('Off') },
            { value: 'rules', label: t('Rules: append your text') },
            { value: 'ai', label: t('AI rewrite (fast API model, 2 s limit)') }
          ]}
          onChange={(value) => void setSetting('autoEnhanceMode', value)}
        />
        {view.profiles.length > 1 && !view.fromEnv ? (
          <Select
            label={t('Auto-enhance hook model (needs to answer in under 2 s)')}
            value={view.hookProfileId ?? 'chain'}
            options={roleOptions}
            onChange={(value) => void setRoles({ hookProfileId: value === 'chain' ? null : value })}
          />
        ) : null}
      </Section>
      {view.profiles.length > 1 && !view.fromEnv ? (
        <Stack gap="lg">
          <Separator />
          <Section title={t('Max context level')}>
            <Select
              label={t('File picker model (Max context level)')}
              value={view.selectorProfileId ?? 'chain'}
              options={roleOptions}
              onChange={(value) => void setRoles({ selectorProfileId: value === 'chain' ? null : value })}
            />
          </Section>
        </Stack>
      ) : null}
      <Row gap="xs" justify="end">
        <Text muted size="xs">
          {t('More settings and privacy')}
        </Text>
        <Hint text={t('Style, language, context level, exclusions and auto-enhance: Settings → Plugins → Enhance Prompt. Prompts and the context you choose go only to the endpoints above; .env files, keys and credentials are never read.')} />
      </Row>
    </Stack>
  )
}

export default function Panel() {
  const view = read(models)
  const first = read(enabledProfiles)[0]
  return (
    <Box gap="md">
      <Row justify="between">
        <Text weight="semibold">Enhance Prompt</Text>
        <Row gap="xs">
          {view ? (
            <Badge tone={first && first.keySource !== 'none' ? 'accent' : 'warning'}>
              {first ? pickedModelLabel() : t('no model')}
            </Badge>
          ) : null}
          <Select
            label={t('Language')}
            labelHidden
            value={read(uiLanguageSetting)}
            options={UI_LANGUAGES.map((value) => ({ value, label: UI_LANGUAGE_LABELS[value] }))}
            onChange={(value) => void changeUiLanguage(value)}
          />
        </Row>
      </Row>
      <Tabs label="Enhance Prompt" value={read(tab)} onChange={(value) => set(tab, value)}>
        <Tab value="enhance" label={t('Enhance')} icon="lightbulb">
          <EnhanceTab />
        </Tab>
        <Tab value="history" label={t('History ({count})', { count: read(history).length })} icon="book">
          <HistoryTab />
        </Tab>
        <Tab value="models" label={t('Models ({count})', { count: view?.profiles.length ?? 0 })} icon="agent">
          <ModelsTab />
        </Tab>
      </Tabs>
    </Box>
  )
}
