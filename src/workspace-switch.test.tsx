// An enhanced prompt belongs to the project (workspace) it was written in: switching projects while
// it is being written, or after, never puts it in front of another project's agent.
import { read } from 'orca'
import { assert, mockHost, test, type MockRequests, type TestPanel } from 'orca/testing'
import { enhanceNow, pickWorkspace, send } from './panel/actions.ts'
import { draft, lastRun, notice, put, result, run, target, workspaceChoices, workspaceKey } from './panel/state.ts'
import { mountPanel } from './panel/testing.ts'
import { PRESETS, type ProfileView } from './presets.ts'

type Space = { id: string; name: string; agent: string; terminal: string }
const A: Space = { id: 'ws-a', name: 'app-a', agent: 'Claude A', terminal: 'term-a' }
const B: Space = { id: 'ws-b', name: 'app-b', agent: 'Claude B', terminal: 'term-b' }
const C: Space = { id: 'ws-c', name: 'app-c', agent: 'Claude C', terminal: 'term-c' }

const gpt: ProfileView = {
  id: 'gpt', name: 'gpt', preset: 'openai', provider: 'openai', baseUrl: '', model: '', temperature: 0.3, maxTokens: 2000, enabled: true,
  command: '', args: '', effectiveBaseUrl: 'https://api.openai.com/v1', effectiveModel: 'gpt-4.1-mini', keySource: 'secret', envName: ''
}

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await wait(10)
  assert.ok(check(), 'timed out waiting')
}

/** A panel host whose focused project can be switched, and whose Enhance answers when told to. */
function world() {
  let focused = A
  const pending: { prompt: string; resolve: (text: string) => void }[] = []
  const sent: { terminalId: string; text: string }[] = []
  const requests: MockRequests = {
    'models.get': { profiles: [gpt], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
    'models.detect': { found: [] },
    'models.catalog': { models: [], source: '', fetchedAt: 1 },
    'rules.get': { rules: [], structures: [] },
    'targets.list': () => ({
      targets: [{ terminalId: focused.terminal, label: `${focused.agent} · waiting`, agent: 'claude' }],
      workspace: focused.name,
      workspaceId: focused.id
    }),
    'prompt.enhance': (input) =>
      new Promise((resolve) => {
        pending.push({
          prompt: input.prompt,
          resolve: (text) => resolve({ enhanced: text, model: 'm', profileName: 'gpt', ms: 5, attempts: [], context: [], notes: [] })
        })
      }),
    'prompt.send': (input) => {
      sent.push({ terminalId: input.terminalId, text: input.text })
      return { accepted: true }
    }
  }
  return {
    host: mockHost({ requests }),
    pending,
    sent,
    /** Focuses a project as Orca does: the event, then the panel asks for its terminals. Not awaited:
     *  the panel cannot settle while an Enhance is still waiting for its answer. */
    switchTo: (view: TestPanel, space: Space) => {
      focused = space
      return view.emit('workspace.changed', { context: { branch: 'main', displayName: space.name, terminals: [{ id: space.terminal, title: space.agent }] } })
    }
  }
}

/** The enhanced prompt the composer shows (the result card is drawn only when there is one). */
const shownResult = () => read(result) || null
const draftText = () => read(draft)
/** Pressing Send: whatever the composer shows goes to the terminal it shows. Nothing shown, nothing sent. */
const pressSend = () => send(read(result))

/** Runs a test body with every still-waiting answer released at the end, so a failure never hangs. */
async function scenario(body: (view: TestPanel, w: ReturnType<typeof world>) => Promise<void>) {
  const w = world()
  const view = await mountPanel(w.host)
  try {
    await body(view, w)
    assert.deepEqual(view.errors, [])
  } finally {
    for (const answer of w.pending) answer.resolve('')
    await view.unmount()
  }
}

test('switching projects while the prompt is being written: it lands in its own project, never in the other one', () =>
  scenario(async (view, w) => {
    put(draft, 'fix login in app A')
    const enhancing = enhanceNow()
    await until(() => w.pending.length === 1)

    // The person moves to project B before the answer comes back: the run still says whose it is
    // (the card in B reads "Writing the prompt for app-a…").
    const switching = w.switchTo(view, B)
    await wait()
    assert.equal(read(workspaceKey), B.id)
    assert.deepEqual(read(run)?.workspace, { key: A.id, name: A.name })
    assert.equal(read(run)?.status, 'running')
    w.pending[0].resolve('Enhanced for A')
    await Promise.all([enhancing, switching])
    await view.settled()

    // B shows neither A's prompt nor A's result, so Send cannot paste it into B's agent.
    assert.equal(shownResult(), null, 'project B shows the prompt written for A')
    assert.notEqual(draftText(), 'fix login in app A')
    assert.match(read(notice)?.text ?? '', /kept for app-a/)
    assert.equal(read(target), B.terminal)
    await pressSend()
    assert.deepEqual(w.sent, [])

    // Back in A, the result is there and goes to A's agent.
    await w.switchTo(view, A)
    await view.settled()
    assert.equal(shownResult(), 'Enhanced for A')
    assert.equal(draftText(), 'fix login in app A')
    await pressSend()
    assert.deepEqual(w.sent, [{ terminalId: A.terminal, text: 'Enhanced for A' }])
  }))

test('a finished prompt stays in its project: a project opened for the first time starts empty', () =>
  scenario(async (view, w) => {
    put(draft, 'task for A')
    const enhancing = enhanceNow()
    await until(() => w.pending.length === 1)
    w.pending[0].resolve('Enhanced for A')
    await enhancing
    assert.equal(shownResult(), 'Enhanced for A')
    assert.ok(read(lastRun))

    // B has never been opened: nothing of A's shows there, so nothing of A's can be sent from there.
    await w.switchTo(view, B)
    await view.settled()
    assert.equal(read(workspaceKey), B.id)
    assert.equal(shownResult(), null)
    assert.equal(draftText(), '')
    assert.equal(read(lastRun), null)
    await pressSend()
    assert.deepEqual(w.sent, [])

    // A still has all of it.
    await w.switchTo(view, A)
    await view.settled()
    assert.equal(shownResult(), 'Enhanced for A')
    assert.equal(draftText(), 'task for A')
    assert.ok(read(lastRun))
  }))

test('back and forth over several projects: each keeps its own draft and result', () =>
  scenario(async (view, w) => {
    put(draft, 'task for A')
    const enhancing = enhanceNow()
    await until(() => w.pending.length === 1)
    const toB = w.switchTo(view, B)
    await wait()
    const toC = w.switchTo(view, C)
    await wait()
    w.pending[0].resolve('Enhanced for A')
    await Promise.all([enhancing, toB, toC])
    await view.settled()
    assert.equal(shownResult(), null)
    put(draft, 'task for C')

    // B runs its own Enhance while A's result waits for A.
    await w.switchTo(view, B)
    await view.settled()
    assert.equal(shownResult(), null)
    assert.equal(draftText(), '')
    put(draft, 'task for B')
    const enhancingB = enhanceNow()
    await until(() => w.pending.length === 2)
    assert.equal(w.pending[1].prompt, 'task for B')
    w.pending[1].resolve('Enhanced for B')
    await enhancingB
    await view.settled()
    assert.equal(shownResult(), 'Enhanced for B')
    await pressSend()

    await w.switchTo(view, C)
    await view.settled()
    assert.equal(shownResult(), null)
    assert.equal(draftText(), 'task for C')
    await w.switchTo(view, A)
    await view.settled()
    assert.equal(shownResult(), 'Enhanced for A')
    await pressSend()
    assert.deepEqual(w.sent, [
      { terminalId: B.terminal, text: 'Enhanced for B' },
      { terminalId: A.terminal, text: 'Enhanced for A' }
    ])
  }))

test('a project removed before its answer comes back: the answer goes nowhere else', () =>
  scenario(async (view, w) => {
    put(draft, 'task for A')
    const enhancing = enhanceNow()
    await until(() => w.pending.length === 1)
    const toB = w.switchTo(view, B)
    await wait()
    const removed = view.emit('workspace.removed', { workspaceId: A.id, kind: 'worktree', path: '/repo/a' })
    await wait()
    w.pending[0].resolve('Enhanced for A')
    await Promise.all([enhancing, toB, removed])
    await view.settled()
    assert.equal(shownResult(), null)
    assert.match(read(notice)?.text ?? '', /is closed, so its enhanced prompt was dropped/)
    await w.switchTo(view, C)
    await view.settled()
    assert.equal(shownResult(), null)
    await pressSend()
    assert.deepEqual(w.sent, [])
  }))

test('the panel learns a terminal\'s workspace from Orca\'s agent events, and asks for the folder when it cannot tell', async () => {
  const known: Record<string, string>[] = []
  let choices: { id: string; path: string }[] | undefined = [
    { id: 'ws-1', path: 'C:/work/app-one' },
    { id: 'ws-2', path: 'C:/work/app-two' }
  ]
  const host = mockHost({
    requests: {
      'models.get': { profiles: [], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
      'models.detect': { found: [] },
      'rules.get': { rules: [], structures: [] },
      'targets.list': (input) => {
        known.push({ ...(input?.known ?? {}) })
        const resolved = input?.known?.['term-x']
        return { targets: [{ terminalId: 'term-x', label: 'Claude · waiting', agent: 'claude' }], workspace: 'main', workspaceId: resolved ?? null, ...(resolved ? {} : { choices }) }
      }
    }
  })
  const view = await mountPanel(host)
  // Several projects are named "main" on the same branch: the panel offers their folders to pick from.
  assert.deepEqual(read(workspaceChoices), choices)
  await pickWorkspace('ws-2')
  await view.settled()
  assert.equal(known.at(-1)?.['term-x'], 'ws-2')
  assert.deepEqual(read(workspaceChoices), [])
  assert.equal(read(workspaceKey), 'ws-2')
  // An agent event from Orca names the workspace of another terminal: remembered for next time.
  choices = undefined
  await view.emit('agent.status.changed', { workspaceId: 'ws-9', paneKey: 'p', terminalId: 'term-y', state: 'working', receivedAt: Date.now() })
  await view.settled()
  assert.equal(known.at(-1)?.['term-y'], 'ws-9')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
