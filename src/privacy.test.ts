// The Privacy switches are enforced by the worker, not just hidden in the panel.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const profile = { id: 'oa', name: 'OpenAI', preset: 'openai', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', temperature: 0.3, maxTokens: 2000, enabled: true, command: '', args: '' }

function stubFetch(): void {
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })) as typeof fetch
}

function hostWith(settings: Record<string, boolean>, root: string | null = null) {
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
  const root = mkdtempSync(join(tmpdir(), 'privacy-'))
  writeFileSync(join(root, 'AGENTS.md'), 'secret rules')
  const worker = await mountWorker(main, { host: hostWith({ allowProjectFiles: false }, root) })
  const answer = await worker.request('prompt.enhance', { prompt: 'do it', level: 'standard' })
  assert.deepEqual(answer.context.map((item) => item.id), ['workspace'])
  assert.ok(answer.notes.some((note) => /Privacy/.test(note)))
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
