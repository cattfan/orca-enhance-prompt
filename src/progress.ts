// Real progress of one enhance run: the steps it will take (from the context level and Privacy),
// each marked running, done, skipped or failed as the worker actually reaches it. The panel draws
// the latest snapshot; the model call has no percentage of its own, so it counts as one step.

export type StepKey = 'workspace' | 'project' | 'git' | 'search' | 'pick' | 'terminal' | 'model'
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed'
export type Step = { key: StepKey; status: StepStatus; detail?: string }
export type ProgressSnapshot = { runId: string; startedAt: number; steps: Step[] }

const RANK = { off: 0, basic: 1, standard: 2, deep: 3, max: 4 } as const

/** The steps a run will go through, in order. */
export function planSteps(level: keyof typeof RANK, allowProjectFiles: boolean): StepKey[] {
  const steps: StepKey[] = []
  if (RANK[level] >= RANK.basic) steps.push('workspace')
  if (RANK[level] >= RANK.standard && allowProjectFiles) steps.push('project')
  if (RANK[level] >= RANK.deep && allowProjectFiles) steps.push('git', 'search')
  if (RANK[level] >= RANK.max) {
    if (allowProjectFiles) steps.push('pick')
    steps.push('terminal')
  }
  steps.push('model')
  return steps
}

/** Share of finished steps, 0-100; skipped steps count as finished. */
export function percent(steps: readonly Step[]): number {
  if (steps.length === 0) return 0
  const finished = steps.filter((step) => step.status === 'done' || step.status === 'skipped').length
  return Math.round((finished / steps.length) * 100)
}

export type StepReporter = (key: StepKey, status: StepStatus, detail?: string) => void

/** Tracks a run's steps and sends a full snapshot on every change (a missed message never matters). */
export function createProgress(runId: string, keys: StepKey[], send: (snapshot: ProgressSnapshot) => void): StepReporter {
  const startedAt = Date.now()
  const steps: Step[] = keys.map((key) => ({ key, status: 'pending' }))
  send({ runId, startedAt, steps: steps.map((step) => ({ ...step })) })
  return (key, status, detail) => {
    let step = steps.find((entry) => entry.key === key)
    if (!step) {
      // A step that was not planned (it should not happen): put it before the model call.
      step = { key, status: 'pending' }
      steps.splice(Math.max(0, steps.length - 1), 0, step)
    }
    step.status = status
    if (detail !== undefined) step.detail = detail
    send({ runId, startedAt, steps: steps.map((entry) => ({ ...entry })) })
  }
}
