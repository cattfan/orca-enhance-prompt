// Orca integrations, each behind its own Privacy switch (and a confirmation for the risky ones):
// what agents do, files saved in the editor, starting a new agent, opening a file, notifications.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { after } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { forgetActivity, recordTool, toolTarget, agentActivity } from './context/activity.ts'
import { relativeTo } from './context/index.ts'
import * as main from './worker.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  forgetActivity()
})
const root = mkdtempSync(join(tmpdir(), 'integrations-'))
writeFileSync(join(root, 'login.ts'), 'export function login() {}\n')
after(() => rmSync(root, { recursive: true, force: true }))

const WS = 'identity:wt2:local:test'
const profile = { id: 'oa', name: 'OpenAI', preset: 'openai', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', maxTokens: 2000, enabled: true, command: '', args: '' }

function host(settings: Record<string, boolean | string>, consents: Record<string, boolean> = {}) {
  return mockHost({
    settings,
    storage: { models: { profiles: [profile] }, consents },
    secrets: { 'apiKey.oa': 'k' },
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'demo', terminals: [] },
      'workspace.list': { workspaces: [{ id: WS, kind: 'folder', name: 'demo', path: root, branch: 'main', hostId: 'local' }], truncated: false },
      'agents.list': { agents: [] },
      'agent.launch': { terminalId: 'new-1' },
      'editor.open': { opened: true },
      'notifications.show': { delivered: true }
    }
  })
}
/** Lets the worker read its switches after mounting (they are refreshed in the background). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
const tool = { agent: 'claude', workspaceId: WS, terminalId: 't1', tool: 'Bash', input: { command: 'pnpm test --filter auth API_KEY=abcdef123456' }, output: 'SECRET OUTPUT' }

test('tool targets: a path or a command, masked; never the output', () => {
  assert.equal(toolTarget({ file_path: 'src/login.ts', content: 'x' }), 'src/login.ts')
  assert.equal(toolTarget({ command: 'export TOKEN=abcdef123456 && pnpm build' }), 'export TOKEN=[redacted] && pnpm build')
  recordTool({ agent: 'codex', workspaceId: WS, tool: 'Edit', input: { path: 'a.ts' } }, 1000)
  assert.match(agentActivity(WS, 1000), /codex · Edit: a\.ts/)
  assert.equal(agentActivity('other', 1000), '')
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
  await worker.emit('agent.status.changed', { workspaceId: WS, paneKey: 'p', terminalId: 't1', title: 'Auth', state: 'done', receivedAt: Date.now(), mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: Date.now() } })
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
  const passed = await off.hooks.fire('editor.save.before', { workspaceId: WS, path: join(root, 'login.ts'), text: 'secret text' })
  assert.equal(passed.kind, 'continue')
  assert.ok(!(await off.request('context.preview', { prompt: 'x', level: 'deep' })).context.some((item) => item.id === 'saved'))
  await off.deactivate()

  const on = await mountWorker(main, { host: host({ allowEditorSaves: true }) })
  await settle()
  const decision = await on.hooks.fire('editor.save.before', { workspaceId: WS, path: join(root, 'login.ts'), text: 'secret text' })
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
  await assert.rejects(off.request('editor.open', { path: 'src/login.ts' }), /off in Privacy/)
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
