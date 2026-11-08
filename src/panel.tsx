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
import type { AttemptView, ModelsView, ProfileInput } from './protocol'

type Target = { terminalId: string; label: string; agent: string | null }
type Notice = { tone: 'success' | 'danger' | 'warning' | 'neutral'; text: string } | null
type Defaults = { style: string; level: string; pressEnter: boolean; fallbackEnabled: boolean; fallbackOn: string }
type Form = Omit<ProfileInput, 'apiKey'> & { apiKey: string }

// Keyed atoms survive hot reloads; `persist: 'plugin'` ones survive panel runs.
const tab = atom('tab', 'enhance')
const draft = atom('draft', '', { persist: 'plugin' })
const result = atom('result', '', { persist: 'plugin' })
const style = atom<string | null>('style', null, { persist: 'plugin' })
const level = atom<string | null>('level', null, { persist: 'plugin' })
const profileChoice = atom('profileChoice', 'auto', { persist: 'plugin' })
const excluded = atom<string[]>('excluded', [])
const target = atom<string | null>('target', null)
const pressEnter = atom<boolean | null>('pressEnter', null)
const historyRaw = atom<JsonValue>(HISTORY_KEY, [], { persist: 'storage' })
const historyFilter = atom('historyFilter', '')
const form = atom<Form | null>('form', null)

const busy = atom<'enhance' | 'preview' | 'send' | 'test' | 'save' | null>(null)
const notice = atom<Notice>(null)
const lastRun = atom<{ model: string; profileName: string; ms: number; attempts: AttemptView[] } | null>('lastRun', null)
/** Every context item seen for the current draft, so excluded ones stay listed (unchecked). */
const contextShown = atom<ContextItemView[]>('contextShown', [])
const contextNotes = atom<string[]>('contextNotes', [])
const targets = atom<Target[]>([])
const models = atom<ModelsView | null>(null)
const defaults = atom<Defaults>({ style: 'balanced', level: 'standard', pressEnter: false, fallbackEnabled: true, fallbackOn: 'any' })

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
    fallbackOn: all.fallbackOn === 'transient' ? 'transient' : 'any'
  })
}

async function refreshModels(): Promise<void> {
  try {
    set(models, await plugin.request('models.get'))
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
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
    set(notice, { tone: 'neutral', text: `${answer.context.length} context items, ${answer.chars.toLocaleString()} chars.` })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  } finally {
    set(busy, null)
  }
}

function cancel(): void {
  inFlight?.abort()
  set(busy, null)
  set(notice, { tone: 'neutral', text: 'Cancelled.' })
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
    set(notice, accepted ? { tone: 'success', text: `Sent to ${label}.` } : { tone: 'warning', text: `${label} did not accept the text.` })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  } finally {
    set(busy, null)
  }
}

async function copy(text: string): Promise<void> {
  if (!text.trim()) return
  const answer = await plugin.request('prompt.copy', { text }).catch((error) => ({ copied: false, error: message(error) }))
  set(notice, answer.copied ? { tone: 'success', text: 'Copied to clipboard.' } : { tone: 'danger', text: `Copy failed: ${answer.error ?? 'unknown error'}` })
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
      apiKey: ''
    })
  } else {
    const preset = presetById('openai')
    set(form, { name: preset.label, preset: preset.id, provider: preset.provider, baseUrl: preset.baseUrl, model: preset.model, temperature: 0.3, maxTokens: 2000, enabled: true, apiKey: '' })
  }
}

function applyPreset(id: string): void {
  const preset = presetById(id)
  update(form, (current) =>
    current
      ? { ...current, preset: preset.id, provider: preset.provider, baseUrl: preset.baseUrl, model: preset.model, name: current.id ? current.name : preset.label }
      : current
  )
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
    set(notice, { tone: 'success', text: `Saved ${current.name}.` })
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
      set(notice, { tone: 'neutral', text: `Auto-enhanced (${mode}${model ? `, ${model}` : ''}) a prompt for ${agent ?? 'an agent'}.` })
    )
  )
  void refreshDefaults()
  void refreshModels()
  void refreshTargets()
}

// ---------------------------------------------------------------- view

const styleOptions = STYLES.map((value) => ({ value, label: STYLE_LABELS[value] }))
const levelOptions = CONTEXT_LEVELS.map((value) => ({ value, label: CONTEXT_LEVEL_LABELS[value] }))
const KEY_LABEL: Record<ProfileView['keySource'], string> = { secret: 'key saved', env: 'key from env', none: 'no key', 'not-needed': 'local' }

function NoticeBar() {
  const current = read(notice)
  if (!current) return null
  return (
    <Callout tone={current.tone === 'neutral' ? undefined : current.tone}>
      <Row justify="between" gap="xs">
        <Text size="sm">{current.text}</Text>
        <IconButton icon="close" label="Dismiss" size="sm" variant="ghost" onPress={() => set(notice, null)} />
      </Row>
    </Callout>
  )
}

function TargetPicker() {
  const list = read(targets)
  return (
    <Row gap="xs">
      <Select
        label="Send to"
        labelHidden
        placeholder={list.length === 0 ? 'No terminals in this workspace' : 'Choose a terminal'}
        value={read(target) ?? undefined}
        options={list.map((item) => ({ value: item.terminalId, label: item.label }))}
        onChange={(value) => set(target, value)}
        disabled={list.length === 0}
      />
      <IconButton icon="refresh" label="Refresh terminals" variant="ghost" onPress={() => void refreshTargets()} />
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
    <Collapsible title={`Context used: ${included.length} items, ${chars.toLocaleString()} chars`} description="Untick to leave an item out next time">
      <Stack gap="xs">
        {shown.map((item) => (
          <Checkbox
            key={item.id}
            label={item.label}
            description={`${item.kind} · ${item.chars.toLocaleString()} chars${item.note ? ` · ${item.note}` : ''}`}
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
        {run.profileName} · {run.model} · {(run.ms / 1000).toFixed(1)} s · edit freely before sending
      </Text>
      {failed.length > 0 ? (
        <Text tone="warning" size="xs">
          Fell back after: {failed.map((attempt) => `${attempt.name} (${attempt.error ?? 'failed'})`).join(', ')}
        </Text>
      ) : null}
    </Stack>
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
        <Callout tone="warning" title={noModel ? 'No model yet' : 'No API key yet'}>
          <Stack gap="xs">
            <Text size="sm">Add a model and its API key in the Models tab (keys are stored encrypted by Orca).</Text>
            <Row>
              <Button size="sm" variant="outline" icon="settings" onPress={() => set(tab, 'models')}>
                Open Models
              </Button>
            </Row>
          </Stack>
        </Callout>
      ) : null}
      <Textarea
        label="Your prompt"
        placeholder="Describe what you want the agent to do… (Ctrl/Cmd+Enter to enhance)"
        rows={6}
        value={text}
        onChange={(value) => set(draft, value)}
        onSubmit={() => void enhanceNow()}
      />
      <Row gap="xs" wrap>
        <Select label="Style" labelHidden value={read(effectiveStyle)} options={styleOptions} onChange={(value) => set(style, value)} />
        <Select label="Context" labelHidden value={read(effectiveLevel)} options={levelOptions} onChange={(value) => set(level, value)} />
      </Row>
      <Row gap="xs" wrap>
        <Select
          label="Model"
          labelHidden
          value={read(profileChoice)}
          options={[
            { value: 'auto', label: read(defaults).fallbackEnabled ? 'Auto (chain with fallback)' : 'Auto (first model)' },
            ...profiles.map((profile) => ({ value: profile.id, label: `${profile.name} · ${profile.model}` }))
          ]}
          onChange={(value) => set(profileChoice, value)}
        />
        {working === 'enhance' ? (
          <Row gap="xs">
            <Spinner label="Enhancing" labelHidden />
            <Button variant="ghost" icon="stop" onPress={cancel}>
              Cancel
            </Button>
          </Row>
        ) : (
          <Button icon="lightbulb" onPress={() => void enhanceNow()} disabled={!text.trim() || working !== null}>
            Enhance
          </Button>
        )}
        <Button variant="ghost" icon="search" tooltip="See what context would be sent" onPress={() => void previewContext()} disabled={working !== null}>
          {working === 'preview' ? 'Gathering…' : 'Preview context'}
        </Button>
      </Row>
      <TargetPicker />
      <NoticeBar />
      <ContextPanel />
      {output ? (
        <Stack gap="sm">
          <Textarea label="Enhanced prompt" rows={12} value={output} onChange={(value) => set(result, value)} onSubmit={(value) => void send(value)} />
          <RunInfo />
          <Switch label="Press Enter after sending" checked={read(effectiveEnter)} onChange={(value) => set(pressEnter, value)} />
          <Row gap="xs" wrap>
            <Button icon="play" onPress={() => void send(output)} disabled={!read(target) || working !== null}>
              Send to agent
            </Button>
            <Button variant="outline" icon="copy" onPress={() => void copy(output)}>
              Copy
            </Button>
            <Button
              variant="ghost"
              icon="refresh"
              tooltip="Use the enhanced prompt as the new input"
              onPress={() => {
                set(draft, output)
                set(result, '')
              }}
            >
              Refine
            </Button>
            <IconButton icon="delete" label="Clear" variant="ghost" onPress={() => set(result, '')} />
          </Row>
        </Stack>
      ) : (
        <Row gap="xs">
          <Button variant="ghost" icon="play" onPress={() => void send(text)} disabled={!read(target) || !text.trim() || working !== null}>
            Send original
          </Button>
        </Row>
      )}
    </Stack>
  )
}

function HistoryTab() {
  const all = read(history)
  const list = read(filteredHistory)
  if (all.length === 0) {
    return <EmptyState icon="book" title="No history yet" description="Enhanced prompts show up here." />
  }
  return (
    <Stack gap="sm">
      <Input label="Search history" labelHidden type="search" placeholder="Search history" value={read(historyFilter)} onChange={(value) => set(historyFilter, value)} />
      <Stack gap="xs">
        {list.map((entry) => (
          <Box key={entry.id} gap="xs" padding="sm" border radius="md">
            <Text weight="medium" truncate>
              {entry.original.split('\n')[0].slice(0, 160)}
            </Text>
            <Row gap="xs" justify="between">
              <Text muted size="xs">
                {STYLE_LABELS[isStyle(entry.style) ? entry.style : 'balanced']} · {entry.model}
                {entry.source === 'hook' ? ' · auto' : ''} · <RelativeTime at={entry.at} />
              </Text>
              <Row gap="xs">
                <IconButton icon="edit" label="Open in Enhance tab" size="sm" variant="ghost" onPress={() => reuse(entry)} />
                <IconButton icon="copy" label="Copy enhanced prompt" size="sm" variant="ghost" onPress={() => void copy(entry.enhanced)} />
                <IconButton icon="delete" label="Delete" size="sm" variant="ghost" onPress={() => removeEntry(entry.id)} />
              </Row>
            </Row>
          </Box>
        ))}
      </Stack>
      <Row justify="between">
        <Text muted size="xs">
          {list.length} of {all.length}
        </Text>
        <Button variant="ghost" tone="danger" size="sm" icon="delete" onPress={() => set(historyRaw, [])}>
          Clear history
        </Button>
      </Row>
    </Stack>
  )
}

function ProfileForm() {
  const current = read(form)
  const view = read(models)
  if (!current || !view) return null
  const custom = current.preset === 'custom'
  const editing = Boolean(current.id)
  const keyHint = editing ? 'Leave empty to keep the saved key' : presetById(current.preset).env ? `Or set ${presetById(current.preset).env}` : 'Not needed for local servers'
  return (
    <Box gap="sm" padding="md" border="accent" radius="md">
      <Text weight="semibold">{editing ? `Edit ${current.name}` : 'Add a model'}</Text>
      <Select label="Preset" value={current.preset} options={view.presets.map((preset) => ({ value: preset.id, label: preset.label }))} onChange={applyPreset} />
      <Input label="Name" value={current.name} onChange={(value) => patchForm({ name: value })} />
      {custom ? (
        <Select
          label="API format"
          value={current.provider}
          options={[
            { value: 'openai', label: 'OpenAI-compatible (/chat/completions)' },
            { value: 'anthropic', label: 'Anthropic (/v1/messages)' }
          ]}
          onChange={(value) => patchForm({ provider: value === 'anthropic' ? 'anthropic' : 'openai' })}
        />
      ) : null}
      <Input label="Base URL" placeholder="https://…" value={current.baseUrl} onChange={(value) => patchForm({ baseUrl: value })} />
      <Input label="Model" placeholder={presetById(current.preset).model || 'model-id'} value={current.model} onChange={(value) => patchForm({ model: value })} />
      <Input label="API key" type="password" placeholder={keyHint} value={current.apiKey} onChange={(value) => patchForm({ apiKey: value })} />
      <Row gap="xs" wrap>
        <Select
          label="Temperature"
          value={String(current.temperature)}
          options={['0', '0.2', '0.3', '0.5', '0.7', '1'].map((value) => ({ value, label: `Temperature ${value}` }))}
          onChange={(value) => patchForm({ temperature: Number(value) })}
        />
        <Select
          label="Max tokens"
          value={String(current.maxTokens)}
          options={['1000', '2000', '4000', '8000', '16000'].map((value) => ({ value, label: `${value} tokens` }))}
          onChange={(value) => patchForm({ maxTokens: Number(value) })}
        />
      </Row>
      <Row gap="xs">
        <Button icon="check" onPress={() => void saveForm()} disabled={!current.name.trim() || !current.baseUrl.trim() || read(busy) === 'save'}>
          Save
        </Button>
        <Button variant="ghost" onPress={() => set(form, null)}>
          Cancel
        </Button>
      </Row>
    </Box>
  )
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
        <Badge tone={profile.keySource === 'none' ? 'warning' : 'success'}>{KEY_LABEL[profile.keySource]}</Badge>
      </Row>
      <Text muted size="xs" truncate>
        {profile.model} · {profile.baseUrl}
      </Text>
      <Row justify="between" gap="xs">
        {fromEnv ? (
          <Text muted size="xs">From environment</Text>
        ) : (
          <Switch label="Enabled" checked={profile.enabled} onChange={(value) => void toggleProfile(profile, value)} />
        )}
        <Row gap="none">
          <IconButton icon="check" label="Test" size="sm" variant="ghost" onPress={() => void testProfile(profile.id)} disabled={read(busy) === 'test'} />
          {fromEnv ? null : (
            <Row gap="none">
              <IconButton icon="collapse" label="Move up (try earlier)" size="sm" variant="ghost" disabled={index === 0} onPress={() => void modelAction({ move: profile.id, direction: 'up' })} />
              <IconButton icon="expand" label="Move down (try later)" size="sm" variant="ghost" disabled={index === count - 1} onPress={() => void modelAction({ move: profile.id, direction: 'down' })} />
              <IconButton icon="edit" label="Edit" size="sm" variant="ghost" onPress={() => openForm(profile)} />
              <IconButton icon="delete" label="Delete" size="sm" variant="ghost" tone="danger" onPress={() => void modelAction({ remove: profile.id })} />
            </Row>
          )}
        </Row>
      </Row>
    </Box>
  )
}

function ModelsTab() {
  const view = read(models)
  const prefs = read(defaults)
  if (!view) return <Spinner label="Loading" />
  const roleOptions = [
    { value: 'chain', label: 'Same as the chain' },
    ...view.profiles.map((profile) => ({ value: profile.id, label: `${profile.name} · ${profile.model}` }))
  ]
  return (
    <Stack gap="md">
      <Box gap="sm" padding="sm" radius="md" background="muted">
        <Switch label="Fallback to the next model when one fails" checked={prefs.fallbackEnabled} onChange={(value) => void setSetting('fallbackEnabled', value)} />
        <Select
          label="Fall back on"
          value={prefs.fallbackOn}
          disabled={!prefs.fallbackEnabled}
          options={[
            { value: 'any', label: 'Any error (bad key, unknown model, network…)' },
            { value: 'transient', label: 'Only network, timeout, rate limit, 5xx' }
          ]}
          onChange={(value) => void setSetting('fallbackOn', value)}
        />
        <Text muted size="xs">Models are tried top to bottom. Disabled models are skipped.</Text>
      </Box>
      {view.fromEnv && view.profiles.length > 0 ? (
        <Callout tone="accent" title="Using API keys from your environment">
          <Text size="sm">Add a model below to customize; then only your saved models are used.</Text>
        </Callout>
      ) : null}
      {view.profiles.length === 0 && !read(form) ? (
        <EmptyState icon="agent" title="No models yet" description="Add OpenAI, Anthropic, OpenRouter, Gemini, Groq, DeepSeek, Mistral, Ollama, LM Studio or any OpenAI-compatible endpoint." />
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
          <Button icon="add" onPress={() => openForm()}>
            Add model
          </Button>
        </Row>
      )}
      {view.profiles.length > 1 && !view.fromEnv ? (
        <Stack gap="sm">
          <Select
            label="Auto-enhance hook model (needs to answer in under 2 s)"
            value={view.hookProfileId ?? 'chain'}
            options={roleOptions}
            onChange={(value) => void setRoles({ hookProfileId: value === 'chain' ? null : value })}
          />
          <Select
            label="File picker model (Max context level)"
            value={view.selectorProfileId ?? 'chain'}
            options={roleOptions}
            onChange={(value) => void setRoles({ selectorProfileId: value === 'chain' ? null : value })}
          />
        </Stack>
      ) : null}
      <Text muted size="xs">
        Style, language, context level, exclusions and auto-enhance: Settings → Plugins → Enhance Prompt. Prompts and the context
        you choose go only to the endpoints above; .env files, keys and credentials are never read.
      </Text>
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
        {view ? <Badge tone={first && first.keySource !== 'none' ? 'accent' : 'warning'}>{first ? first.model : 'no model'}</Badge> : null}
      </Row>
      <Tabs label="Enhance Prompt" value={read(tab)} onChange={(value) => set(tab, value)}>
        <Tab value="enhance" label="Enhance" icon="lightbulb">
          <EnhanceTab />
        </Tab>
        <Tab value="history" label={`History (${read(history).length})`} icon="book">
          <HistoryTab />
        </Tab>
        <Tab value="models" label={`Models (${view?.profiles.length ?? 0})`} icon="agent">
          <ModelsTab />
        </Tab>
      </Tabs>
    </Box>
  )
}
