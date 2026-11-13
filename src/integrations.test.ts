// Orca integrations, each behind its own Privacy switch (and a confirmation for the risky ones):
// what agents do, files saved in the editor, starting a new agent, opening a file, notifications.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { after } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { forgetActivity, recordTool, toolTarget, agentActivity } from './context/activity.ts'
import { redactSecrets } from './context/agents.ts'
import { forgetTerminals, terminalsSaved } from './context/terminals.ts'
import { relativeTo } from './context/index.ts'
import * as main from './worker.ts'

const realFetch = globalThis.fetch
afterEach(async () => {
  globalThis.fetch = realFetch
  forgetActivity()
  await forgetTerminals()
})
const root = mkdtempSync(join(tmpdir(), 'integrations-'))
writeFileSync(join(root, 'login.ts'), 'export function login() {}\n')
after(() => rmSync(root, { recursive: true, force: true }))

// The two names Orca has for one workspace (workspaces.ts): the id workspace.list answers and takes
// (agent.launch, editor.open), and the id its hooks and events carry, "<repository id>::<path>".
const WS = 'identity:wt2:local:test'
const EVENT_WS = `repo-demo::${root}`
const LISTED = { id: WS, path: root.replace(/\\/g, '/') }
const profile = { id: 'oa', name: 'OpenAI', preset: 'openai', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', maxTokens: 2000, enabled: true, command: '', args: '' }

function host(settings: Record<string, boolean | string>, consents: Record<string, boolean> = {}) {
  return mockHost({
    settings,
    storage: { models: { profiles: [profile] }, consents },
    secrets: { 'apiKey.oa': 'k' },
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'demo', terminals: [] },
      'workspace.list': { workspaces: [{ id: WS, kind: 'worktree', name: 'demo', project: 'demo', path: LISTED.path, branch: 'main', hostId: 'local' }], truncated: false },
      'agents.list': { agents: [] },
      'agent.launch': { terminalId: 'new-1' },
      'editor.open': { opened: true },
      'notifications.show': { delivered: true }
    }
  })
}
/** Lets the worker read its switches after mounting (they are refreshed in the background). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
const tool = { agent: 'claude', workspaceId: EVENT_WS, terminalId: 't1', tool: 'Bash', input: { command: 'pnpm test --filter auth API_KEY=abcdef123456' }, output: 'SECRET OUTPUT' }

test('tool targets: a path or a command, masked; never the output', () => {
  assert.equal(toolTarget({ file_path: 'src/login.ts', content: 'x' }), 'src/login.ts')
  assert.equal(toolTarget({ command: 'export TOKEN=abcdef123456 && pnpm build' }), 'export TOKEN=[redacted] && pnpm build')
  // Kept under the id of the hook, read for the workspace as the list names it: the same folder.
  recordTool({ agent: 'codex', workspaceId: EVENT_WS, tool: 'Edit', input: { path: 'a.ts' } }, 1000)
  assert.match(agentActivity(LISTED, 1000), /codex · Edit: a\.ts/)
  assert.equal(agentActivity({ id: 'identity:wt2:local:other', path: join(root, 'other') }, 1000), '')
  // An Orca whose hooks carry the list's id (a folder workspace, an older version) is found as well.
  recordTool({ agent: 'claude', workspaceId: WS, tool: 'Read', input: { path: 'b.ts' } }, 2000)
  assert.match(agentActivity(LISTED, 2000), /codex · Edit: a\.ts[^]*claude · Read: b\.ts/)
})

test('paths saved in the editor become relative to the workspace; outside ones are dropped', () => {
  assert.equal(relativeTo('C:/repo', 'C:\\repo\\src\\a.ts'), 'src/a.ts')
  assert.equal(relativeTo('/home/me/repo', '/home/me/repo/src/a.ts'), 'src/a.ts')
  assert.equal(relativeTo('/home/me/repo', '/etc/passwd'), null)
  assert.equal(relativeTo('/repo', '../x'), null)
})

test('agent activity: not kept while off or unconfirmed; kept and sent at Deep once confirmed', async () => {
  for (const [settings, consents] of [
    [{}, {}],
    [{ allowAgentActivity: true }, {}]
  ] as const) {
    const worker = await mountWorker(main, { host: host(settings, consents) })
    await settle()
    await worker.hooks.fire('agent.tool.after', tool)
    const preview = await worker.request('context.preview', { prompt: 'fix auth', level: 'deep' })
    assert.ok(!preview.context.some((item) => item.id === 'activity'))
    await worker.deactivate()
  }
  const worker = await mountWorker(main, { host: host({ allowAgentActivity: true }, { allowAgentActivity: true }) })
  await settle()
  await worker.hooks.fire('agent.tool.after', tool)
  await worker.emit('agent.status.changed', { workspaceId: EVENT_WS, paneKey: 'p', terminalId: 't1', title: 'Auth', state: 'done', receivedAt: Date.now(), mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: Date.now() } })
  const deep = await worker.request('context.preview', { prompt: 'fix auth', level: 'deep' })
  const activity = deep.context.find((item) => item.id === 'activity')
  assert.ok(activity, deep.context.map((item) => item.id).join(','))
  // Standard reads none of it; unticked, it is left out.
  const standard = await worker.request('context.preview', { prompt: 'fix auth', level: 'standard' })
  assert.ok(!standard.context.some((item) => item.id === 'activity'))
  const unticked = await worker.request('context.preview', { prompt: 'fix auth', level: 'deep', exclude: ['activity'] })
  assert.ok(!unticked.context.some((item) => item.id === 'activity'))
  await worker.deactivate()
})

test('the model sees the tool and its masked target, never its output', async () => {
  const bodies: string[] = []
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
  }) as typeof fetch
  const worker = await mountWorker(main, { host: host({ allowAgentActivity: true }, { allowAgentActivity: true }) })
  await settle()
  await worker.hooks.fire('agent.tool.after', tool)
  await worker.request('prompt.enhance', { prompt: 'fix auth', level: 'deep' })
  assert.match(bodies[0], /claude · Bash: pnpm test --filter auth API_KEY=\[redacted\]/)
  assert.ok(!bodies[0].includes('SECRET OUTPUT') && !bodies[0].includes('abcdef123456'))
  await worker.deactivate()
})

test('editor saves: only the path, only while on; ranked into the context at Deep', async () => {
  const off = await mountWorker(main, { host: host({}) })
  await settle()
  const passed = await off.hooks.fire('editor.save.before', { workspaceId: EVENT_WS, path: join(root, 'login.ts'), text: 'secret text' })
  assert.equal(passed.kind, 'continue')
  assert.ok(!(await off.request('context.preview', { prompt: 'x', level: 'deep' })).context.some((item) => item.id === 'saved'))
  await off.deactivate()

  const on = await mountWorker(main, { host: host({ allowEditorSaves: true }) })
  await settle()
  const decision = await on.hooks.fire('editor.save.before', { workspaceId: EVENT_WS, path: join(root, 'login.ts'), text: 'secret text' })
  // The save goes on unchanged.
  assert.equal(decision.kind === 'continue' && decision.event.text, 'secret text')
  const deep = await on.request('context.preview', { prompt: 'x', level: 'deep' })
  const saved = deep.context.find((item) => item.id === 'saved')
  assert.ok(saved, deep.context.map((item) => item.id).join(','))
  assert.ok(deep.context.some((item) => item.id === 'file:login.ts'))
  await on.deactivate()
})

test('starting a new agent needs the switch and its confirmation, and a valid agent kind', async () => {
  const offHost = host({ allowAgentLaunch: true })
  const off = await mountWorker(main, { host: offHost })
  await assert.rejects(off.request('agent.launch', { agent: 'claude', prompt: 'do it' }), /not confirmed/)
  assert.equal(offHost.callsOf('agent.launch').length, 0)
  await off.deactivate()

  const onHost = host({ allowAgentLaunch: true }, { allowAgentLaunch: true })
  const on = await mountWorker(main, { host: onHost })
  await assert.rejects(on.request('agent.launch', { agent: 'rm -rf /', prompt: 'do it' }), /Invalid request/)
  const answer = await on.request('agent.launch', { agent: 'codex', prompt: 'fix\u001b[2J it' })
  assert.equal(answer.terminalId, 'new-1')
  assert.deepEqual(onHost.callsOf('agent.launch')[0], { workspaceId: WS, agent: 'codex', prompt: 'fix[2J it' })
  await on.deactivate()
})

test('opening a file: relative paths inside the workspace only, and only while allowed', async () => {
  const onHost = host({})
  const on = await mountWorker(main, { host: onHost })
  await on.request('editor.open', { path: 'src/login.ts' })
  assert.deepEqual(onHost.callsOf('editor.open')[0], { workspaceId: WS, path: 'src/login.ts' })
  for (const path of ['../secret.txt', '/etc/passwd', 'C:/Windows/x', '.env']) {
    await assert.rejects(on.request('editor.open', { path }), /Invalid request/)
  }
  await on.deactivate()
  const off = await mountWorker(main, { host: host({ allowOpenFiles: false }) })
  await assert.rejects(off.request('editor.open', { path: 'src/login.ts' }), /off in Settings/)
  await off.deactivate()
})

test('confirmations: only for switches that need one; Delete everything forgets them', async () => {
  const testHost = host({})
  const worker = await mountWorker(main, { host: testHost })
  await assert.rejects(worker.request('consent.set', { key: 'saveHistory', granted: true }), /Invalid request/)
  assert.deepEqual((await worker.request('consent.set', { key: 'allowAgentLaunch', granted: true })).granted, ['allowAgentLaunch'])
  assert.deepEqual((await worker.request('consents.get')).granted, ['allowAgentLaunch'])
  await worker.request('data.clear', { what: 'all' })
  assert.deepEqual((await worker.request('consents.get')).granted, [])
  await worker.deactivate()
})

test('a quick run sends no notification, even with notifications on', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })) as typeof fetch
  const testHost = host({ notifyWhenDone: true })
  const worker = await mountWorker(main, { host: testHost })
  await worker.request('prompt.enhance', { prompt: 'do it', level: 'off' })
  assert.equal(testHost.callsOf('notifications.show').length, 0)
  await worker.deactivate()
})

test('an agent that is waiting for an answer is not typed into unasked, and never gets Enter', async () => {
  const blockedHost = mockHost({
    settings: { sendPressEnter: true },
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'demo', terminals: [{ id: 't1', title: 'Claude' }, { id: 't2', title: 'Codex' }] },
      'agents.list': {
        agents: [
          { terminalId: 't1', title: 'Claude', agent: 'claude', state: 'blocked', stateStartedAt: 0 },
          { terminalId: 't2', title: 'Codex', agent: 'codex', state: 'working', stateStartedAt: 0 }
        ]
      },
      'terminal.sendText': { accepted: true }
    }
  })
  const worker = await mountWorker(main, { host: blockedHost })
  // The picker gets an agent's title and state apart, to word them in the panel's language.
  const listed = await worker.request('targets.list', {})
  assert.deepEqual(listed.targets[0], { terminalId: 't1', label: 'Claude · blocked', agent: 'claude', title: 'Claude', state: 'blocked' })
  // Claude is asking the person something: what is typed now could be taken as the answer.
  await assert.rejects(worker.request('prompt.send', { terminalId: 't1', text: 'do the next task' }), /Claude is waiting for an answer from you/)
  assert.equal(blockedHost.callsOf('terminal.sendText').length, 0)
  // The person was told and sends anyway: the text is typed, Enter is not pressed for them.
  assert.deepEqual(await worker.request('prompt.send', { terminalId: 't1', text: 'do the next task', force: true }), { accepted: true })
  const typed = blockedHost.callsOf('terminal.sendText') as { text: string }[]
  assert.ok(typed.length > 0 && typed.every((call) => call.text !== '\r'), 'Enter was pressed for an agent that is waiting for an answer')
  // The person answers the agent in its terminal, then presses "Type it without Enter": the
  // agent is no longer blocked by then, and still no Enter is pressed for them.
  blockedHost.respond('agents.list', { agents: [{ terminalId: 't1', title: 'Claude', agent: 'claude', state: 'waiting', stateStartedAt: 0 }] })
  const sofar = blockedHost.callsOf('terminal.sendText').length
  await worker.request('prompt.send', { terminalId: 't1', text: 'do the next task', enter: true, force: true })
  const later = (blockedHost.callsOf('terminal.sendText') as { text: string }[]).slice(sofar)
  assert.ok(later.length > 0 && later.every((call) => call.text !== '\r'), 'a forced send pressed Enter')
  blockedHost.respond('agents.list', {
    agents: [
      { terminalId: 't1', title: 'Claude', agent: 'claude', state: 'blocked', stateStartedAt: 0 },
      { terminalId: 't2', title: 'Codex', agent: 'codex', state: 'working', stateStartedAt: 0 }
    ]
  })
  // An agent that is working takes the prompt as before, Enter included.
  const before = typed.length
  await worker.request('prompt.send', { terminalId: 't2', text: 'do the next task' })
  const after = (blockedHost.callsOf('terminal.sendText') as { terminalId: string; text: string }[]).slice(before)
  assert.equal(after.at(-1)?.text, '\r')
  await worker.deactivate()
})

test('a prompt the panel started an agent with goes through auto-enhance as it is, and its terminal is known at once', async () => {
  const launchHost = mockHost({
    settings: { allowAgentLaunch: true, autoEnhanceMode: 'rules', autoEnhanceAppend: 'Run the tests before you finish.' },
    storage: { models: { profiles: [profile] }, consents: { allowAgentLaunch: true } },
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'demo', terminals: [] },
      'workspace.list': { workspaces: [{ id: WS, kind: 'worktree', name: 'demo', project: 'demo', path: LISTED.path, branch: 'main', hostId: 'local' }], truncated: false },
      'agents.list': { agents: [] },
      'agent.launch': { terminalId: 'new-1' },
      'statusBar.update': { ok: true }
    }
  })
  const worker = await mountWorker(main, { host: launchHost })
  await worker.request('agent.launch', { agent: 'claude', prompt: 'Fix the login page layout on phones.' })
  // Orca runs the hook on a launch's prompt too: this one is enhanced already, so nothing is added.
  const own = { agent: 'claude', terminalId: 'new-1', prompt: 'Fix the login page layout on phones.', inputKind: 'launch' as const }
  assert.deepEqual(await worker.hooks.fire('agent.prompt.before', own), { kind: 'continue', event: own })
  // Any other prompt gets the person's text, and the Settings section can say what happened.
  const other = await worker.hooks.fire('agent.prompt.before', { agent: 'claude', terminalId: 'new-1', prompt: 'Now add a logout button to the header.', inputKind: 'driving' as const })
  assert.equal(other.kind === 'continue' && other.event.prompt, 'Now add a logout button to the header.\n\nRun the tests before you finish.')
  const last = await worker.request('hook.last')
  assert.deepEqual([last?.outcome, last?.agent], ['appended', 'claude'])
  // The new terminal's workspace is known without waiting for Orca's first event about it.
  await terminalsSaved()
  assert.deepEqual(launchHost.data().storage.terminalWorkspaces, { 'new-1': WS })
  await worker.deactivate()
})

test('auto-enhance (AI) that leaves a prompt as it was says why, to the panel and in "hook.last"', async () => {
  // Only a subscription CLI is set: it starts too slowly for the hook's 2 seconds.
  const cliOnly = mockHost({
    settings: { autoEnhanceMode: 'ai' },
    storage: { models: { profiles: [{ ...profile, id: 'cc', name: 'Claude Code', preset: 'claude-code', provider: 'cli', baseUrl: '', model: 'sonnet', command: 'claude' }] } },
    results: { 'workspace.readContext': null, 'statusBar.update': { ok: true } }
  })
  const worker = await mountWorker(main, { host: cliOnly })
  const event = { agent: 'codex', terminalId: 't9', prompt: 'add a health check endpoint to the api', inputKind: 'orchestration' as const }
  assert.deepEqual(await worker.hooks.fire('agent.prompt.before', event), { kind: 'continue', event })
  const last = await worker.request('hook.last')
  assert.deepEqual([last?.outcome, last?.agent, last?.reason?.code], ['skipped', 'codex', 'hook.no_model'])
  assert.deepEqual(
    worker.posts.filter((post) => post.event === 'hook.skipped').map((post) => post.payload),
    [{ agent: 'codex', reason: { code: 'hook.no_model' } }]
  )
  // Delete everything forgets it.
  await worker.request('data.clear', { what: 'all' })
  assert.equal(await worker.request('hook.last'), null)
  await worker.deactivate()
})

test('a removed history entry comes back with Undo: by its id, to its place, only while history is kept', async () => {
  const stored: Record<string, string | number>[] = [
    { id: 'h3', at: 3000, original: 'three', enhanced: 'Three.', style: 'balanced', model: 'm', source: 'panel', project: 'demo' },
    { id: 'h2', at: 2000, original: 'two', enhanced: 'Two.', style: 'balanced', model: 'm', source: 'panel' },
    { id: 'h1', at: 1000, original: 'one', enhanced: 'One.', style: 'balanced', model: 'm', source: 'hook' }
  ]
  const historyHost = mockHost({ storage: { history: stored }, results: { 'statusBar.update': { ok: true } } })
  const worker = await mountWorker(main, { host: historyHost })
  const ids = () => (historyHost.data().storage.history as { id: string }[]).map((item) => item.id)
  await worker.request('history.remove', { id: 'h2' })
  assert.deepEqual(ids(), ['h3', 'h1'])
  // Back between its neighbours, with everything it held.
  assert.deepEqual(await worker.request('history.restore', { id: 'h2' }), { restored: true })
  assert.deepEqual(ids(), ['h3', 'h2', 'h1'])
  assert.deepEqual((historyHost.data().storage.history as { id: string; project?: string }[])[0].project, 'demo')
  // Once only, and nothing the worker did not remove itself: the panel cannot write an entry in.
  assert.deepEqual(await worker.request('history.restore', { id: 'h2' }), { restored: false })
  assert.deepEqual(await worker.request('history.restore', { id: 'made-up' }), { restored: false })
  assert.deepEqual(ids(), ['h3', 'h2', 'h1'])
  // Clearing the history forgets what was removed before it.
  await worker.request('history.remove', { id: 'h1' })
  await worker.request('history.clear')
  assert.deepEqual(await worker.request('history.restore', { id: 'h1' }), { restored: false })
  await worker.deactivate()

  // With Save history off, nothing is written back.
  const offHost = mockHost({ settings: { saveHistory: false }, storage: { history: stored }, results: { 'statusBar.update': { ok: true } } })
  const off = await mountWorker(main, { host: offHost })
  await off.request('history.remove', { id: 'h3' })
  assert.deepEqual(await off.request('history.restore', { id: 'h3' }), { restored: false })
  assert.equal((offHost.data().storage.history as unknown[]).length, 2)
  await off.deactivate()
})

test('a run is kept in the history under its project, so the History tab can show one project', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Better.' } }] }), { status: 200 })) as typeof fetch
  const testHost = host({})
  const worker = await mountWorker(main, { host: testHost })
  await worker.request('prompt.enhance', { prompt: 'fix the login page', level: 'off' })
  const kept = testHost.data().storage.history as { original: string; project?: string }[]
  assert.deepEqual([kept[0].original, kept[0].project], ['fix the login page', 'demo'])
  await worker.deactivate()
})

test('an API key that cannot be stored is said so in words, and no model is saved without it', async () => {
  const noStore = mockHost({
    results: {
      'secrets.protection': { status: 'unavailable' },
      'secrets.set': () => {
        throw new Error('secret store unavailable')
      },
      'statusBar.update': { ok: true }
    }
  })
  const worker = await mountWorker(main, { host: noStore })
  // The Models tab can warn before a key is typed.
  assert.equal((await worker.request('models.get')).keysUnavailable, true)
  await assert.rejects(
    worker.request('models.save', { name: 'OpenAI', preset: 'openai', provider: 'openai', baseUrl: '', model: 'gpt-4.1-mini', maxTokens: 2000, enabled: true, apiKey: 'sk-test-1234567890' }),
    /Orca could not store the API key/
  )
  assert.deepEqual((await worker.request('models.get')).profiles, [])
  // Without a key (an environment variable, a local model) the same model is saved as before.
  const saved = await worker.request('models.save', { name: 'Ollama', preset: 'ollama', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3', maxTokens: 2000, enabled: true })
  assert.equal(saved.profiles.length, 1)
  await worker.deactivate()

  // A machine with a key store says nothing.
  const usual = await mountWorker(main, { host: mockHost({ results: { 'secrets.protection': { status: 'os-keyring' }, 'statusBar.update': { ok: true } } }) })
  assert.equal((await usual.request('models.get')).keysUnavailable, undefined)
  await usual.deactivate()
})

test('masking leaves a count of tokens alone and still hides a token', () => {
  assert.equal(redactSecrets('max_tokens: 200000, input_tokens=1234567'), 'max_tokens: 200000, input_tokens=1234567')
  // In JSON the value takes the closing brace with it: the count and the brace both stay.
  assert.equal(redactSecrets('{"model": "x", "max_tokens": 200000}'), '{"model": "x", "max_tokens": 200000}')
  assert.equal(redactSecrets('{"api_token": "abcdef123456"}'), '{"api_token": "[redacted]"}')
  assert.equal(redactSecrets('API_TOKEN=abcdef123456 and token: 99887766'), 'API_TOKEN=[redacted] and token: [redacted]')
})

test('an entry that no longer fits the history is not said to be back', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Better.' } }] }), { status: 200 })) as typeof fetch
  const fullHost = mockHost({
    settings: { historyLimit: 2 },
    storage: {
      models: { profiles: [profile] },
      history: [
        { id: 'h2', at: 2000, original: 'two', enhanced: 'Two.', style: 'balanced', model: 'm', source: 'panel' },
        { id: 'h1', at: 1000, original: 'one', enhanced: 'One.', style: 'balanced', model: 'm', source: 'panel' }
      ]
    },
    secrets: { 'apiKey.oa': 'k' },
    results: { 'workspace.readContext': null, 'statusBar.update': { ok: true } }
  })
  const worker = await mountWorker(main, { host: fullHost })
  await worker.request('history.remove', { id: 'h1' })
  // A new prompt takes the free place: the history is full again, with two newer entries.
  await worker.request('prompt.enhance', { prompt: 'three', level: 'off' })
  assert.deepEqual(await worker.request('history.restore', { id: 'h1' }), { restored: false })
  assert.deepEqual((fullHost.data().storage.history as { original: string }[]).map((item) => item.original), ['three', 'two'])
  await worker.deactivate()
})
