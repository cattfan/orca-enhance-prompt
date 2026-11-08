// No build step: Orca strips the types and compiles the JSX when the panel loads.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  derived,
  EmptyState,
  Field,
  IconButton,
  Input,
  KeyValue,
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
import { isStyle, STYLE_LABELS, STYLES } from './prompts'

type Target = { terminalId: string; label: string; agent: string | null }
type Status = {
  provider: string
  model: string
  baseUrl: string
  keySource: 'secret' | 'env' | 'none'
  envName: string
  autoEnhanceMode: string
}
type Notice = { tone: 'success' | 'danger' | 'warning' | 'neutral'; text: string } | null

// Keyed memory atoms survive hot reloads and tab switches within a run.
const tab = atom('tab', 'enhance')
const draft = atom('draft', '', { persist: 'plugin' })
const result = atom('result', '', { persist: 'plugin' })
const style = atom<string | null>('style', null, { persist: 'plugin' })
const target = atom<string | null>('target', null)
const pressEnter = atom<boolean | null>('pressEnter', null)
const historyRaw = atom<JsonValue>(HISTORY_KEY, [], { persist: 'storage' })
const historyFilter = atom('historyFilter', '')
const keyDraft = atom('keyDraft', '')

const busy = atom<'enhance' | 'send' | 'test' | null>(null)
const notice = atom<Notice>(null)
const lastRun = atom<{ model: string; ms: number } | null>(null)
const targets = atom<Target[]>([])
const status = atom<Status | null>(null)
const defaults = atom<{ style: string; pressEnter: boolean }>({ style: 'balanced', pressEnter: false })

const history = derived(() => parseHistory(read(historyRaw)))
const filteredHistory = derived(() => {
  const query = read(historyFilter).trim().toLowerCase()
  const list = read(history)
  return query
    ? list.filter(
        (entry) =>
          entry.original.toLowerCase().includes(query) || entry.enhanced.toLowerCase().includes(query)
      )
    : list
})
const effectiveStyle = derived(() => read(style) ?? read(defaults).style)
const effectiveEnter = derived(() => read(pressEnter) ?? read(defaults).pressEnter)

let inFlight: AbortController | null = null

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function refreshStatus(): Promise<void> {
  try {
    set(status, await plugin.request('config.status'))
    const all = await settings.get()
    set(defaults, {
      style: typeof all.defaultStyle === 'string' && isStyle(all.defaultStyle) ? all.defaultStyle : 'balanced',
      pressEnter: all.sendPressEnter === true
    })
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
      set(target, list[0]?.terminalId ?? null)
    }
  } catch {
    set(targets, [])
  }
}

async function enhanceNow(): Promise<void> {
  const prompt = read(draft).trim()
  if (!prompt || read(busy)) {
    return
  }
  inFlight = new AbortController()
  set(busy, 'enhance')
  set(notice, null)
  try {
    const answer = await plugin.request(
      'prompt.enhance',
      { prompt, style: read(effectiveStyle), terminalId: read(target) },
      { timeoutMs: 120_000, signal: inFlight.signal }
    )
    set(result, answer.enhanced)
    set(lastRun, { model: answer.model, ms: answer.ms })
  } catch (error) {
    if (!inFlight?.signal.aborted) {
      set(notice, { tone: 'danger', text: message(error) })
    }
  } finally {
    inFlight = null
    set(busy, null)
  }
}

function cancel(): void {
  inFlight?.abort()
  set(busy, null)
  set(notice, { tone: 'neutral', text: 'Cancelled.' })
}

async function send(text: string): Promise<void> {
  const terminalId = read(target)
  if (!terminalId || !text.trim()) {
    return
  }
  set(busy, 'send')
  try {
    const { accepted } = await plugin.request('prompt.send', {
      terminalId,
      text,
      enter: read(effectiveEnter)
    })
    const label = read(targets).find((item) => item.terminalId === terminalId)?.label ?? 'terminal'
    set(
      notice,
      accepted
        ? { tone: 'success', text: `Sent to ${label}.` }
        : { tone: 'warning', text: `${label} did not accept the text.` }
    )
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  } finally {
    set(busy, null)
  }
}

async function copy(text: string): Promise<void> {
  if (!text.trim()) {
    return
  }
  const answer = await plugin.request('prompt.copy', { text }).catch((error) => ({
    copied: false,
    error: message(error)
  }))
  set(
    notice,
    answer.copied
      ? { tone: 'success', text: 'Copied to clipboard.' }
      : { tone: 'danger', text: `Copy failed: ${answer.error ?? 'unknown error'}` }
  )
}

function reuse(entry: HistoryEntry): void {
  set(draft, entry.original)
  set(result, entry.enhanced)
  if (isStyle(entry.style)) {
    set(style, entry.style)
  }
  set(tab, 'enhance')
}

function removeEntry(id: string): void {
  update(historyRaw, (list) => parseHistory(list).filter((entry) => entry.id !== id).map(toJson))
}

async function saveKey(): Promise<void> {
  const current = read(status)
  if (!current) {
    return
  }
  try {
    await plugin.request('config.setKey', { provider: current.provider, key: read(keyDraft) })
    set(keyDraft, '')
    set(notice, { tone: 'success', text: 'API key saved in Orca secrets.' })
    await refreshStatus()
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

async function removeKey(): Promise<void> {
  const current = read(status)
  if (!current) {
    return
  }
  await plugin.request('config.setKey', { provider: current.provider, key: '' }).catch(() => undefined)
  set(notice, { tone: 'neutral', text: 'API key removed.' })
  await refreshStatus()
}

async function testConnection(): Promise<void> {
  set(busy, 'test')
  try {
    const answer = await plugin.request('config.test', undefined, { timeoutMs: 40_000 })
    set(notice, {
      tone: answer.ok ? 'success' : 'danger',
      text: answer.ok ? `${answer.message} (${answer.ms} ms)` : answer.message
    })
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  } finally {
    set(busy, null)
  }
}

async function changeSetting(key: string, value: string): Promise<void> {
  try {
    await settings.set(key, value)
    await refreshStatus()
  } catch (error) {
    set(notice, { tone: 'danger', text: message(error) })
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    settings.onDidChange(() => void refreshStatus()),
    on('workspace.changed', () => void refreshTargets()),
    on('agent.status.changed', () => void refreshTargets()),
    plugin.on('hook.enhanced', ({ agent, mode }) =>
      set(notice, { tone: 'neutral', text: `Auto-enhanced (${mode}) a prompt for ${agent ?? 'an agent'}.` })
    )
  )
  void refreshStatus()
  void refreshTargets()
}

const styleOptions = STYLES.map((value) => ({ value, label: STYLE_LABELS[value] }))

function NoticeBar() {
  const current = read(notice)
  if (!current) {
    return null
  }
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

function EnhanceTab() {
  const working = read(busy)
  const text = read(draft)
  const output = read(result)
  const run = read(lastRun)
  const noKey = read(status)?.keySource === 'none' && !/localhost|127\.0\.0\.1/.test(read(status)?.baseUrl ?? '')
  return (
    <Stack gap="md">
      {noKey ? (
        <Callout tone="warning" title="No API key yet">
          <Stack gap="xs">
            <Text size="sm">Add your key in Setup (stored in Orca secrets) or set {read(status)?.envName}.</Text>
            <Row>
              <Button size="sm" variant="outline" icon="settings" onPress={() => set(tab, 'setup')}>
                Open Setup
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
        <Select
          label="Style"
          labelHidden
          value={read(effectiveStyle)}
          options={styleOptions}
          onChange={(value) => set(style, value)}
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
      </Row>
      <TargetPicker />
      <NoticeBar />
      {output ? (
        <Stack gap="sm">
          <Textarea
            label="Enhanced prompt"
            rows={12}
            value={output}
            onChange={(value) => set(result, value)}
            onSubmit={(value) => void send(value)}
          />
          {run ? (
            <Text muted size="xs">
              {run.model} · {(run.ms / 1000).toFixed(1)} s · edit freely before sending
            </Text>
          ) : null}
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
      <Input
        label="Search history"
        labelHidden
        type="search"
        placeholder="Search history"
        value={read(historyFilter)}
        onChange={(value) => set(historyFilter, value)}
      />
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

const KEY_SOURCE_LABEL = { secret: 'Saved in Orca secrets', env: 'From environment', none: 'Not set' }

function SetupTab() {
  const current = read(status)
  if (!current) {
    return <Spinner label="Loading" />
  }
  return (
    <Stack gap="md">
      <Select
        label="Provider"
        value={current.provider}
        options={[
          { value: 'openai', label: 'OpenAI-compatible' },
          { value: 'anthropic', label: 'Anthropic' }
        ]}
        onChange={(value) => void changeSetting('provider', value)}
      />
      <Input
        label="Model"
        placeholder={current.provider === 'anthropic' ? 'claude-haiku-4-5' : 'gpt-4.1-mini'}
        defaultValue={current.model}
        onSubmit={(value) => void changeSetting('model', value.trim())}
      />
      <Input
        label="API base URL"
        placeholder={current.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'}
        defaultValue={current.baseUrl}
        onSubmit={(value) => void changeSetting('baseUrl', value.trim())}
      />
      <Text muted size="xs">Press Enter in Model or URL to save. Empty means the provider default.</Text>
      <Field label="API key" description={`${KEY_SOURCE_LABEL[current.keySource]}. Stored encrypted by Orca; never shown again.`}>
        <Row gap="xs">
          <Input
            label="API key"
            labelHidden
            type="password"
            placeholder={current.keySource === 'none' ? 'sk-…' : '•••••••• (enter a new key to replace)'}
            value={read(keyDraft)}
            onChange={(value) => set(keyDraft, value)}
            onSubmit={() => void saveKey()}
          />
          <Button onPress={() => void saveKey()} disabled={!read(keyDraft).trim()}>
            Save
          </Button>
        </Row>
      </Field>
      <Row gap="xs" wrap>
        <Button variant="outline" icon="check" onPress={() => void testConnection()} disabled={read(busy) !== null}>
          {read(busy) === 'test' ? 'Testing…' : 'Test connection'}
        </Button>
        {current.keySource === 'secret' ? (
          <Button variant="ghost" tone="danger" icon="delete" onPress={() => void removeKey()}>
            Remove key
          </Button>
        ) : null}
      </Row>
      <NoticeBar />
      <KeyValue
        label="Current"
        items={[
          { label: 'Provider', value: current.provider === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible' },
          { label: 'Model', value: current.model, code: true },
          { label: 'Endpoint', value: current.baseUrl, code: true },
          { label: 'Auto-enhance', value: current.autoEnhanceMode, tone: current.autoEnhanceMode === 'off' ? undefined : 'accent' }
        ]}
      />
      <Text muted size="xs">
        Style, language, context, auto-enhance and more: Settings → Plugins → Enhance Prompt. Prompts are
        sent only to the endpoint above; nothing else leaves your machine.
      </Text>
    </Stack>
  )
}

export default function Panel() {
  const current = read(status)
  return (
    <Box gap="md">
      <Row justify="between">
        <Text weight="semibold">Enhance Prompt</Text>
        {current ? (
          <Badge tone={current.keySource === 'none' ? 'warning' : 'accent'}>{current.model}</Badge>
        ) : null}
      </Row>
      <Tabs label="Enhance Prompt" value={read(tab)} onChange={(value) => set(tab, value)}>
        <Tab value="enhance" label="Enhance" icon="lightbulb">
          <EnhanceTab />
        </Tab>
        <Tab value="history" label={`History (${read(history).length})`} icon="book">
          <HistoryTab />
        </Tab>
        <Tab value="setup" label="Setup" icon="settings">
          <SetupTab />
        </Tab>
      </Tabs>
    </Box>
  )
}
