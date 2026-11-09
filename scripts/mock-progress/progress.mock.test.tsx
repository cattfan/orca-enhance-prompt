// The progress mock: the real panel, fed by the real progress tracker on a simulated clock, with no
// worker, model, git or network. Every frame is the panel's own component tree, saved for
// scripts/mock-progress.mjs to draw. It only runs when that script asks (MOCK_PROGRESS_OUT is set),
// so `orca plugin test .` skips it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from '../../src/panel.tsx'
import { PRESETS } from '../../src/presets.ts'
import { createProgress, type ProgressSnapshot, type StepKey, type StepReporter } from '../../src/progress.ts'

const out = process.env.MOCK_PROGRESS_OUT
const language = process.env.MOCK_PROGRESS_LANG === 'vi' ? 'vi' : 'en'

/** One moment of a mock run: what the worker reports at that simulated time. */
type Event = { at: number; key: StepKey; status: 'running' | 'done' | 'skipped' | 'failed'; detail?: string; fraction?: number }
type Plan = { name: string; steps: StepKey[]; events: Event[]; frames: number[]; ending?: 'done' | 'cancelled' }

/** Steps one after another: each finishes before the next starts. */
const sequential: Plan = {
  name: 'sequential',
  steps: ['workspace', 'project', 'git', 'search', 'model'],
  events: [
    { at: 0, key: 'workspace', status: 'running' },
    { at: 200, key: 'workspace', status: 'done', detail: 'web-app' },
    { at: 200, key: 'project', status: 'running', fraction: 0.15 },
    { at: 500, key: 'project', status: 'running', fraction: 0.5 },
    { at: 800, key: 'project', status: 'running', fraction: 0.8 },
    { at: 1000, key: 'project', status: 'done', detail: '1240' },
    { at: 1000, key: 'git', status: 'running' },
    { at: 1300, key: 'git', status: 'running', fraction: 1 / 3 },
    { at: 1500, key: 'git', status: 'running', fraction: 2 / 3 },
    { at: 1700, key: 'git', status: 'done', detail: '4' },
    { at: 1700, key: 'search', status: 'running', fraction: 0.3 },
    { at: 2100, key: 'search', status: 'running', fraction: 0.6 },
    { at: 2400, key: 'search', status: 'running', fraction: 0.9 },
    { at: 2500, key: 'search', status: 'done', detail: '6' },
    { at: 2500, key: 'model', status: 'running', detail: 'Claude Code · sonnet' },
    { at: 14_500, key: 'model', status: 'done', detail: 'Claude Code · sonnet' }
  ],
  frames: [0, 100, 350, 650, 900, 1200, 1400, 1600, 1900, 2300, 2450, 4000, 7000, 10_000, 14_000, 14_500]
}

/** Several sub-processes at once: project rules, git and code search side by side, then the model. */
const parallel: Plan = {
  name: 'parallel',
  steps: ['workspace', 'project', 'git', 'search', 'model'],
  events: [
    { at: 0, key: 'workspace', status: 'running' },
    { at: 100, key: 'workspace', status: 'done', detail: 'web-app' },
    { at: 100, key: 'project', status: 'running', fraction: 0.15 },
    { at: 100, key: 'git', status: 'running' },
    { at: 100, key: 'search', status: 'running', fraction: 0.1 },
    { at: 400, key: 'git', status: 'running', fraction: 1 / 3 },
    { at: 500, key: 'project', status: 'running', fraction: 0.5 },
    { at: 600, key: 'search', status: 'running', fraction: 0.45 },
    { at: 800, key: 'git', status: 'running', fraction: 2 / 3 },
    { at: 900, key: 'project', status: 'running', fraction: 0.8 },
    { at: 1000, key: 'search', status: 'running', fraction: 0.8 },
    { at: 1100, key: 'project', status: 'done', detail: '1240' },
    { at: 1200, key: 'git', status: 'done', detail: '4' },
    { at: 1300, key: 'search', status: 'done', detail: '6' },
    { at: 1300, key: 'model', status: 'running', detail: 'Claude Code · sonnet' },
    { at: 11_300, key: 'model', status: 'done', detail: 'Claude Code · sonnet' }
  ],
  frames: [0, 300, 550, 850, 1050, 1250, 3000, 6000, 9000, 11_000, 11_300]
}

/** A run cancelled while the model writes: the bar stops where it was, below 100%. */
const cancelled: Plan = {
  name: 'cancelled',
  steps: ['workspace', 'project', 'model'],
  events: [
    { at: 0, key: 'workspace', status: 'running' },
    { at: 100, key: 'workspace', status: 'done', detail: 'web-app' },
    { at: 100, key: 'project', status: 'running', fraction: 0.5 },
    { at: 400, key: 'project', status: 'done', detail: '1240' },
    { at: 400, key: 'model', status: 'running', detail: 'Claude Code · sonnet' }
  ],
  frames: [0, 300, 3000, 6000],
  ending: 'cancelled'
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
/** Every Progress bar in a tree, by its label. */
function bars(tree: unknown): Record<string, number> {
  const found: Record<string, number> = {}
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    const n = node as Node
    if (n.type === 'Progress') found[String(n.props?.label)] = Number(n.props?.value)
    n.children?.forEach(walk)
  }
  walk(tree)
  return found
}

test('progress mock (draws only when scripts/mock-progress.mjs runs it)', async () => {
  if (!out) return
  const host = mockHost({
    settings: { uiLanguage: language },
    requests: {
      'models.get': { profiles: [], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
      'targets.list': { targets: [] },
      'models.detect': { found: [] },
      'rules.get': { rules: [], structures: [] }
    }
  })
  const view = await mount(panel, { host })
  const frames: { plan: string; at: number; total: number | null; bars: Record<string, number>; tree: unknown }[] = []
  for (const plan of [sequential, parallel, cancelled]) {
    let simulated = 0
    const base = Date.now()
    const runId = `mock-${plan.name}`
    panel.beginRun(runId)
    let latest: ProgressSnapshot | null = null
    const report: StepReporter = createProgress(runId, plan.steps, (snapshot) => (latest = snapshot), () => base + simulated)
    let next = 0
    for (const at of plan.frames) {
      simulated = at
      while (next < plan.events.length && plan.events[next].at <= at) {
        const event = plan.events[next++]
        simulated = event.at
        report(event.key, event.status, event.detail, event.fraction)
      }
      simulated = at
      panel.applyProgress(latest!)
      panel.setNowForTest(base + at)
      await view.settled()
      if (plan.ending && at === plan.frames.at(-1)) {
        panel.finishRunForTest(runId, plan.ending)
        await view.settled()
      }
      const tree = view.tree()
      const found = bars(tree)
      const totalLabel = Object.keys(found).find((label) => /^(Progress|Tiến độ): /.test(label))
      frames.push({ plan: plan.name, at, total: totalLabel ? found[totalLabel] : null, bars: found, tree })
    }
  }
  assert.deepEqual(view.errors, [])
  await view.unmount()
  mkdirSync(out!, { recursive: true })
  writeFileSync(join(out!, 'frames.json'), JSON.stringify(frames))
})
