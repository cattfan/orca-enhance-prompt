// The panel's wiring (src/panel/setup.ts): what the worker posts, what Orca reports and a setting
// changed elsewhere all reach the panel's state, and closing the panel ends its run.
import { read, settings } from 'orca'
import { assert, mockHost, test, type MockRequests } from 'orca/testing'
import { PRESETS } from '../presets.ts'
import { beginRun, cancel, enhanceNow } from './actions.ts'
import { consents, defaults, draft, notice, privacy, put, result, rulesState, run, targets } from './state.ts'
import { mountPanel } from './testing.ts'

const base: MockRequests = {
  'models.get': { profiles: [], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
  'models.detect': { found: [] },
  'targets.list': { targets: [{ terminalId: 't1', label: 'Claude · waiting', agent: 'claude' }], workspace: 'demo', workspaceId: 'ws-1' },
  'rules.get': { rules: [{ id: 'r1', text: 'Run the tests.', enabled: true, scope: '' }], structures: [] },
  'consents.get': { granted: ['allowAgentLaunch'], needed: ['allowOtherAgents', 'allowAgentActivity', 'allowAgentLaunch'] }
}

test('starting the panel loads its terminals, rules and confirmations, and the settings as they are', async () => {
  const view = await mountPanel(mockHost({ requests: base, settings: { defaultStyle: 'concise', allowGit: false } }))
  assert.deepEqual(read(targets).map((item) => item.terminalId), ['t1'])
  assert.deepEqual(read(rulesState).rules.map((rule) => rule.id), ['r1'])
  assert.deepEqual(read(consents), ['allowAgentLaunch'])
  assert.equal(read(defaults).style, 'concise')
  assert.equal(read(privacy).allowGit, false)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test("the worker's progress and the auto-enhance hook's news reach the panel", async () => {
  const view = await mountPanel(mockHost({ requests: base }))
  beginRun('r1')
  await view.post('enhance.progress', { runId: 'r1', startedAt: Date.now(), steps: [{ key: 'workspace', status: 'done' }, { key: 'model', status: 'running' }] })
  assert.deepEqual(read(run)?.steps.map((step) => `${step.key}:${step.status}`), ['workspace:done', 'model:running'])
  await view.post('hook.enhanced', { agent: 'claude', mode: 'ai', model: 'gpt-4.1-mini' })
  assert.deepEqual(read(notice), { tone: 'neutral', text: 'Auto-enhanced (ai, gpt-4.1-mini) a prompt for claude.' })
  await view.post('hook.enhanced', { agent: null, mode: 'rules' })
  assert.deepEqual(read(notice), { tone: 'neutral', text: 'Auto-enhanced (rules) a prompt for an agent.' })
  await view.unmount()
})

test("a setting changed outside the panel (Orca's Settings) is followed at once", async () => {
  const view = await mountPanel(mockHost({ requests: base }))
  assert.equal(read(defaults).style, 'balanced')
  assert.equal(read(privacy).allowTerminalSend, true)
  await settings.set('defaultStyle', 'bugfix')
  await settings.set('allowTerminalSend', false)
  await view.settled()
  assert.equal(read(defaults).style, 'bugfix')
  assert.equal(read(privacy).allowTerminalSend, false)
  await view.unmount()
})

/** A panel whose Enhance stays unanswered until the test ends it, the way Orca ends a cancelled request: by rejecting it. */
async function withPendingRun() {
  let refuse: (reason: Error) => void = () => undefined
  const requests: MockRequests = { ...base, 'prompt.enhance': () => new Promise((_resolve, reject) => (refuse = reject)) }
  const view = await mountPanel(mockHost({ requests }))
  put(draft, 'a long task')
  const running = enhanceNow()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(read(run)?.status, 'running')
  return { view, running, refuse: () => refuse(Object.assign(new Error('The request was aborted.'), { code: 'aborted' })) }
}

test('Cancel ends the run as cancelled, not as a failure, and shows no result', async () => {
  const { view, running, refuse } = await withPendingRun()
  cancel()
  refuse()
  await running
  assert.equal(read(run)?.status, 'cancelled')
  assert.equal(read(run)?.error, undefined)
  assert.equal(read(result), '')
  await view.unmount()
})

test('closing the panel cancels its run in flight, so the worker stops the model too', async () => {
  const { view, running, refuse } = await withPendingRun()
  await view.unmount()
  refuse()
  await running
  // Cancelled by the panel itself: an unanswered request that merely failed would end as 'error'.
  assert.equal(read(run)?.status, 'cancelled')
})

test('a request that fails without a cancel ends the run as failed, with its message', async () => {
  const { view, running, refuse } = await withPendingRun()
  refuse()
  await running
  assert.equal(read(run)?.status, 'error')
  assert.equal(read(run)?.error, 'The request was aborted.')
  await view.unmount()
})
