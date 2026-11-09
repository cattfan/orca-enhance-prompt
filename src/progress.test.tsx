// Real progress: the worker reports each step it actually reaches; the panel shows it, then ends the
// run as done, failed or cancelled.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { after } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, mockHost, mount, mountWorker, test } from 'orca/testing'
import * as panel from './panel.tsx'
import { PRESETS, type ProfileView } from './presets.ts'
import { createProgress, planSteps, stepPercent, STEP_WEIGHTS, totalPercent, type ProgressSnapshot, type Step } from './progress.ts'
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

test('planSteps follows the level and Privacy', () => {
  assert.deepEqual(planSteps('off', true), ['model'])
  assert.deepEqual(planSteps('basic', true), ['workspace', 'model'])
  assert.deepEqual(planSteps('standard', true), ['workspace', 'project', 'model'])
  assert.deepEqual(planSteps('deep', true), ['workspace', 'project', 'git', 'search', 'model'])
  assert.deepEqual(planSteps('max', true), ['workspace', 'project', 'git', 'search', 'pick', 'terminal', 'model'])
  assert.deepEqual(planSteps('deep', false), ['workspace', 'model'])
})

test('createProgress sends a full snapshot on every change, with when each step started and how far it got', () => {
  const sent: ProgressSnapshot[] = []
  let now = 1000
  const step = createProgress('r1', ['workspace', 'git', 'model'], (snapshot) => sent.push(snapshot), () => now)
  step('workspace', 'running')
  now = 1100
  step('workspace', 'done', 'demo')
  step('git', 'running')
  step('git', 'running', undefined, 2 / 3)
  step('git', 'done', '3')
  now = 2000
  step('model', 'running', 'OpenAI · gpt')
  assert.equal(sent.length, 7)
  assert.deepEqual(sent.at(-1)!.steps, [
    { key: 'workspace', status: 'done', detail: 'demo', startedAt: 1000 },
    { key: 'git', status: 'done', detail: '3', startedAt: 1100 },
    { key: 'model', status: 'running', detail: 'OpenAI · gpt', startedAt: 2000 }
  ])
  assert.equal(sent[4].steps[1].fraction, 2 / 3)
})

test('step and total percentages: 0 to 100, consistent, never over 100, never 100 before the end', () => {
  const at = 10_000
  const steps = (...list: Partial<Step>[]): Step[] => list.map((entry) => ({ key: 'workspace', status: 'pending', ...entry }) as Step)
  // Nothing known yet, or nothing planned.
  assert.equal(totalPercent([]), 0)
  assert.equal(totalPercent(steps({ key: 'workspace' }, { key: 'model' })), 0)
  // Counted fraction of a running step; done is 100; skipped is left out.
  assert.equal(stepPercent({ key: 'git', status: 'running', fraction: 2 / 3 }), 67)
  assert.equal(stepPercent({ key: 'git', status: 'running', fraction: 1 }), 99)
  assert.equal(stepPercent({ key: 'git', status: 'skipped' }), null)
  // The model estimate grows with time, stays at or under 95 while running.
  const model = (ms: number) => stepPercent({ key: 'model', status: 'running', startedAt: at }, at + ms)!
  assert.equal(model(0), 0)
  assert.ok(model(4000) > 30 && model(4000) < model(12_000) && model(12_000) < 95)
  assert.equal(model(10 * 60_000), 95)
  // The total is the weighted mean of the step shares, skipped steps excluded.
  const mixed = steps({ key: 'workspace', status: 'done' }, { key: 'git', status: 'skipped' }, { key: 'search', status: 'running', fraction: 0.5 }, { key: 'model' })
  const expected = (100 * STEP_WEIGHTS.workspace + 50 * STEP_WEIGHTS.search + 0 * STEP_WEIGHTS.model) / (STEP_WEIGHTS.workspace + STEP_WEIGHTS.search + STEP_WEIGHTS.model)
  assert.equal(totalPercent(mixed), Math.round(expected))
  // Never 100 before every step is done, even when rounding would say so; exactly 100 at the end.
  const almost = steps({ key: 'workspace', status: 'done' }, { key: 'model', status: 'running', fraction: 0.999 })
  assert.equal(totalPercent(almost), 99)
  assert.equal(totalPercent(steps({ key: 'workspace', status: 'done' }, { key: 'model', status: 'done' })), 100)
  assert.equal(totalPercent(steps({ key: 'workspace', status: 'skipped' }, { key: 'model', status: 'done' })), 100)
  // A failed step keeps what it reached; the total does not pass it and never goes past 100.
  const failed = steps({ key: 'workspace', status: 'done' }, { key: 'model', status: 'failed', fraction: 0.4 })
  assert.equal(stepPercent(failed[1]), 40)
  assert.ok(totalPercent(failed) < 100)
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
  // Workspace done (weight 0.5), model just started (weight 5): 100 × 0.5 / 5.5 ≈ 9%.
  assert.equal(view.find({ type: 'Progress', label: 'Progress: 9%' })!.props.value, 9)
  assert.ok(view.find({ text: '9%' }))
  assert.ok(view.find({ text: '100%' }))
  panel.applyProgress({ runId: 'old', startedAt: 0, steps: [{ key: 'git', status: 'running' }] })
  await view.settled()
  assert.equal(view.find({ text: /Reading git changes/ }), null)

  // A real run replaces it and ends with the result.
  await view.type({ label: 'Your prompt' }, 'fix it')
  await view.press({ role: 'button', text: 'Enhance' })
  assert.equal(view.find({ type: 'Progress', label: /^Progress/ }), null)
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

test('the run card shows the total and every step in percent, ≈ for an estimate, – for skipped; a cancel freezes the bar', async () => {
  const host = mockHost({
    requests: {
      'models.get': models,
      'targets.list': { targets: [] },
      'models.detect': { found: [] },
      'rules.get': { rules: [], structures: [] }
    }
  })
  const view = await mount(panel, { host })
  panel.beginRun('r2')
  const started = Date.now()
  panel.applyProgress({
    runId: 'r2',
    startedAt: started,
    steps: [
      { key: 'workspace', status: 'done', detail: 'demo' },
      { key: 'project', status: 'done', detail: '42' },
      { key: 'git', status: 'skipped' },
      { key: 'search', status: 'running', fraction: 0.5 },
      { key: 'model', status: 'pending' }
    ]
  })
  await view.settled()
  // (100 × 0.5 + 100 × 1 + 50 × 1 + 0 × 5) / (0.5 + 1 + 1 + 5) = 26.7 → 27%
  assert.ok(view.find({ type: 'Progress', label: 'Progress: 27%' }))
  assert.ok(view.find({ text: '27%' }))
  assert.ok(view.find({ text: '–' }))
  assert.ok(view.find({ type: 'Progress', label: 'Finding relevant code: 50%' }))
  assert.ok(view.find({ text: '0%' }))

  // The model call runs for a while: its share is an estimate, marked ≈, and the note explains it.
  panel.applyProgress({
    runId: 'r2',
    startedAt: started,
    steps: [
      { key: 'workspace', status: 'done' },
      { key: 'project', status: 'done' },
      { key: 'git', status: 'skipped' },
      { key: 'search', status: 'done', detail: '3' },
      { key: 'model', status: 'running', detail: 'OpenAI · gpt', startedAt: Date.now() - 8000 }
    ]
  })
  await view.settled()
  const model = view.find({ text: /^≈\d+%$/ })
  assert.ok(model, JSON.stringify(view.summary()))
  const estimate = Number(String(model.text).slice(1, -1))
  assert.ok(estimate > 50 && estimate < 95, String(estimate))
  assert.ok(view.find({ text: /≈ estimated: a model reports no progress of its own/ }))

  // Cancel: the bar stays where it was, never 100%, and the card ends.
  const before = Number(String(view.find({ type: 'Progress', label: /^Progress: / })!.props.value))
  panel.finishRunForTest('r2', 'cancelled')
  await view.settled()
  const after = view.find({ type: 'Progress', label: /^Progress: / })!
  assert.ok(Number(after.props.value) >= before - 1 && Number(after.props.value) < 100, `${before} → ${after.props.value}`)
  // The stopped model step still shows what it had reached, so the total stays the mean of what is shown.
  assert.ok(view.find({ text: /^\d+%$/ }))
  assert.ok(view.find({ text: 'Cancelled' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
