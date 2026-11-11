// Runs src/worker.ts's activate(orca) over a mock host, with fetch stubbed (no network).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { after } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { forgetTerminals, terminalsSaved } from './context/terminals.ts'
import * as main from './worker.ts'

// Every temporary folder a test makes is removed when the file's tests are done.
const tempDirs: string[] = []
after(() => {
  for (const folder of tempDirs) {
    try {
      rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch {
      // still in use (Windows): the OS temp cleaner gets it
    }
  }
})
function tempDir(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(folder)
  return folder
}

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

afterEach(async () => {
  globalThis.fetch = realFetch
  // What one test's worker learnt about terminals is not the next test's (one process runs them all).
  await forgetTerminals()
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
    maxTokens: 2000,
    enabled: true,
    ...extra
  }
}

function project(): string {
  const root = tempDir('enhance-prompt-')
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
  let view = await worker.request('models.save', { name: 'GPT', preset: 'openai', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1', maxTokens: 4000, enabled: true, apiKey: ' sk-1 ' })
  const gpt = view.profiles[0]
  assert.equal(gpt.keySource, 'secret')
  assert.equal(host.data().secrets[`apiKey.${gpt.id}`], 'sk-1')
  view = await worker.request('models.save', { name: 'Local', preset: 'ollama', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen', maxTokens: 2000, enabled: true })
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

test("a workspace on this machine is read even when Orca names its host 'local' (Orca 1.4.25x)", async () => {
  const root = project()
  stubFetch(() => openaiAnswer('ok'))
  const host = mockHost({
    storage: { models: { profiles: [profile('one', 'openai')] } },
    secrets: { 'apiKey.one': 'k' },
    results: {
      'workspace.readContext': { branch: 'feat/publish-unify-ui', displayName: 'feat/publish-unify-ui', terminals: [] },
      'workspace.list': {
        workspaces: [
          { id: 'w-local', kind: 'worktree', name: 'feat/publish-unify-ui', path: root, branch: 'feat/publish-unify-ui', hostId: 'local' },
          { id: 'w-ssh', kind: 'worktree', name: 'remote', path: '/srv/app', branch: 'main', hostId: 'ssh-1' }
        ],
        truncated: false
      },
      'agents.list': { agents: [] }
    }
  })
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('prompt.enhance', { prompt: 'fix validateSession', level: 'deep' })
  const ids = answer.context.map((item) => item.id)
  assert.ok(ids.includes('rules:AGENTS.md'), ids.join(','))
  assert.ok(ids.some((id) => id.startsWith('file:')), ids.join(','))
  assert.ok(!answer.notes.some((note) => note.code === 'note.remote'))
  await worker.deactivate()

  // A workspace on another host (SSH/WSL) is still skipped.
  host.respond('workspace.readContext', { branch: 'main', displayName: 'remote', terminals: [] })
  const remote = await mountWorker(main, { host })
  const far = await remote.request('prompt.enhance', { prompt: 'fix it', level: 'standard' })
  assert.ok(far.notes.some((note) => note.code === 'note.remote'))
  await remote.deactivate()
})

test('several workspaces named "main" on branch main: the panel\'s hint or the person\'s pick says which folder', async () => {
  const one = project()
  const two = project()
  writeFileSync(join(two, 'AGENTS.md'), '# Rules\nThis is the second checkout.')
  stubFetch(() => openaiAnswer('ok'))
  const host = mockHost({
    storage: { models: { profiles: [profile('one', 'openai')] } },
    secrets: { 'apiKey.one': 'k' },
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'main', terminals: [{ id: 'term-2', title: 'Claude' }] },
      'workspace.list': {
        workspaces: [
          { id: 'ws-1', kind: 'worktree', name: 'main', path: one, branch: 'main', hostId: 'local' },
          { id: 'ws-2', kind: 'worktree', name: 'main', path: two, branch: 'main', hostId: 'local' }
        ],
        truncated: false
      },
      'agents.list': { agents: [] }
    }
  })
  const worker = await mountWorker(main, { host })
  // Nothing known: Orca cannot tell, so the panel gets the folders to pick from.
  const unknown = await worker.request('targets.list', {})
  assert.equal(unknown.workspaceId, null)
  assert.deepEqual(unknown.choices?.map((choice) => choice.id), ['ws-1', 'ws-2'])
  // The panel knows term-2 is in ws-2 (from Orca's agent events, or the pick).
  const known = await worker.request('targets.list', { known: { 'term-2': 'ws-2' } })
  assert.equal(known.workspaceId, 'ws-2')
  assert.equal(known.choices, undefined)
  // A run in that workspace reads that folder.
  const bodies: string[] = []
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body))
    return new Response(JSON.stringify(openaiAnswer('ok')), { status: 200 })
  }) as typeof fetch
  const answer = await worker.request('prompt.enhance', { prompt: 'fix it', level: 'standard', workspaceId: 'ws-2' })
  assert.ok(answer.context.some((item) => item.id === 'rules:AGENTS.md'))
  assert.match(bodies[0], /second checkout/)
  // A hint that no longer fits the focused workspace is not trusted.
  const stale = await worker.request('context.preview', { prompt: 'x', level: 'standard', workspaceId: 'ws-gone' })
  assert.ok(stale.notes.some((note) => note.code === 'note.workspace_unknown'))
  await worker.deactivate()
})

// What the real Orca answers (host API 1.5, seen on Windows): workspace.list names a Git worktree
// "identity:…" and writes its path with forward slashes; agent events and tool hooks carry the
// worktree's own id, "<repository id>::<path>", with the platform's slashes. Every project's first
// checkout is named after its branch, so seven projects were "main" on "main".
const listedPath = (path: string) => path.replace(/\\/g, '/')
function twoMains(one: string, two: string, terminals: { id: string; title: string }[]) {
  return mockHost({
    storage: { models: { profiles: [profile('one', 'openai')] } },
    secrets: { 'apiKey.one': 'k' },
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'main', terminals },
      'workspace.list': {
        workspaces: [
          { id: 'identity:wt2:local:1111', kind: 'worktree', name: 'main', project: 'Shop', path: listedPath(one), branch: 'main', hostId: 'local' },
          { id: 'identity:wt2:local:2222', kind: 'worktree', name: 'main', project: 'Reup', path: listedPath(two), branch: 'main', hostId: 'local' }
        ],
        truncated: false
      },
      'agents.list': { agents: [] }
    }
  })
}

test('several projects named "main": Orca\'s agent event tells which one is open, with nothing to pick', async () => {
  const one = project()
  const two = project()
  writeFileSync(join(two, 'AGENTS.md'), '# Rules\nThis is the second checkout.')
  const calls = stubFetch(() => openaiAnswer('ok'))
  const host = twoMains(one, two, [
    { id: 'term_agent', title: 'Claude' },
    { id: 'term_shell', title: 'pwsh' }
  ])
  const worker = await mountWorker(main, { host })
  // Orca has said nothing yet: the folders to pick from, each with its project's name.
  const before = await worker.request('targets.list', {})
  assert.equal(before.workspaceId, null)
  // Which project this is cannot be said yet: its rules are kept under its own name, not under "main".
  assert.equal(before.project, null)
  assert.deepEqual(before.choices, [
    { id: 'identity:wt2:local:1111', path: listedPath(one), project: 'Shop' },
    { id: 'identity:wt2:local:2222', path: listedPath(two), project: 'Reup' }
  ])
  // The agent of the second project changes state. Its workspace comes as the worktree's own id.
  await worker.emit('agent.status.changed', { workspaceId: `repo-two::${two}`, paneKey: 'p', terminalId: 'term_agent', state: 'done', receivedAt: Date.now() })
  const after = await worker.request('targets.list', {})
  assert.equal(after.workspaceId, 'identity:wt2:local:2222')
  assert.equal(after.workspacePath, listedPath(two))
  assert.equal(after.project, 'Reup')
  assert.equal(after.choices, undefined)
  // A run reads that project, and the rewriter is told its name: "main" alone names nothing.
  const answer = await worker.request('prompt.enhance', { prompt: 'fix it', level: 'standard' })
  assert.match(JSON.stringify(calls.at(-1)?.body), /second checkout/)
  assert.match(JSON.stringify(calls.at(-1)?.body), /Reup: main \(branch main\)/)
  assert.ok(!answer.notes.some((note) => note.code === 'note.workspace_unknown'))
  // The folder the person once picked by mistake does not win over what Orca said.
  const mistaken = await worker.request('targets.list', { known: { term_agent: 'identity:wt2:local:1111', term_shell: 'identity:wt2:local:1111' } })
  assert.equal(mistaken.workspaceId, 'identity:wt2:local:2222')
  // The pairing is kept (two ids per terminal, nothing else), the plain shell of that project too.
  await terminalsSaved()
  assert.deepEqual(host.data().storage.terminalWorkspaces, { term_agent: `repo-two::${two}`, term_shell: `repo-two::${two}` })
  await worker.deactivate()

  // A new worker (Orca restarted, or the plugin was updated) with only the shell left open: known.
  await forgetTerminals()
  host.respond('workspace.readContext', { branch: 'main', displayName: 'main', terminals: [{ id: 'term_shell', title: 'pwsh' }] })
  const restarted = await mountWorker(main, { host })
  assert.equal((await restarted.request('targets.list', {})).workspaceId, 'identity:wt2:local:2222')
  // "Delete everything" forgets it, here and in storage.
  await restarted.request('data.clear', { what: 'all' })
  assert.equal(host.data().storage.terminalWorkspaces, undefined)
  assert.equal((await restarted.request('targets.list', {})).workspaceId, null)
  await restarted.deactivate()
})

test('several projects named "main": a tool hook says it too, and the panel\'s own note of an event is understood', async () => {
  const one = project()
  const two = project()
  stubFetch(() => openaiAnswer('ok'))
  const host = twoMains(one, two, [{ id: 'term_agent', title: 'Claude' }])
  const worker = await mountWorker(main, { host })
  // The panel heard the event itself and kept the id as it came (not the list's id): understood.
  const fromPanel = await worker.request('targets.list', { known: { term_agent: `repo-one::${one}` } })
  assert.equal(fromPanel.workspaceId, 'identity:wt2:local:1111')
  // An agent runs a tool in this terminal: the hook names the workspace. The switch for what agents
  // do is off, so nothing of the call is kept: only which workspace the terminal is in.
  await worker.hooks.fire('agent.tool.after', { agent: 'claude', workspaceId: `repo-two::${two}`, terminalId: 'term_agent', tool: 'Bash', input: { command: 'pnpm test' }, output: 'SECRET OUTPUT' })
  assert.equal((await worker.request('targets.list', {})).workspaceId, 'identity:wt2:local:2222')
  await terminalsSaved()
  assert.deepEqual(host.data().storage.terminalWorkspaces, { term_agent: `repo-two::${two}` })
  assert.ok(!JSON.stringify(host.data().storage).includes('pnpm test') && !JSON.stringify(host.data().storage).includes('SECRET OUTPUT'))
  const deep = await worker.request('context.preview', { prompt: 'fix it', level: 'deep' })
  assert.ok(!deep.context.some((item) => item.id === 'activity'))
  // An event for a folder that is not listed (or without a terminal) changes nothing.
  await worker.emit('agent.status.changed', { workspaceId: 'repo-x::/nowhere/else', paneKey: 'p', terminalId: 'term_other', state: 'working', receivedAt: Date.now() })
  await worker.emit('agent.status.changed', { workspaceId: null, paneKey: 'p', state: 'working', receivedAt: Date.now() })
  assert.equal((await worker.request('targets.list', {})).workspaceId, 'identity:wt2:local:2222')
  await worker.deactivate()
})
