// A fake `window.orca` for `npm run dev` in a browser: sample models, terminals, history and a run
// with progress, so the web panel can be designed without Orca. Never part of the built panel.
//
// The sample data is one believable project, the same in every picture (scripts/make-listing.mjs):
// a Next.js storefront on its first checkout, asked to fix its login page on phones. It has the
// shapes the real worker answers with (src/worker.ts), so a picture shows what a person will see.
import { english, msg, raw, type Message } from '../../src/messages.ts'

type Handler = (payload: unknown) => void

/** The project's name in Orca (its repository), and its first checkout, which Orca calls by its branch. */
const PROJECT = 'storefront'
const CHECKOUT = 'main'

const events = new Map<string, Set<Handler>>()
const emit = (event: string, payload: unknown) => events.get(event)?.forEach((handler) => handler(payload))
const listen = (event: string, handler: Handler) => {
  if (!events.has(event)) events.set(event, new Set())
  events.get(event)!.add(handler)
  return { dispose: () => events.get(event)?.delete(handler) }
}

/** What the first history entry holds: enough lines to show an entry read in place. */
const HISTORY_SAMPLE = `Fix the login page layout on mobile screens (under 640 px wide).

## Task
1. Reproduce at 375 px and 414 px widths: the form overflows and the submit button is hidden.
2. Find the cause (likely fixed widths in Card or LoginForm) and fix it with responsive classes.

## Done when
- No horizontal scroll from 320 px up; the button is visible without zooming.`

const store = new Map<string, unknown>([
  [
    'history',
    [
      { id: 'h1', at: Date.now() - 3600_000, original: 'login page is broken on mobile', enhanced: HISTORY_SAMPLE, style: 'bugfix', model: 'sonnet', source: 'panel', project: PROJECT },
      { id: 'h2', at: Date.now() - 3 * 3600_000, original: 'add dark mode toggle', enhanced: 'Add a dark mode toggle to settings…', style: 'feature', model: 'gpt-5-mini', source: 'panel', project: PROJECT },
      { id: 'h3', at: Date.now() - 86_400_000, original: 'review the payment webhook handler', enhanced: 'Review src/api/webhooks/stripe.ts…', style: 'review', model: 'sonnet', source: 'panel', project: 'billing-api' },
      { id: 'h4', at: Date.now() - 2 * 86_400_000, original: 'split the settings page into tabs', enhanced: 'Refactor app/settings/page.tsx…', style: 'refactor', model: 'haiku', source: 'hook', project: PROJECT },
      { id: 'h5', at: Date.now() - 4 * 86_400_000, original: 'plan the migration to the new auth library', enhanced: 'Plan the move from next-auth…', style: 'plan', model: 'gpt-5', source: 'panel', project: 'billing-api' }
    ]
  ]
])
const settingsValues: Record<string, unknown> = {
  uiLanguage: 'auto',
  defaultStyle: 'balanced',
  // Deep: the level whose steps (git, relevant code) the sample run below goes through.
  contextLevel: 'deep',
  outputLanguage: 'auto',
  autoEnhanceMode: 'off',
  fallbackEnabled: true,
  fallbackOn: 'any',
  sendPressEnter: false
}
const profile = (id: string, name: string, preset: string, provider: string, model: string, keySource: string) => ({
  id, name, preset, provider, baseUrl: '', model, maxTokens: 8000, enabled: true, command: '', args: '',
  keySource, effectiveModel: model, effectiveBaseUrl: provider === 'cli' ? '' : 'https://api.openai.com/v1'
})
let models = {
  profiles: [profile('claude', 'Claude Code', 'claude-code', 'cli', 'sonnet', 'subscription'), profile('gpt', 'OpenAI', 'openai', 'openai', 'gpt-5-mini', 'secret')],
  presets: [
    { id: 'openai', label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
    { id: 'anthropic', label: 'Anthropic', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-4-5' },
    { id: 'claude-code', label: 'Claude Code (subscription)', provider: 'cli', baseUrl: '', model: '' }
  ],
  fromEnv: false,
  hookProfileId: null,
  selectorProfileId: null
}
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('Cancelled'), { code: 'aborted' }))
    })
  })

/** What a real run returns for "login page is broken on mobile" (sample data for the preview and pictures). */
const SAMPLE_PROMPT = `Fix the login page layout on mobile screens (under 640 px wide).

## Context
- Next.js 15 app, Tailwind CSS; the page is app/(auth)/login/page.tsx with components/LoginForm.tsx.
- Recent change: commit a41c9e2 "Move auth forms to the new Card component".

## Task
1. Reproduce at 375 px and 414 px widths: the form overflows and the submit button is hidden.
2. Find the cause (likely fixed widths in Card or LoginForm) and fix it with responsive classes.
3. Keep the desktop layout unchanged.

## Done when
- No horizontal scroll from 320 px up; the button is visible without zooming.
- pnpm test and pnpm lint pass.`

const SAMPLE_PROMPT_VI = `Sửa bố cục trang đăng nhập trên màn hình điện thoại (dưới 640 px).

## Bối cảnh
- Ứng dụng Next.js 15, Tailwind CSS; trang nằm ở app/(auth)/login/page.tsx và components/LoginForm.tsx.
- Thay đổi gần đây: commit a41c9e2 "Move auth forms to the new Card component".

## Việc cần làm
1. Tái hiện ở độ rộng 375 px và 414 px: form tràn ra ngoài, nút đăng nhập bị khuất.
2. Tìm nguyên nhân (có thể do độ rộng cố định trong Card hoặc LoginForm) và sửa bằng class responsive.
3. Giữ nguyên bố cục trên máy tính.

## Xong khi
- Không có thanh cuộn ngang từ 320 px trở lên; nút hiện đầy đủ.
- pnpm test và pnpm lint đều qua.`

/**
 * A context item as the worker lists it: an English label (the model reads it) and the same as a
 * message, for the panel's language; `why` says how a file was found.
 */
const contextItem = (id: string, kind: string, title: Message, chars: number, why?: Message) => ({
  id,
  kind,
  label: english(title),
  chars,
  title,
  ...(why ? { note: english(why), why } : {})
})

/** What the Deep level gathers for the sample request, in the worker's order. */
const SAMPLE_CONTEXT = [
  contextItem('workspace', 'workspace', msg('label.workspace'), 30),
  contextItem('agent', 'agent', msg('label.agent'), 16),
  contextItem('rules:AGENTS.md', 'rules', raw('AGENTS.md'), 2140),
  contextItem('stack', 'stack', msg('label.stack'), 610),
  contextItem('tree', 'tree', msg('label.tree', { count: 214 }), 3890),
  contextItem('git:status', 'git', msg('label.status', { count: 3 }), 120),
  contextItem('git:log', 'git', msg('label.log'), 540),
  contextItem('git:diff', 'git', msg('label.diff'), 2310),
  contextItem('file:app/(auth)/login/page.tsx', 'file', raw('app/(auth)/login/page.tsx'), 1480, msg('why.keyword')),
  contextItem('file:components/LoginForm.tsx', 'file', raw('components/LoginForm.tsx'), 2650, msg('why.keyword'))
]

/** `?fallback=1`: the first model fails and the next one answers (a picture of the fallback at work). */
let fallbackDemo = false
/** `?blocked=1`: the first agent is waiting for an answer, so Send asks before it types. */
let blockedDemo = false
/** `?hook=rewritten|appended|skipped`: what auto-enhance last did, for the line in the Settings section. */
let hookDemo: string | null = null
/** `?nokeys=1`: a machine without an OS key store. */
let noKeyStore = false
/** History entries removed a moment ago, for Undo. */
const removed = new Map<string, unknown>()
const setHistory = (list: unknown[]): void => {
  store.set('history', list)
  emit('storage', { key: 'history' })
}

async function enhance(input: Record<string, unknown>, signal?: AbortSignal) {
  const runId = String(input.runId)
  const startedAt = Date.now()
  const keys = ['workspace', 'project', 'git', 'search', 'model'] as const
  const first = { profileId: 'claude', name: 'Claude Code', model: 'sonnet' }
  const answered = fallbackDemo ? { profileId: 'gpt', name: 'OpenAI', model: 'gpt-5-mini' } : first
  // What each step says once it is done, as the worker reports it: a name, or a count the panel words.
  const done: Record<(typeof keys)[number], string> = { workspace: `${PROJECT}: ${CHECKOUT}`, project: '214', git: '3', search: '2', model: `${answered.name} · ${answered.model}` }
  const steps: { key: string; status: string; detail?: string; startedAt?: number; fraction?: number }[] = keys.map((key) => ({ key, status: 'pending' }))
  const post = (): void => emit('enhance.progress', { runId, startedAt, steps: steps.map((step) => ({ ...step })) })
  for (const [index, key] of keys.entries()) {
    // The model step names the model being tried, and counts the tries from the second one on.
    steps[index] = { key, status: 'running', startedAt: Date.now(), ...(key === 'model' ? { detail: `${first.name} · ${first.model}` } : {}) }
    post()
    if (key === 'model' && fallbackDemo) {
      await wait(800, signal)
      steps[index] = { ...steps[index], detail: `${answered.name} · ${answered.model} · 2/2` }
      post()
    }
    await wait(key === 'model' ? 2500 : 500, signal)
    steps[index] = { key, status: 'done', detail: done[key] }
  }
  post()
  const files = (input.files as string[] | undefined) ?? []
  const ms = Date.now() - startedAt
  return {
    enhanced: `${/[à-ỹ]/i.test(String(input.prompt)) ? SAMPLE_PROMPT_VI : SAMPLE_PROMPT}${files.length ? `\n\nAttached files:\n${files.map((file) => `- ${file}`).join('\n')}` : ''}`,
    model: answered.model,
    profileName: answered.name,
    ms,
    attempts: [...(fallbackDemo ? [{ ...first, ok: false, error: 'usage limit reached', ms: 800 }] : []), { ...answered, ok: true, ms: fallbackDemo ? ms - 800 : ms }],
    context: SAMPLE_CONTEXT,
    notes: []
  }
}

let attachmentCount = 0
/** Switches confirmed in the panel (the worker keeps them in storage). */
const granted = new Set<string>()
const handlers: Record<string, (input: Record<string, unknown>, signal?: AbortSignal) => unknown> = {
  'models.get': () => ({ ...models, ...(noKeyStore ? { keysUnavailable: true } : {}) }),
  'models.catalog': (input) => ({
    models: input.preset === 'claude-code' ? [{ id: 'sonnet', label: 'sonnet: Sonnet, newest' }, { id: 'opus', label: 'opus: Opus, newest' }, { id: 'haiku', label: 'haiku: Haiku, newest' }] : [{ id: 'gpt-5-mini', label: 'GPT-5 mini' }, { id: 'gpt-5', label: 'GPT-5' }],
    source: 'mock',
    fetchedAt: Date.now()
  }),
  'models.detect': () => ({ found: [{ preset: 'codex', label: 'Codex (subscription)', path: 'C:/bin/codex.exe', added: false }] }),
  'models.save': (input) => {
    const next = { ...profile(String(input.id ?? `p${Date.now()}`), String(input.name), String(input.preset), String(input.provider), String(input.model), 'secret'), ...input }
    const exists = models.profiles.some((entry) => entry.id === next.id)
    models = { ...models, profiles: exists ? models.profiles.map((entry) => (entry.id === next.id ? (next as never) : entry)) : [...models.profiles, next as never] }
    return models
  },
  'models.delete': (input) => (models = { ...models, profiles: models.profiles.filter((entry) => entry.id !== input.id) }),
  'models.move': () => models,
  'models.roles': (input) => (models = { ...models, ...input } as never),
  'models.test': () => ({ ok: true, ms: 840, message: 'OK' }),
  // An agent's terminal reads "<its title> · <its state>", any other terminal by its title.
  'targets.list': () => ({
    targets: [
      { terminalId: 't1', label: `Claude Code · ${blockedDemo ? 'blocked' : 'waiting'}`, agent: 'claude', title: 'Claude Code', state: blockedDemo ? 'blocked' : 'waiting' },
      { terminalId: 't2', label: 'Codex · working', agent: 'codex', title: 'Codex', state: 'working' },
      { terminalId: 't3', label: 'pnpm dev', agent: null }
    ],
    workspace: CHECKOUT,
    project: PROJECT,
    workspaceId: 'identity:wt2:local:mock',
    workspacePath: `C:/dev/${PROJECT}`
  }),
  // One rule for every project, one for this project only (a rule's scope is `project:<name>`),
  // and a structure of the person's own next to the built-in ones.
  'rules.get': () => ({
    rules: [
      { id: 'r1', text: 'Always run the tests before finishing.', enabled: true, scope: '' },
      { id: 'r2', text: 'Use pnpm, never npm.', enabled: true, scope: `project:${PROJECT}` }
    ],
    structures: [{ id: 's1', name: 'Bug report', sections: ['Symptom', 'Steps to reproduce', 'Expected', 'Actual', 'Fix and verify'] }]
  }),
  'rules.save': (input) => (input as { config: unknown }).config,
  'prompt.enhance': (input, signal) => enhance(input, signal),
  // The same list a run sends, without a run.
  'context.preview': async () => {
    await wait(300)
    return { context: SAMPLE_CONTEXT, notes: [], chars: SAMPLE_CONTEXT.reduce((sum, entry) => sum + entry.chars, 0) }
  },
  'prompt.send': (input) => {
    if (blockedDemo && input.terminalId === 't1' && input.force !== true) {
      throw Object.assign(new Error('blocked'), { code: 'conflict', text: msg('error.agent_blocked', { name: 'Claude Code' }) })
    }
    return { accepted: true }
  },
  'prompt.copy': () => ({ copied: true }),
  'history.remove': (input) => {
    const list = store.get('history') as { id: string }[]
    const gone = list.find((entry) => entry.id === input.id)
    if (gone) removed.set(gone.id, gone)
    setHistory(list.filter((entry) => entry.id !== input.id))
  },
  'history.restore': (input) => {
    const entry = removed.get(String(input.id)) as { at: number } | undefined
    if (!entry) return { restored: false }
    removed.delete(String(input.id))
    setHistory([...(store.get('history') as { at: number }[]), entry].sort((a, b) => b.at - a.at))
    return { restored: true }
  },
  'history.clear': () => setHistory([]),
  'hook.last': () =>
    hookDemo === 'rewritten'
      ? { at: Date.now() - 4 * 60_000, outcome: 'rewritten', agent: 'claude', model: 'gpt-5-mini' }
      : hookDemo === 'appended'
        ? { at: Date.now() - 4 * 60_000, outcome: 'appended', agent: 'claude' }
        : hookDemo === 'skipped'
          ? { at: Date.now() - 4 * 60_000, outcome: 'skipped', agent: 'codex', reason: msg('hook.no_model') }
          : null,
  'ui.locale': () => ({ ok: true }),
  'data.summary': () => ({ history: (store.get('history') as unknown[]).length, profiles: models.profiles.length, keys: 1, catalogs: 2 }),
  'data.clear': () => null,
  'consents.get': () => ({ granted: [...granted], needed: ['allowOtherAgents', 'allowAgentActivity', 'allowAgentLaunch'] }),
  'consent.set': (input) => {
    if (input.granted) granted.add(String(input.key))
    else granted.delete(String(input.key))
    return { granted: [...granted] }
  },
  'agent.launch': () => ({ terminalId: 'mock-new' }),
  'editor.open': () => ({ opened: true }),
  'attachments.put': (input) => {
    attachmentCount += 1
    if (Number(input.index) < Number(input.total) - 1) return { received: 1 }
    return { path: `C:/Temp/enhance-prompt-attachments/${String(input.id)}/${String(input.name)}`, bytes: attachmentCount * 1000 }
  }
}

/** Live: requests go to the real worker of local.enhance-prompt through the dev server (orca-bridge.ts). */
export let mode: 'live' | 'mock' = 'mock'

async function liveRequest(name: string, input: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown> {
  const response = await fetch('/__orca/request', {
    method: 'POST',
    body: JSON.stringify({ name, input: input ?? null, timeoutMs: options?.timeoutMs ?? 30_000 }),
    ...(options?.signal ? { signal: options.signal } : {})
  })
  const answer = (await response.json()) as { ok: boolean; result?: unknown; code?: string; message?: string }
  if (!answer.ok) throw Object.assign(new Error(answer.message ?? 'Request failed'), { code: answer.code ?? 'failed' })
  return answer.result ?? null
}

/**
 * A live run: panel events do not cross the CLI, so its progress is asked for every 600 ms
 * (`enhance.progress.get`) and handed to the panel as the `enhance.progress` event.
 */
async function liveEnhance(input: Record<string, unknown>, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown> {
  const runId = typeof input.runId === 'string' ? input.runId : ''
  let polling = runId !== ''
  const poll = async () => {
    while (polling) {
      await wait(600)
      if (!polling) break
      const snapshot = await liveRequest('enhance.progress.get', { runId }).catch(() => null)
      if (polling && snapshot) emit('enhance.progress', snapshot)
    }
  }
  void poll()
  try {
    return await liveRequest('prompt.enhance', input, options)
  } finally {
    polling = false
  }
}

/** Settings live in the browser in both modes (the CLI cannot reach the plugin's settings). */
const SETTINGS_KEY = 'enhance-prompt:dev-settings'

export async function installMockOrca(): Promise<void> {
  const root = document.documentElement
  const query = new URLSearchParams(location.search)
  // ?mock=1 forces sample data; otherwise the real worker when Orca has the dev plugin loaded.
  if (query.get('mock') !== '1') {
    const status = await fetch('/__orca/status').then((response) => response.json() as Promise<{ live: boolean }>).catch(() => ({ live: false }))
    if (status.live) mode = 'live'
  }
  if (mode === 'live') store.clear()
  try {
    Object.assign(settingsValues, JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'))
  } catch {
    // Damaged copy: the defaults above.
  }
  if (query.get('lang')) settingsValues.uiLanguage = query.get('lang')
  // ?set=key:value,key:value sets settings; ?consent=key,key confirms switches (pictures of the panel).
  for (const pair of (query.get('set') ?? '').split(',').filter(Boolean)) {
    const [key, value] = pair.split(':')
    settingsValues[key] = value === 'true' ? true : value === 'false' ? false : Number.isFinite(Number(value)) ? Number(value) : value
  }
  for (const key of (query.get('consent') ?? '').split(',').filter(Boolean)) granted.add(key)
  fallbackDemo = query.get('fallback') === '1'
  blockedDemo = query.get('blocked') === '1'
  hookDemo = query.get('hook')
  noKeyStore = query.get('nokeys') === '1'
  // ?nomodels=1: a first run, before any model is set (the Enhance tab then offers the CLI it found).
  if (query.get('nomodels') === '1') models = { ...models, profiles: [] }
  if (query.get('theme') === 'dark') root.classList.add('dark')
  // ?width=360: a sidebar's width (headless browsers cannot make a window that narrow), with a
  // dashed line where the sidebar would end; ?edge=0 leaves the line out (pictures).
  if (query.get('width')) {
    const width = Number(query.get('width'))
    document.body.style.cssText = `max-width:${width}px${query.get('edge') === '0' ? '' : ';border-right:1px dashed #8884'}`
    // A notice is centred in the window; in Orca the window is the sidebar, so it is centred there.
    const style = document.createElement('style')
    style.textContent = `[data-sonner-toaster][data-x-position="center"]{left:${width / 2}px;--width:min(356px,${width - 24}px)}`
    document.head.append(style)
  }
  const api = {
    api: { major: 1, minor: 99 },
    locale: navigator.language,
    on: (event: string, handler: Handler) => listen(event, handler),
    plugin: {
      request: async (name: string, input?: Record<string, unknown>, options?: { signal?: AbortSignal; timeoutMs?: number }) => {
        if (mode === 'live') return name === 'prompt.enhance' ? liveEnhance(input ?? {}, options) : liveRequest(name, input, options)
        const handler = handlers[name]
        if (!handler) throw Object.assign(new Error(`unknown_method: ${name}`), { code: 'unknown_method' })
        await wait(120)
        return handler(input ?? {}, options?.signal) ?? null
      },
      on: (event: string, handler: Handler) => listen(event, handler)
    },
    storage: {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: unknown) => void store.set(key, value),
      delete: async (key: string) => void store.delete(key),
      keys: async () => [...store.keys()],
      onDidChange: (listener: Handler) => listen('storage', listener)
    },
    settings: {
      get: async (key?: string) => (key === undefined ? { ...settingsValues } : settingsValues[key]),
      set: async (key: string, value: unknown) => {
        settingsValues[key] = value
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsValues))
        emit('settings', { key })
      },
      onDidChange: (listener: Handler) => listen('settings', listener)
    },
    secrets: { get: async () => null, set: async () => undefined, delete: async () => undefined },
    // The preview opens nothing: it answers as if the person cancelled, so the panel shows the URL.
    shell: { openExternal: async () => ({ opened: false, reason: 'cancelled' }) },
    // The preview writes no file: it answers as if the person had saved it.
    files: { saveAs: async () => ({ status: 'saved' }) }
  }
  // SAFETY: a dev-only stand-in; it implements the parts of the frame API the panel calls.
  Object.defineProperty(window, 'orca', { value: api, configurable: true })
}
