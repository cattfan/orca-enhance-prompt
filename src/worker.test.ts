// Runs src/worker.ts's activate(orca) over a mock host, with fetch stubbed (no network).
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

type Captured = { url: string; body: Record<string, unknown>; headers: Record<string, string> }
const realFetch = globalThis.fetch

function stubFetch(answer: (call: Captured) => unknown, status = 200): Captured[] {
  const calls: Captured[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
    }
    calls.push(call)
    return new Response(JSON.stringify(answer(call)), {
      status,
      headers: { 'content-type': 'application/json' }
    })
  }) as typeof fetch
  return calls
}

afterEach(() => {
  globalThis.fetch = realFetch
})

const workspace = {
  'workspace.readContext': { branch: 'main', displayName: 'demo', terminals: [{ id: 't1', title: 'Claude' }] },
  'workspace.list': { workspaces: [], truncated: false },
  'agents.list': {
    agents: [{ terminalId: 't1', title: 'Claude', agent: 'claude', state: 'waiting', stateStartedAt: 0 }]
  }
}

test('enhances with an OpenAI-compatible endpoint and records history', async () => {
  const calls = stubFetch(() => ({ choices: [{ message: { content: '```\nAdd a dark mode toggle.\n```' } }] }))
  const host = mockHost({ secrets: { 'apiKey.openai': 'sk-test' }, results: workspace })
  const worker = await mountWorker(main, { host })

  const answer = await worker.request('prompt.enhance', { prompt: 'dark mode pls', style: 'concise', terminalId: 't1' })
  assert.equal(answer.enhanced, 'Add a dark mode toggle.')
  assert.equal(answer.model, 'gpt-4.1-mini')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(calls[0].headers.authorization, 'Bearer sk-test')
  const messages = calls[0].body.messages as { role: string; content: string }[]
  assert.match(messages[1].content, /dark mode pls/)
  assert.match(messages[1].content, /Workspace: demo \(branch main\)/)
  assert.match(messages[1].content, /Target agent: claude/)

  const history = host.data().storage.history as { original: string; enhanced: string }[]
  assert.equal(history.length, 1)
  assert.equal(history[0].enhanced, 'Add a dark mode toggle.')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('uses the Anthropic messages API', async () => {
  const calls = stubFetch(() => ({ content: [{ type: 'text', text: 'Fix the login bug.' }] }))
  const host = mockHost({
    settings: { provider: 'anthropic', includeWorkspaceContext: false, includeProjectFiles: false },
    secrets: { 'apiKey.anthropic': 'ak-test' }
  })
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('prompt.enhance', { prompt: 'login broken' })
  assert.equal(answer.enhanced, 'Fix the login bug.')
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages')
  assert.equal(calls[0].headers['x-api-key'], 'ak-test')
  assert.equal(calls[0].body.model, 'claude-haiku-4-5')
  await worker.deactivate()
})

test('reports a missing key and API errors', async () => {
  const previous = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  try {
    const worker = await mountWorker(main, { host: mockHost({ results: workspace }) })
    await assert.rejects(worker.request('prompt.enhance', { prompt: 'hello there' }), /No API key/)
    const status = await worker.request('config.status')
    assert.equal(status.keySource, 'none')
    await worker.deactivate()

    stubFetch(() => ({ error: { message: 'Invalid API key' } }), 401)
    const keyed = await mountWorker(main, {
      host: mockHost({ results: workspace, secrets: { 'apiKey.openai': 'bad' } })
    })
    const test = await keyed.request('config.test')
    assert.equal(test.ok, false)
    assert.match(test.message, /401: Invalid API key/)
    await keyed.deactivate()
  } finally {
    if (previous !== undefined) {
      process.env.OPENAI_API_KEY = previous
    }
  }
})

test('refuses a non-https remote base URL', async () => {
  stubFetch(() => ({}))
  const worker = await mountWorker(main, {
    host: mockHost({ settings: { baseUrl: 'http://example.com/v1' }, secrets: { 'apiKey.openai': 'k' }, results: workspace })
  })
  await assert.rejects(worker.request('prompt.enhance', { prompt: 'something' }), /must use https/)
  await worker.deactivate()
})

test('sends to a terminal with bracketed paste and lists targets', async () => {
  const host = mockHost({ results: { ...workspace, 'terminal.sendText': { accepted: true } } })
  const worker = await mountWorker(main, { host })
  const { targets } = await worker.request('targets.list')
  assert.deepEqual(targets.map((target) => target.terminalId), ['t1'])

  await worker.request('prompt.send', { terminalId: 't1', text: 'line one\nline two', enter: true })
  const sent = host.callsOf('terminal.sendText') as { text: string; enter?: boolean }[]
  assert.equal(sent[0].text, '\x1b[200~line one\nline two\x1b[201~')
  assert.equal(sent[1].text, '\r')
  await worker.deactivate()
})

test('stores and removes the API key', async () => {
  const host = mockHost({ results: workspace })
  const worker = await mountWorker(main, { host })
  await worker.request('config.setKey', { provider: 'anthropic', key: '  ak-1  ' })
  assert.equal(host.data().secrets['apiKey.anthropic'], 'ak-1')
  await worker.request('config.setKey', { provider: 'anthropic', key: '' })
  assert.equal(host.data().secrets['apiKey.anthropic'], undefined)
  await worker.deactivate()
})

test('auto-enhance hook: off passes, rules appends, AI rewrites', async () => {
  const event = { agent: 'claude', terminalId: 't1', prompt: 'add a login page', inputKind: 'launch' as const }

  const off = await mountWorker(main, { host: mockHost() })
  assert.deepEqual(await off.hooks.fire('agent.prompt.before', event), { kind: 'continue', event })
  await off.deactivate()

  const rules = await mountWorker(main, {
    host: mockHost({ settings: { autoEnhanceMode: 'rules', autoEnhanceAppend: 'Run the tests.' } })
  })
  const appended = await rules.hooks.fire('agent.prompt.before', event)
  assert.equal(appended.kind, 'continue')
  assert.equal(appended.kind === 'continue' && appended.event.prompt, 'add a login page\n\nRun the tests.')
  await rules.deactivate()

  stubFetch(() => ({ choices: [{ message: { content: 'Build a login page with email + password.' } }] }))
  const ai = await mountWorker(main, {
    host: mockHost({ settings: { autoEnhanceMode: 'ai' }, secrets: { 'apiKey.openai': 'k' }, results: workspace })
  })
  const rewritten = await ai.hooks.fire('agent.prompt.before', event)
  assert.equal(rewritten.kind === 'continue' && rewritten.event.prompt, 'Build a login page with email + password.')
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
