// Real progress of one enhance run: the steps it will take (from the context level and Privacy),
// each marked running, done, skipped or failed as the worker actually reaches it, with how far a
// running step has got when the worker can count it (git commands finished, words searched, files
// read). A model call reports no progress of its own: its share is an estimate from the time it has
// been running, never 100% until the answer is in, and the panel marks it as an estimate.

export type StepKey = 'error' | 'workspace' | 'project' | 'git' | 'search' | 'pick' | 'terminal' | 'model'
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed'
export type Step = {
  key: StepKey
  status: StepStatus
  detail?: string
  /** Counted share of a running (or failed) step, 0 to 1. */
  fraction?: number
  /** When the step started running (ms since the epoch): the estimate for model calls uses it. */
  startedAt?: number
}
export type ProgressSnapshot = { runId: string; startedAt: number; steps: Step[] }

const RANK = { off: 0, basic: 1, standard: 2, deep: 3, max: 4 } as const

/** The steps a run will go through, in order. */
export function planSteps(level: keyof typeof RANK, allowProjectFiles: boolean, readsError = false): StepKey[] {
  const steps: StepKey[] = readsError ? ['error'] : []
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

/**
 * How much of a run each step is, roughly by the time it usually takes: the model call is most of
 * it, the AI file picker is a smaller model call, reading the workspace or a terminal is instant.
 */
export const STEP_WEIGHTS: Record<StepKey, number> = { error: 1, workspace: 0.5, project: 1, git: 1, search: 1, pick: 2, terminal: 0.5, model: 5 }

/** Steps whose share is estimated from time, because a model call reports no progress. */
export const ESTIMATED_STEPS: ReadonlySet<StepKey> = new Set<StepKey>(['model', 'pick'])
/** The estimate approaches this share and never passes it before the answer arrives. */
const ESTIMATE_CAP = 95
/** Time constant of the estimate: about 63% after 8 s, 90% after 18 s. */
const ESTIMATE_TAU_MS = 8000

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value)))

/**
 * One step's share, 0-100. Done: 100. Pending: 0. Skipped: null (not part of the run), or what it
 * had reached when a cancel stopped it. Running:
 * the counted fraction, or for a model call an estimate from its running time; both stay below 100
 * until the step is done. Failed: what it had reached.
 */
export function stepPercent(step: Step, now = Date.now()): number | null {
  // Skipped from the start: not part of the run. Stopped by a cancel: what it had reached.
  if (step.status === 'skipped') return step.fraction === undefined ? null : clamp(step.fraction * 100, 99)
  if (step.status === 'done') return 100
  if (step.status === 'pending') return 0
  if (step.fraction !== undefined) return clamp(step.fraction * 100, 99)
  if (step.status === 'running' && ESTIMATED_STEPS.has(step.key) && step.startedAt !== undefined) {
    const elapsed = Math.max(0, now - step.startedAt)
    return clamp(ESTIMATE_CAP * (1 - Math.exp(-elapsed / ESTIMATE_TAU_MS)), ESTIMATE_CAP)
  }
  return 0
}

/**
 * The run's share, 0-100: the weighted mean of its steps' shares (weights in STEP_WEIGHTS), leaving
 * out skipped steps. So it always lies between the smallest and the largest step share, reaches 100
 * only when every step that ran is done, and is 0 when nothing is known yet.
 */
export function totalPercent(steps: readonly Step[], now = Date.now()): number {
  let sum = 0
  let weights = 0
  for (const step of steps) {
    const share = stepPercent(step, now)
    if (share === null) continue
    const weight = STEP_WEIGHTS[step.key] ?? 1
    sum += share * weight
    weights += weight
  }
  if (weights === 0) return steps.length > 0 ? 100 : 0
  const total = sum / weights
  // 100 is shown only when every step is done; rounding must not say "100%" before that.
  const allDone = steps.every((step) => step.status === 'done' || step.status === 'skipped')
  return allDone ? 100 : clamp(total, 99)
}

/** Reports a step: its status, an optional detail, and for a running step how far it has got (0-1). */
export type StepReporter = (key: StepKey, status: StepStatus, detail?: string, fraction?: number) => void

/** Tracks a run's steps and sends a full snapshot on every change (a missed message never matters). */
export function createProgress(runId: string, keys: StepKey[], send: (snapshot: ProgressSnapshot) => void, clock: () => number = Date.now): StepReporter {
  const startedAt = clock()
  const steps: Step[] = keys.map((key) => ({ key, status: 'pending' }))
  send({ runId, startedAt, steps: steps.map((step) => ({ ...step })) })
  return (key, status, detail, fraction) => {
    let step = steps.find((entry) => entry.key === key)
    if (!step) {
      // A step that was not planned (it should not happen): put it before the model call.
      step = { key, status: 'pending' }
      steps.splice(Math.max(0, steps.length - 1), 0, step)
    }
    if (status === 'running' && step.startedAt === undefined) step.startedAt = clock()
    step.status = status
    if (detail !== undefined) step.detail = detail
    if (status === 'done' || status === 'skipped') delete step.fraction
    // (finishRun in the panel sets the fraction of a step stopped by a cancel, after this.)
    else if (fraction !== undefined) step.fraction = Math.min(1, Math.max(0, fraction))
    send({ runId, startedAt, steps: steps.map((entry) => ({ ...entry })) })
  }
}
