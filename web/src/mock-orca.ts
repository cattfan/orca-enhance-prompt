// A fake `window.orca` for `npm run dev` in a browser: sample models, terminals, history and a run
// with progress, so the web panel can be designed without Orca. Never part of the built panel.
type Handler = (payload: unknown) => void

const events = new Map<string, Set<Handler>>()
const emit = (event: string, payload: unknown) => events.get(event)?.forEach((handler) => handler(payload))
const listen = (event: string, handler: Handler) => {
  if (!events.has(event)) events.set(event, new Set())
  events.get(event)!.add(handler)
  return { dispose: () => events.get(event)?.delete(handler) }
}

const store = new Map<string, unknown>([
  [
    'history',
    [
      { id: 'h1', at: Date.now() - 3600_000, original: 'login page is broken on mobile', enhanced: 'Fix the login page layout on mobile…', style: 'bugfix', model: 'sonnet', source: 'panel' },
      { id: 'h2', at: Date.now() - 3 * 3600_000, original: 'add dark mode toggle', enhanced: 'Add a dark mode toggle to settings…', style: 'feature', model: 'gpt-5-mini', source: 'panel' },
      { id: 'h3', at: Date.now() - 86_400_000, original: 'review the payment webhook handler', enhanced: 'Review src/api/webhooks/stripe.ts…', style: 'review', model: 'sonnet', source: 'panel' },
      { id: 'h4', at: Date.now() - 2 * 86_400_000, original: 'split the settings page into tabs', enhanced: 'Refactor app/settings/page.tsx…', style: 'refactor', model: 'haiku', source: 'hook' },
      { id: 'h5', at: Date.now() - 4 * 86_400_000, original: 'plan the migration to the new auth library', enhanced: 'Plan the move from next-auth…', style: 'plan', model: 'gpt-5', source: 'panel' }
    ]
  ]
])
const settingsValues: Record<string, unknown> = {
  uiLanguage: 'auto',
  defaultStyle: 'balanced',
  contextLevel: 'standard',
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

async function enhance(input: Record<string, unknown>, signal?: AbortSignal) {
  const runId = String(input.runId)
  const startedAt = Date.now()
  const keys = ['workspace', 'project', 'git', 'search', 'model'] as const
  const steps: { key: string; status: string; detail?: string; startedAt?: number; fraction?: number }[] = keys.map((key) => ({ key, status: 'pending' }))
  for (const [index, key] of keys.entries()) {
    steps[index] = { key, status: 'running', startedAt: Date.now() }
    emit('enhance.progress', { runId, startedAt, steps: steps.map((step) => ({ ...step })) })
    await wait(key === 'model' ? 2500 : 500, signal)
    steps[index] = { key, status: 'done', detail: key === 'search' ? '6' : key === 'git' ? '3' : key === 'workspace' ? 'orca-plugin · main' : undefined }
  }
  emit('enhance.progress', { runId, startedAt, steps })
  const files = (input.files as string[] | undefined) ?? []
  return {
    enhanced: `${/[à-ỹ]/i.test(String(input.prompt)) ? SAMPLE_PROMPT_VI : SAMPLE_PROMPT}${files.length ? `\n\nAttached files:\n${files.map((file) => `- ${file}`).join('\n')}` : ''}`,
    model: 'sonnet',
    profileName: 'Claude Code',
    ms: Date.now() - startedAt,
    attempts: [{ name: 'Claude Code', ok: true, ms: Date.now() - startedAt }],
    context: [
      { id: 'workspace', kind: 'workspace', label: 'Workspace', chars: 120 },
      { id: 'rules:AGENTS.md', kind: 'rules', label: 'AGENTS.md', chars: 4200 },
      { id: 'stack', kind: 'stack', label: 'Stack & commands', chars: 900 },
      { id: 'file:src/panel/actions.ts', kind: 'file', label: 'src/panel/actions.ts', chars: 3000, note: 'matches “panel”' }
    ],
    notes: []
  }
}

let attachmentCount = 0
/** Switches confirmed in the panel (the worker keeps them in storage). */
const granted = new Set<string>()
const handlers: Record<string, (input: Record<string, unknown>, signal?: AbortSignal) => unknown> = {
  'models.get': () => models,
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
  'targets.list': () => ({
    targets: [
      { terminalId: 't1', label: 'Claude Code · main', agent: 'claude' },
      { terminalId: 't2', label: 'pnpm dev', agent: null }
    ],
    workspace: 'orca-plugin',
    workspaceId: 'identity:wt2:local:mock'
  }),
  'rules.get': () => ({ rules: [{ id: 'r1', text: 'Always run the tests before finishing.', enabled: true, scope: '' }], structures: [] }),
  'rules.save': (input) => (input as { config: unknown }).config,
  'prompt.enhance': (input, signal) => enhance(input, signal),
  'context.preview': async () => ({ ...(await enhance({ prompt: '', runId: 'preview' })), enhanced: '' }),
  'prompt.send': () => ({ accepted: true }),
  'prompt.copy': () => ({ copied: true }),
  'history.remove': (input) => store.set('history', (store.get('history') as { id: string }[]).filter((entry) => entry.id !== input.id)),
  'history.clear': () => store.set('history', []),
  'data.summary': () => ({ history: 2, profiles: 2, keys: 1, catalogs: 2 }),
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
  if (query.get('theme') === 'dark') root.classList.add('dark')
  // ?width=360: a sidebar's width (headless browsers cannot make a window that narrow).
  if (query.get('width')) document.body.style.cssText = `max-width:${Number(query.get('width'))}px;border-right:1px dashed #8884`
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
    shell: { openExternal: async () => ({ opened: false, reason: 'cancelled' }) }
  }
  // SAFETY: a dev-only stand-in; it implements the parts of the frame API the panel calls.
  Object.defineProperty(window, 'orca', { value: api, configurable: true })
}
