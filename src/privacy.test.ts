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

const profile = { id: 'oa', name: 'OpenAI', preset: 'openai', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', temperature: 0.3, maxTokens: 2000, enabled: true, command: '', args: '' }

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
  await assert.rejects(worker.request('prompt.send', { terminalId: 't1', text: 'hi' }), /off in Privacy/)
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
  assert.match(catalog.error ?? '', /off in Privacy/)
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
  const { mount } = await import('orca/testing')
  const panel = await import('./panel.tsx')
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
  const view = await mount(panel, { host, persisted: { plugin: { tab: 'privacy' } } })
  assert.ok(view.find({ text: /Open an issue on GitHub: it is how the plugin gets fixed/ }))
  await view.press({ role: 'button', text: 'Open an issue on GitHub' })
  const opened = host.callsOf('shell.openExternal') as { url: string }[]
  assert.deepEqual(opened.map((call) => call.url), ['https://github.com/cattfan/orca-enhance-prompt/issues/new'])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
