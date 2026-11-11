// The Privacy switches are enforced by the worker, not just hidden in the panel.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { after } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker.ts'

// A test that stubs fetch never leaks it into the next one.
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

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

const profile = { id: 'oa', name: 'OpenAI', preset: 'openai', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', maxTokens: 2000, enabled: true, command: '', args: '' }

function stubFetch(): void {
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })) as typeof fetch
}

function hostWith(settings: Record<string, boolean | string>, root: string | null = null) {
  return mockHost({
    settings,
    storage: { models: { profiles: [profile] } },
    secrets: { 'apiKey.oa': 'k' },
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'demo', terminals: [] },
      'workspace.list': { workspaces: root ? [{ id: 'w', kind: 'folder', name: 'demo', path: root, branch: 'main', hostId: null }] : [], truncated: false },
      'agents.list': { agents: [] },
      'terminal.sendText': { accepted: true }
    }
  })
}

test('project files off: Standard falls back to workspace and agent only', async () => {
  stubFetch()
  const root = tempDir('privacy-')
  writeFileSync(join(root, 'AGENTS.md'), 'secret rules')
  const worker = await mountWorker(main, { host: hostWith({ allowProjectFiles: false }, root) })
  const answer = await worker.request('prompt.enhance', { prompt: 'do it', level: 'standard' })
  assert.deepEqual(answer.context.map((item) => item.id), ['workspace'])
  assert.ok(answer.notes.some((note) => note.code === 'note.project_files_off'))
  await worker.deactivate()
})

test('sending off: the worker refuses to type into terminals', async () => {
  const host = hostWith({ allowTerminalSend: false })
  const worker = await mountWorker(main, { host })
  await assert.rejects(worker.request('prompt.send', { terminalId: 't1', text: 'hi' }), /off in Settings/)
  assert.equal(host.callsOf('terminal.sendText').length, 0)
  await worker.deactivate()
})

test('history off: nothing is saved', async () => {
  stubFetch()
  const host = hostWith({ saveHistory: false })
  const worker = await mountWorker(main, { host })
  await worker.request('prompt.enhance', { prompt: 'do it', level: 'off' })
  assert.equal(host.data().storage.history, undefined)
  await worker.deactivate()
})

test('environment keys off: a model without a saved key is not used', async () => {
  const previous = process.env.GROQ_API_KEY
  process.env.GROQ_API_KEY = 'from-env'
  try {
    const host = mockHost({ settings: { allowEnvKeys: false }, results: { 'workspace.readContext': null } })
    const worker = await mountWorker(main, { host })
    const view = await worker.request('models.get')
    assert.equal(view.fromEnv, false)
    assert.equal(view.profiles.length, 0)
    await worker.deactivate()
  } finally {
    if (previous === undefined) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = previous
  }
})

test('online lists off: no request to the provider', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  const worker = await mountWorker(main, { host: hostWith({ allowOnlineModelLists: false }) })
  const catalog = await worker.request('models.catalog', { preset: 'openai', profileId: 'oa' })
  assert.equal(calls, 0)
  assert.match(catalog.error ?? '', /off in Settings/)
  await worker.deactivate()
})

test('data summary and delete everything', async () => {
  stubFetch()
  const host = hostWith({})
  const worker = await mountWorker(main, { host })
  await worker.request('prompt.enhance', { prompt: 'do it', level: 'off' })
  assert.deepEqual(await worker.request('data.summary'), { history: 1, profiles: 1, keys: 1, catalogs: 0 })
  await worker.request('data.clear', { what: 'all' })
  assert.deepEqual(await worker.request('data.summary'), { history: 0, profiles: 0, keys: 0, catalogs: 0 })
  assert.equal(host.data().secrets['apiKey.oa'], undefined)
  await worker.deactivate()
})

test('Preview context obeys the same Privacy switches as a run', async () => {
  const root = tempDir('privacy-preview-')
  writeFileSync(join(root, 'AGENTS.md'), 'secret rules')
  const filesOff = await mountWorker(main, { host: hostWith({ allowProjectFiles: false }, root) })
  const preview = await filesOff.request('context.preview', { prompt: 'do it', level: 'standard' })
  assert.deepEqual(preview.context.map((item) => item.id), ['workspace'])
  assert.ok(preview.notes.some((note) => note.code === 'note.project_files_off'))
  await filesOff.deactivate()

  const terminalOff = await mountWorker(main, {
    host: mockHost({
      settings: { allowTerminalRead: false, allowGit: false },
      results: {
        'workspace.readContext': { branch: 'main', displayName: 'demo', terminals: [{ id: 't1', title: 'Claude' }] },
        'workspace.list': { workspaces: [{ id: 'w', kind: 'folder', name: 'demo', path: root, branch: 'main', hostId: null }], truncated: false },
        'agents.list': { agents: [] },
        'terminal.read': { lines: ['secret output'], truncated: false }
      }
    })
  })
  const max = await terminalOff.request('context.preview', { prompt: 'do it', level: 'max', terminalId: 't1' })
  const ids = max.context.map((item) => item.id)
  assert.ok(!ids.includes('terminal'), ids.join(','))
  assert.ok(!ids.some((id) => id.startsWith('git:')), ids.join(','))
  await terminalOff.deactivate()
})

test('auto-enhance (AI) leaves cached project context out while project files are off', async () => {
  const root = tempDir('privacy-hook-')
  writeFileSync(join(root, 'AGENTS.md'), 'Use pnpm, secret rules.')
  stubFetch()
  // Warm the cache with project files allowed.
  const warm = await mountWorker(main, { host: hostWith({}, root) })
  await warm.request('prompt.enhance', { prompt: 'warm up', level: 'standard' })
  await warm.deactivate()

  const bodies: string[] = []
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'rewritten' } }] }), { status: 200 })
  }) as typeof fetch
  const hook = await mountWorker(main, { host: hostWith({ autoEnhanceMode: 'ai', allowProjectFiles: false }, root) })
  const decision = await hook.hooks.fire('agent.prompt.before', { agent: 'claude', terminalId: 't1', prompt: 'add a login page', inputKind: 'launch' })
  assert.equal(decision.kind === 'continue' && decision.event.prompt, 'rewritten')
  assert.equal(bodies.length, 1)
  assert.ok(!bodies[0].includes('secret rules'))
  await hook.deactivate()
})

test('history keeps both entries when two runs finish at the same time', async () => {
  globalThis.fetch = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
  }) as typeof fetch
  const host = hostWith({})
  const worker = await mountWorker(main, { host })
  await Promise.all([
    worker.request('prompt.enhance', { prompt: 'first', level: 'off' }),
    worker.request('prompt.enhance', { prompt: 'second', level: 'off' }),
    worker.request('prompt.enhance', { prompt: 'third', level: 'off' })
  ])
  const history = host.data().storage.history as { original: string }[]
  assert.deepEqual(history.map((entry) => entry.original).sort(), ['first', 'second', 'third'])
  await worker.deactivate()
})

test('history changes run one after another, so a slow writer is never overtaken', async () => {
  const { withHistory } = await import('./worker.ts')
  let store: string[] = []
  const append = (name: string, delay: number) =>
    withHistory(async () => {
      const read = [...store]
      await new Promise((resolve) => setTimeout(resolve, delay))
      store = [name, ...read]
    })
  await Promise.all([append('slow', 30), append('fast', 0), append('third', 5)])
  assert.deepEqual(store, ['third', 'fast', 'slow'])
  // A failing change does not block the next one.
  await assert.rejects(withHistory(async () => Promise.reject(new Error('boom'))))
  await withHistory(async () => {
    store = ['after', ...store]
  })
  assert.equal(store[0], 'after')
})

test('the gear section links to GitHub issues for feedback', async () => {
  const { read } = await import('orca')
  const { mountPanel } = await import('./panel/testing.ts')
  const { openIssues } = await import('./panel/actions.ts')
  const { notice } = await import('./panel/state.ts')
  const { PRESETS } = await import('./presets.ts')
  const host = mockHost({
    requests: {
      'models.get': { profiles: [], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
      'targets.list': { targets: [] },
      'models.detect': { found: [] },
      'rules.get': { rules: [], structures: [] },
      'data.summary': { history: 0, profiles: 0, keys: 0, catalogs: 0 }
    }
  })
  const view = await mountPanel(host, { persisted: { plugin: { tab: 'privacy' } } })
  await openIssues()
  const opened = host.callsOf('shell.openExternal') as { url: string }[]
  assert.deepEqual(opened.map((call) => call.url), ['https://github.com/cattfan/orca-enhance-prompt/issues/new'])
  // Orca opens a site only on a click (there is none here) and may be told no: the panel then
  // shows the address to open by hand.
  assert.deepEqual(read(notice), { tone: 'neutral', text: 'Open https://github.com/cattfan/orca-enhance-prompt/issues/new in your browser.' })
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

// ---- other agents' sessions (Max level, Privacy "Read other agents' sessions", off by default)

const SESSIONS: Record<string, string[]> = {
  t1: ['target agent output'],
  t2: ['claude: refactoring src/auth.ts', 'export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456'],
  t3: ['codex: tests pass']
}
function agentsHost(settings: Record<string, boolean | string | number>, consented = true) {
  return mockHost({
    settings,
    // The switch also needs the person's confirmation in the panel (kept by the worker).
    storage: { models: { profiles: [profile] }, ...(consented ? { consents: { allowOtherAgents: true } } : {}) },
    secrets: { 'apiKey.oa': 'k' },
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'demo', terminals: [{ id: 't1', title: 'Claude' }] },
      'workspace.list': { workspaces: [], truncated: false },
      'agents.list': {
        agents: [
          { terminalId: 't1', title: 'Claude', agent: 'claude', state: 'waiting', stateStartedAt: Date.now() },
          { terminalId: 't2', title: 'Auth refactor', agent: 'claude', state: 'working', stateStartedAt: Date.now() - 120_000 },
          { terminalId: 't3', title: 'Tests', agent: 'codex', state: 'done', stateStartedAt: Date.now() - 600_000 },
          { terminalId: null, title: 'Detached', agent: 'gemini', state: 'done', stateStartedAt: 0 }
        ]
      },
      'terminal.read': (params: { terminalId: string }) => ({ lines: SESSIONS[params.terminalId] ?? [], truncated: false })
    }
  })
}
const readTerminals = (host: ReturnType<typeof agentsHost>) => host.callsOf('terminal.read').map((params) => (params as { terminalId: string }).terminalId)

test("other agents' sessions are not read while their switch is off (the default) or not confirmed, in a run and in Preview", async () => {
  stubFetch()
  const cases: [Record<string, boolean>, boolean][] = [
    [{}, true],
    [{ allowOtherAgents: true, allowTerminalRead: false }, true],
    // On in Orca's Settings but never confirmed in the panel.
    [{ allowOtherAgents: true }, false]
  ]
  for (const [settings, consented] of cases) {
    const host = agentsHost(settings, consented)
    const worker = await mountWorker(main, { host })
    const run = await worker.request('prompt.enhance', { prompt: 'do it', level: 'max', terminalId: 't1' })
    const preview = await worker.request('context.preview', { prompt: 'do it', level: 'max', terminalId: 't1' })
    for (const ids of [run.context.map((item) => item.id), preview.context.map((item) => item.id)]) {
      assert.ok(!ids.some((id) => id === 'agents' || id.startsWith('session:')), ids.join(','))
    }
    assert.ok(!readTerminals(host).some((id) => id === 't2' || id === 't3'), readTerminals(host).join(','))
    await worker.deactivate()
  }
})

test("with the switch on, Max reads the other agents (not the target), masks secrets, and obeys unticking", async () => {
  stubFetch()
  const host = agentsHost({ allowOtherAgents: true })
  const worker = await mountWorker(main, { host })
  for (const kind of ['prompt.enhance', 'context.preview'] as const) {
    const answer = await worker.request(kind, { prompt: 'do it', level: 'max', terminalId: 't1' })
    const ids = answer.context.map((item) => item.id)
    assert.ok(ids.includes('agents') && ids.includes('session:t2') && ids.includes('session:t3'), ids.join(','))
    assert.ok(!ids.includes('session:t1'), ids.join(','))
  }
  // Below Max nothing of it is read.
  const before = readTerminals(host).length
  const deep = await worker.request('context.preview', { prompt: 'do it', level: 'deep', terminalId: 't1' })
  assert.ok(!deep.context.some((item) => item.id === 'agents'))
  assert.equal(readTerminals(host).length, before)
  // Unticked: not read at all.
  const others = () => readTerminals(host).filter((id) => id !== 't1').length
  const othersBefore = others()
  const unticked = await worker.request('context.preview', { prompt: 'do it', level: 'max', terminalId: 't1', exclude: ['agents'] })
  assert.ok(!unticked.context.some((item) => item.id === 'agents' || item.id.startsWith('session:')))
  assert.equal(others(), othersBefore)
  // The session text the model sees has its secrets masked.
  const masked = await worker.request('context.preview', { prompt: 'do it', level: 'max', terminalId: 't1' })
  assert.equal(masked.context.find((item) => item.id === 'session:t2')?.chars, ['claude: refactoring src/auth.ts', 'export OPENAI_API_KEY=[redacted]'].join('\n').length)
  await worker.deactivate()
})

test("auto-enhance never reads other agents' sessions (its 2 s budget), even with the switch on", async () => {
  stubFetch()
  const host = agentsHost({ allowOtherAgents: true, autoEnhanceMode: 'ai' })
  const worker = await mountWorker(main, { host })
  await worker.hooks.fire('agent.prompt.before', { agent: 'claude', terminalId: 't1', prompt: 'add a login page', inputKind: 'launch' })
  assert.equal(readTerminals(host).length, 0)
  await worker.deactivate()
})

test("the number of agents and lines set for other agents' sessions is what a Max run reads", async () => {
  stubFetch()
  const host = agentsHost({ allowOtherAgents: true, otherAgentsMax: 1, otherAgentsLines: 25 })
  const worker = await mountWorker(main, { host })
  for (const kind of ['prompt.enhance', 'context.preview'] as const) {
    const answer = await worker.request(kind, { prompt: 'do it', level: 'max', terminalId: 't1' })
    const sessions = answer.context.filter((item) => item.id.startsWith('session:')).map((item) => item.id)
    // One agent: the busiest other one (t2 is working, t3 is done).
    assert.deepEqual(sessions, ['session:t2'])
  }
  const reads = host.callsOf('terminal.read').map((params) => params as { terminalId: string; maxLines: number }).filter((read) => read.terminalId !== 't1')
  assert.ok(reads.length > 0 && reads.every((read) => read.maxLines === 25), JSON.stringify(reads))
  await worker.deactivate()
})

test('out-of-range or wrong amounts are brought back within their limits; while off they read nothing', async () => {
  const { parseOtherAgentsLimits } = await import('./privacy.ts')
  assert.deepEqual(parseOtherAgentsLimits({}), { agents: 4, lines: 80 })
  assert.deepEqual(parseOtherAgentsLimits({ otherAgentsMax: 0, otherAgentsLines: -5 }), { agents: 1, lines: 10 })
  assert.deepEqual(parseOtherAgentsLimits({ otherAgentsMax: 9999, otherAgentsLines: 1e9 }), { agents: 8, lines: 300 })
  assert.deepEqual(parseOtherAgentsLimits({ otherAgentsMax: 'abc', otherAgentsLines: null }), { agents: 4, lines: 80 })
  assert.deepEqual(parseOtherAgentsLimits({ otherAgentsMax: '3', otherAgentsLines: 2.6 * 10 }), { agents: 3, lines: 26 })

  stubFetch()
  // Amounts changed while the switch is off, or on but not confirmed: no other terminal is read.
  for (const [settings, consented] of [
    [{ otherAgentsMax: 8, otherAgentsLines: 300 }, true],
    [{ allowOtherAgents: true, otherAgentsMax: 8, otherAgentsLines: 300 }, false]
  ] as const) {
    const host = agentsHost(settings, consented)
    const worker = await mountWorker(main, { host })
    await worker.request('context.preview', { prompt: 'do it', level: 'max', terminalId: 't1' })
    assert.ok(!readTerminals(host).some((id) => id !== 't1'))
    await worker.deactivate()
  }
  // Huge values from Orca's Settings are clamped before any read.
  const host = agentsHost({ allowOtherAgents: true, otherAgentsMax: 50, otherAgentsLines: 100000 })
  const worker = await mountWorker(main, { host })
  await worker.request('context.preview', { prompt: 'do it', level: 'max', terminalId: 't1' })
  const reads = host.callsOf('terminal.read').map((params) => params as { terminalId: string; maxLines: number }).filter((read) => read.terminalId !== 't1')
  assert.ok(reads.length === 2 && reads.every((read) => read.maxLines === 300), JSON.stringify(reads))
  await worker.deactivate()
})
