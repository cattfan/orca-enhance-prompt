// Real progress: the worker reports each step it actually reaches; the panel shows it, then ends the
// run as done, failed or cancelled.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { after } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, mockHost, mount, mountWorker, test } from 'orca/testing'
import * as panel from './panel.tsx'
import { PRESETS, type ProfileView } from './presets.ts'
import { createProgress, percent, planSteps, type ProgressSnapshot } from './progress.ts'
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
      rmSync(folder, { recursive: true, force: true })
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

test('planSteps follows the level and Privacy', () => {
  assert.deepEqual(planSteps('off', true), ['model'])
  assert.deepEqual(planSteps('basic', true), ['workspace', 'model'])
  assert.deepEqual(planSteps('standard', true), ['workspace', 'project', 'model'])
  assert.deepEqual(planSteps('deep', true), ['workspace', 'project', 'git', 'search', 'model'])
  assert.deepEqual(planSteps('max', true), ['workspace', 'project', 'git', 'search', 'pick', 'terminal', 'model'])
  assert.deepEqual(planSteps('deep', false), ['workspace', 'model'])
})

test('createProgress sends a full snapshot on every change; percent counts finished steps', () => {
  const sent: ProgressSnapshot[] = []
  const step = createProgress('r1', ['workspace', 'model'], (snapshot) => sent.push(snapshot))
  step('workspace', 'running')
  step('workspace', 'done', 'demo')
  step('model', 'running', 'OpenAI · gpt')
  assert.equal(sent.length, 4)
  assert.deepEqual(sent.at(-1)!.steps, [
    { key: 'workspace', status: 'done', detail: 'demo' },
    { key: 'model', status: 'running', detail: 'OpenAI · gpt' }
  ])
  assert.equal(percent(sent.at(-1)!.steps), 50)
  assert.equal(percent([]), 0)
})

test('the worker reports the real steps of a Deep run, in order, to the asking panel only', async () => {
  const root = tempDir('progress-')
  writeFileSync(join(root, 'AGENTS.md'), 'Use pnpm.')
  writeFileSync(join(root, 'login.ts'), 'export const login = 1\n')
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })) as typeof fetch
  const host = mockHost({
    storage: { models: { profiles: [{ id: 'oa', name: 'OpenAI', preset: 'openai', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', temperature: 0.3, maxTokens: 2000, enabled: true, command: '', args: '' }] } },
    secrets: { 'apiKey.oa': 'k' },
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'demo', terminals: [] },
      'workspace.list': { workspaces: [{ id: 'w', kind: 'folder', name: 'demo', path: root, branch: 'main', hostId: null }], truncated: false },
      'agents.list': { agents: [] }
    }
  })
  const worker = await mountWorker(main, { host })
  await worker.request('prompt.enhance', { prompt: 'fix login', level: 'deep', runId: 'run-1' }, { panel: 'enhance' })
  const snapshots = worker.posts.filter((post) => post.event === 'enhance.progress').map((post) => post.payload as ProgressSnapshot)
  assert.ok(snapshots.length >= 8, `got ${snapshots.length}`)
  assert.ok(snapshots.every((snapshot) => snapshot.runId === 'run-1'))
  // First snapshot: the plan, all pending. Last: everything finished, the model done.
  assert.deepEqual(snapshots[0].steps.map((step) => step.status), ['pending', 'pending', 'pending', 'pending', 'pending'])
  const last = snapshots.at(-1)!.steps
  assert.deepEqual(last.map((step) => step.key), ['workspace', 'project', 'git', 'search', 'model'])
  assert.deepEqual(last.map((step) => step.status), ['done', 'done', 'skipped', 'done', 'done'])
  assert.match(last[4].detail ?? '', /OpenAI · gpt-4.1-mini/)
  // Without a runId (other callers), nothing is posted.
  const before = worker.posts.length
  await worker.request('prompt.enhance', { prompt: 'fix login', level: 'off' })
  assert.equal(worker.posts.length, before)
  await worker.deactivate()
})

test('a failing model marks the model step failed', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })) as typeof fetch
  const host = mockHost({
    storage: { models: { profiles: [{ id: 'oa', name: 'OpenAI', preset: 'openai', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt', temperature: 0.3, maxTokens: 2000, enabled: true, command: '', args: '' }] } },
    secrets: { 'apiKey.oa': 'k' },
    results: { 'workspace.readContext': null }
  })
  const worker = await mountWorker(main, { host })
  await assert.rejects(worker.request('prompt.enhance', { prompt: 'x', level: 'off', runId: 'r' }))
  const last = (worker.posts.filter((post) => post.event === 'enhance.progress').at(-1)!.payload as ProgressSnapshot).steps
  assert.equal(last.at(-1)!.status, 'failed')
  assert.match(last.at(-1)!.detail ?? '', /401/)
  await worker.deactivate()
})

const gpt: ProfileView = { id: 'gpt', name: 'OpenAI', preset: 'openai', provider: 'openai', baseUrl: '', model: 'gpt-4.1-mini', temperature: 0.3, maxTokens: 2000, enabled: true, command: '', args: '', keySource: 'secret', envName: '', effectiveBaseUrl: 'https://api.openai.com/v1', effectiveModel: 'gpt-4.1-mini' }
const models = { profiles: [gpt], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS }

test('the panel shows live steps, ignores old runs, and ends with the result or Try again', async () => {
  let fail = false
  const host = mockHost({
    requests: {
      'models.get': models,
      'targets.list': { targets: [] },
      'models.detect': { found: [] },
      'prompt.enhance': (input) => {
        if (fail) throw Object.assign(new Error('All models failed.'), { code: 'action_failed' })
        return { enhanced: `Better: ${input.prompt}`, model: 'gpt-4.1-mini', profileName: 'OpenAI', ms: 1500, attempts: [], context: [], notes: [] }
      }
    }
  })
  const view = await mount(panel, { host })

  // While a run is going: the worker's snapshots drive the card.
  panel.beginRun('r1')
  panel.applyProgress({
    runId: 'r1',
    startedAt: Date.now(),
    steps: [
      { key: 'workspace', status: 'done', detail: 'demo' },
      { key: 'model', status: 'running', detail: 'OpenAI · gpt-4.1-mini' }
    ]
  })
  await view.settled()
  assert.ok(view.find({ text: /Writing the prompt · OpenAI · gpt-4.1-mini/ }))
  assert.equal(view.find({ type: 'Progress' })!.props.value, 50)
  panel.applyProgress({ runId: 'old', startedAt: 0, steps: [{ key: 'git', status: 'running' }] })
  await view.settled()
  assert.equal(view.find({ text: /Reading git changes/ }), null)

  // A real run replaces it and ends with the result.
  await view.type({ label: 'Your prompt' }, 'fix it')
  await view.press({ role: 'button', text: 'Enhance' })
  assert.equal(view.find({ type: 'Progress' }), null)
  assert.ok(view.find({ type: 'Badge', text: 'Done · 1.5 s' }))
  const sent = host.callsOf('plugin.request').at(-1) as { input: { runId: string } }
  assert.ok(sent.input.runId)

  // A failure keeps the card, with the error and Try again.
  fail = true
  await view.press({ role: 'button', text: 'Enhance' })
  assert.ok(view.find({ text: 'Enhance failed' }))
  assert.ok(view.find({ text: /All models failed/ }))
  fail = false
  await view.press({ role: 'button', text: 'Try again' })
  assert.equal(view.find({ text: 'Enhance failed' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
