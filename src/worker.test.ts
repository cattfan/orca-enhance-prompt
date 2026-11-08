// Runs src/worker.ts's activate(orca) over a mock host, with fetch stubbed (no network).
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker.ts'

type Captured = { url: string; body: Record<string, unknown>; headers: Record<string, string> }
const realFetch = globalThis.fetch

/** `answer` may return a Response (for errors) or a JSON body. */
function stubFetch(answer: (call: Captured, index: number) => unknown): Captured[] {
  const calls: Captured[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
    }
    calls.push(call)
    const out = answer(call, calls.length - 1)
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return calls
}
const httpError = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message } }), { status, headers: { 'content-type': 'application/json' } })
const openaiAnswer = (text: string) => ({ choices: [{ message: { content: text } }] })

afterEach(() => {
  globalThis.fetch = realFetch
})

function profile(id: string, preset: string, extra: Record<string, unknown> = {}) {
  const urls: Record<string, string> = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    groq: 'https://api.groq.com/openai/v1'
  }
  return {
    id,
    name: id,
    preset,
    provider: preset === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: urls[preset] ?? '',
    model: '',
    temperature: 0.3,
    maxTokens: 2000,
    enabled: true,
    ...extra
  }
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'enhance-prompt-'))
  writeFileSync(join(root, 'AGENTS.md'), '# Rules\nUse pnpm. Run pnpm test before finishing.')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'vitest run' }, dependencies: { react: '1' } }))
  writeFileSync(join(root, '.env'), 'SECRET=hunter2')
  mkdirSync(join(root, 'src', 'auth'), { recursive: true })
  writeFileSync(join(root, 'src', 'auth', 'session.ts'), 'export function validateSession(token: string) {\n  return token.length > 0\n}\n')
  writeFileSync(join(root, 'src', 'index.ts'), 'export {}\n')
  return root
}

function hostFor(root: string | null, extra: Record<string, unknown> = {}) {
  return {
    'workspace.readContext': { branch: 'main', displayName: 'demo', terminals: [{ id: 't1', title: 'Claude' }] },
    'workspace.list': { workspaces: root ? [{ id: 'w1', kind: 'folder', name: 'demo', path: root, branch: 'main', hostId: null }] : [], truncated: false },
    'agents.list': { agents: [{ terminalId: 't1', title: 'Claude', agent: 'claude', state: 'waiting', stateStartedAt: 0 }] },
    'terminal.read': { lines: ['$ pnpm test', 'FAIL src/auth/session.test.ts'], truncated: false },
    ...extra
  }
}

test('standard level: rules, stack and tree, never .env; adapts to Claude', async () => {
  const root = project()
  const calls = stubFetch(() => openaiAnswer('```\nFix validateSession in src/auth/session.ts.\n```'))
  const host = mockHost({
    storage: { models: { profiles: [profile('main', 'openai')] } },
    secrets: { 'apiKey.main': 'sk-test' },
    results: hostFor(root)
  })
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('prompt.enhance', { prompt: 'login broken', terminalId: 't1', level: 'standard' })
  assert.equal(answer.enhanced, 'Fix validateSession in src/auth/session.ts.')
  assert.equal(answer.model, 'gpt-4.1-mini')
  assert.equal(calls[0].headers.authorization, 'Bearer sk-test')
  const ids = answer.context.map((item) => item.id)
  assert.ok(ids.includes('workspace') && ids.includes('agent') && ids.includes('rules:AGENTS.md') && ids.includes('stack') && ids.includes('tree'), ids.join(','))
  const messages = calls[0].body.messages as { role: string; content: string }[]
  assert.match(messages[0].content, /Claude Code/)
  assert.match(messages[1].content, /Use pnpm/)
  assert.match(messages[1].content, /test: vitest run/)
  assert.ok(!/hunter2|\.env/.test(messages[1].content))
  assert.equal((host.data().storage.history as unknown[]).length, 1)
  await worker.deactivate()
})

test('deep level finds relevant code; exclusions are honoured', async () => {
  const root = project()
  const calls = stubFetch(() => openaiAnswer('ok'))
  const host = mockHost({
    storage: { models: { profiles: [profile('main', 'openai')] } },
    secrets: { 'apiKey.main': 'k' },
    results: hostFor(root)
  })
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('prompt.enhance', { prompt: 'validateSession rejects empty tokens in session.ts', level: 'deep', exclude: ['tree'] })
  const ids = answer.context.map((item) => item.id)
  assert.ok(ids.includes('file:src/auth/session.ts'), ids.join(','))
  assert.ok(!ids.includes('tree'))
  assert.match((calls[0].body.messages as { content: string }[])[1].content, /1: export function validateSession/)
  await worker.deactivate()
})

test('max level adds terminal output and AI-picked files', async () => {
  const root = project()
  const calls = stubFetch((call) => {
    const system = (call.body.messages as { content: string }[])[0].content
    return openaiAnswer(system.startsWith('You pick source files') ? '["src/index.ts"]' : 'done')
  })
  const host = mockHost({ storage: { models: { profiles: [profile('main', 'openai')] } }, secrets: { 'apiKey.main': 'k' }, results: hostFor(root) })
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('prompt.enhance', { prompt: 'make the tests pass', level: 'max', terminalId: 't1' })
  const ids = answer.context.map((item) => item.id)
  assert.ok(ids.includes('terminal') && ids.includes('file:src/index.ts'), ids.join(','))
  assert.equal(calls.length, 2)
  await worker.deactivate()
})

test('falls back to the next model and reports attempts', async () => {
  const calls = stubFetch((call) => (call.url.includes('openai.com') ? httpError(429, 'Rate limit') : { content: [{ type: 'text', text: 'From Claude.' }] }))
  const host = mockHost({
    storage: { models: { profiles: [profile('first', 'openai'), profile('second', 'anthropic')] } },
    secrets: { 'apiKey.first': 'a', 'apiKey.second': 'b' },
    results: hostFor(null)
  })
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('prompt.enhance', { prompt: 'do the thing', level: 'off' })
  assert.equal(answer.enhanced, 'From Claude.')
  assert.equal(answer.profileName, 'second')
  assert.deepEqual(answer.attempts.map((a) => a.ok), [false, true])
  assert.match(answer.attempts[0].error ?? '', /429/)
  assert.equal(calls.length, 2)
  await worker.deactivate()
})

test('fallback off, or transient-only on a 401, stops at the first model', async () => {
  stubFetch(() => httpError(401, 'Invalid API key'))
  const storage = { models: { profiles: [profile('first', 'openai'), profile('second', 'groq')] } }
  const secrets = { 'apiKey.first': 'a', 'apiKey.second': 'b' }
  const variants: Record<string, boolean | string>[] = [{ fallbackEnabled: false }, { fallbackOn: 'transient' }]
  for (const settings of variants) {
    const worker = await mountWorker(main, { host: mockHost({ storage, secrets, settings, results: hostFor(null) }) })
    await assert.rejects(worker.request('prompt.enhance', { prompt: 'x y z', level: 'off' }), /401: Invalid API key/)
    await worker.deactivate()
  }
})

test('skips a model without a key and uses a chosen profile first', async () => {
  const calls = stubFetch(() => openaiAnswer('fine'))
  const previous = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  try {
    const host = mockHost({
      storage: { models: { profiles: [profile('nokey', 'openai'), profile('groq', 'groq'), profile('other', 'openai')] } },
      secrets: { 'apiKey.groq': 'g', 'apiKey.other': 'o' },
      results: hostFor(null)
    })
    const worker = await mountWorker(main, { host })
    const auto = await worker.request('prompt.enhance', { prompt: 'abc def', level: 'off' })
    assert.equal(auto.profileName, 'groq')
    assert.equal(auto.attempts[0].error, 'no API key')
    const chosen = await worker.request('prompt.enhance', { prompt: 'abc def', level: 'off', profileId: 'other' })
    assert.equal(chosen.profileName, 'other')
    assert.ok(calls.at(-1)!.url.startsWith('https://api.openai.com'))
    await worker.deactivate()
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous
  }
})

test('model profiles: add with key, reorder, roles, delete', async () => {
  const host = mockHost({ results: hostFor(null) })
  const worker = await mountWorker(main, { host })
  let view = await worker.request('models.save', { name: 'GPT', preset: 'openai', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1', temperature: 0.2, maxTokens: 4000, enabled: true, apiKey: ' sk-1 ' })
  const gpt = view.profiles[0]
  assert.equal(gpt.keySource, 'secret')
  assert.equal(host.data().secrets[`apiKey.${gpt.id}`], 'sk-1')
  view = await worker.request('models.save', { name: 'Local', preset: 'ollama', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen', temperature: 0.3, maxTokens: 2000, enabled: true })
  const local = view.profiles[1]
  assert.equal(local.keySource, 'not-needed')
  view = await worker.request('models.move', { id: local.id, direction: 'up' })
  assert.deepEqual(view.profiles.map((p) => p.name), ['Local', 'GPT'])
  view = await worker.request('models.move', { id: local.id, to: 1 })
  assert.deepEqual(view.profiles.map((p) => p.name), ['GPT', 'Local'])
  view = await worker.request('models.move', { id: local.id, to: 0 })
  assert.deepEqual(view.profiles.map((p) => p.name), ['Local', 'GPT'])
  view = await worker.request('models.roles', { hookProfileId: local.id, selectorProfileId: 'nope' })
  assert.equal(view.hookProfileId, local.id)
  assert.equal(view.selectorProfileId, null)
  view = await worker.request('models.delete', { id: gpt.id })
  assert.equal(view.profiles.length, 1)
  assert.equal(host.data().secrets[`apiKey.${gpt.id}`], undefined)
  await worker.deactivate()
})

test('refuses a non-https remote base URL', async () => {
  stubFetch(() => ({}))
  const worker = await mountWorker(main, {
    host: mockHost({ storage: { models: { profiles: [profile('bad', 'custom', { baseUrl: 'http://example.com/v1' })] } }, secrets: { 'apiKey.bad': 'k' }, results: hostFor(null) })
  })
  await assert.rejects(worker.request('prompt.enhance', { prompt: 'something', level: 'off' }), /must use https/)
  await worker.deactivate()
})

test('sends to a terminal with bracketed paste and lists targets', async () => {
  const host = mockHost({ results: { ...hostFor(null), 'terminal.sendText': { accepted: true } } })
  const worker = await mountWorker(main, { host })
  const { targets } = await worker.request('targets.list')
  assert.deepEqual(targets.map((target) => target.terminalId), ['t1'])
  await worker.request('prompt.send', { terminalId: 't1', text: 'line one\nline two', enter: true })
  const sent = host.callsOf('terminal.sendText') as { text: string }[]
  assert.equal(sent[0].text, '\x1b[200~line one\nline two\x1b[201~')
  assert.equal(sent[1].text, '\r')
  await worker.deactivate()
})

test('auto-enhance hook: off passes, rules appends, AI rewrites with the hook model', async () => {
  const event = { agent: 'claude', terminalId: 't1', prompt: 'add a login page', inputKind: 'launch' as const }
  const off = await mountWorker(main, { host: mockHost() })
  assert.deepEqual(await off.hooks.fire('agent.prompt.before', event), { kind: 'continue', event })
  await off.deactivate()

  const rules = await mountWorker(main, { host: mockHost({ settings: { autoEnhanceMode: 'rules', autoEnhanceAppend: 'Run the tests.' } }) })
  const appended = await rules.hooks.fire('agent.prompt.before', event)
  assert.equal(appended.kind === 'continue' && appended.event.prompt, 'add a login page\n\nRun the tests.')
  await rules.deactivate()

  const calls = stubFetch(() => openaiAnswer('Build a login page with email + password.'))
  const ai = await mountWorker(main, {
    host: mockHost({
      settings: { autoEnhanceMode: 'ai' },
      storage: { models: { profiles: [profile('slow', 'anthropic'), profile('fast', 'groq')], hookProfileId: 'fast' } },
      secrets: { 'apiKey.slow': 'a', 'apiKey.fast': 'g' },
      results: hostFor(null)
    })
  })
  const rewritten = await ai.hooks.fire('agent.prompt.before', event)
  assert.equal(rewritten.kind === 'continue' && rewritten.event.prompt, 'Build a login page with email + password.')
  assert.ok(calls[0].url.startsWith('https://api.groq.com'))
  await ai.deactivate()
})

test('cycle command switches auto-enhance mode', async () => {
  const host = mockHost({ results: { 'statusBar.update': { ok: true } } })
  const worker = await mountWorker(main, { host })
  assert.equal(await worker.command('auto-enhance.cycle'), 'Auto-enhance: rules')
  assert.equal(host.data().settings.autoEnhanceMode, 'rules')
  assert.equal(await worker.command('auto-enhance.off'), 'Auto-enhance: off')
  await worker.deactivate()
})

test('a long send closes its bracketed paste when a later piece is refused or fails', async () => {
  for (const failure of ['refuse', 'throw'] as const) {
    let calls = 0
    const host = mockHost({
      results: {
        'terminal.sendText': () => {
          calls++
          if (calls === 2) {
            if (failure === 'throw') throw Object.assign(new Error('terminal gone'), { code: 'action_failed' })
            return { accepted: false }
          }
          return { accepted: true }
        }
      }
    })
    const worker = await mountWorker(main, { host })
    const run = worker.request('prompt.send', { terminalId: 't1', text: 'line\n'.repeat(2000) })
    if (failure === 'throw') await assert.rejects(run, /terminal gone/)
    else assert.deepEqual(await run, { accepted: false })
    const texts = (host.callsOf('terminal.sendText') as { text: string }[]).map((call) => call.text)
    assert.ok(texts[0].startsWith('\x1b[200~'))
    assert.equal(texts.at(-1), '\x1b[201~', `${failure}: the paste is closed`)
    await worker.deactivate()
  }
})

test('a long send that succeeds writes every piece once and no extra paste end', async () => {
  const host = mockHost({ results: { 'terminal.sendText': { accepted: true } } })
  const worker = await mountWorker(main, { host })
  const text = 'line\n'.repeat(2000)
  assert.deepEqual(await worker.request('prompt.send', { terminalId: 't1', text }), { accepted: true })
  const texts = (host.callsOf('terminal.sendText') as { text: string }[]).map((call) => call.text)
  assert.ok(texts.length >= 3)
  assert.equal(texts.join(''), '\x1b[200~' + text.trim() + '\x1b[201~')
  await worker.deactivate()
})

test('editing a profile from its card keeps "follow the preset" (no preset value written in)', async () => {
  const stored = profile('gpt', 'openai', { baseUrl: '', model: '' })
  const host = mockHost({ storage: { models: { profiles: [stored] } }, secrets: { 'apiKey.gpt': 'sk-test' } })
  const worker = await mountWorker(main, { host })
  const view = await worker.request('models.get')
  const card = view.profiles[0]
  assert.equal(card.baseUrl, '')
  assert.equal(card.model, '')
  assert.equal(card.effectiveBaseUrl, 'https://api.openai.com/v1')
  assert.equal(card.effectiveModel, 'gpt-4.1-mini')
  // What the panel's Disable button sends: the card as it is, with enabled flipped.
  await worker.request('models.save', { ...card, enabled: false })
  const saved = (host.data().storage.models as { profiles: Record<string, unknown>[] }).profiles[0]
  assert.equal(saved.baseUrl, '')
  assert.equal(saved.model, '')
  assert.equal(saved.enabled, false)
  // A model the person picks is stored as is, even when it equals the preset's.
  await worker.request('models.save', { ...card, model: 'gpt-4.1-mini' })
  assert.equal((host.data().storage.models as { profiles: Record<string, unknown>[] }).profiles[0].model, 'gpt-4.1-mini')
  await worker.deactivate()
})

test('a panel run answers within its budget even when every model of the chain hangs', async () => {
  const saved = main.RUN_LIMITS.budgetMs
  main.RUN_LIMITS.budgetMs = 400
  globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as typeof fetch
  const host = mockHost({
    storage: { models: { profiles: [profile('one', 'openai'), profile('two', 'groq')] } },
    secrets: { 'apiKey.one': 'k1', 'apiKey.two': 'k2' },
    settings: { timeoutSeconds: 60, fallbackEnabled: true }
  })
  const worker = await mountWorker(main, { host })
  const started = Date.now()
  try {
    await assert.rejects(worker.request('prompt.enhance', { prompt: 'fix it', level: 'off' }))
    assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`)
    assert.equal(host.data().storage.history, undefined)
  } finally {
    main.RUN_LIMITS.budgetMs = saved
    await worker.deactivate()
  }
})

test('when the panel stops waiting, a late answer is dropped and not saved to history', async () => {
  globalThis.fetch = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 60))
    return new Response(JSON.stringify(openaiAnswer('late answer')), { status: 200 })
  }) as typeof fetch
  const host = mockHost({ storage: { models: { profiles: [profile('one', 'openai')] } }, secrets: { 'apiKey.one': 'k1' } })
  let orca: Parameters<typeof main.default>[0] | null = null
  const worker = await mountWorker({ default: (api: Parameters<typeof main.default>[0]) => { orca = api; main.default(api) } }, { host })
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 10)
  await assert.rejects(main.enhanceRequest(orca!, { prompt: 'fix it', level: 'off' }, controller.signal, 'enhance'), /Cancelled/)
  assert.equal(host.data().storage.history, undefined)
  await worker.deactivate()
})
