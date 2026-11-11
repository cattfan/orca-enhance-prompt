// Which workspace a terminal is in.
//
// Orca's plugin API names the focused workspace by its name and branch only, and several workspaces
// can share both: every project's first checkout is "main" on "main". Orca does say which workspace
// an agent's terminal is in, in its agent events and tool hooks. The worker keeps that pairing (two
// ids, nothing of what the agent did; the newest MAX_TERMINALS, in the plugin's storage so it
// survives a restart), and the focused workspace is then known by its terminals. The panel keeps its
// own notes too (it also remembers the folder the person picked); what Orca said comes first.
import type { JsonValue, OrcaWorkerApi } from 'orca/worker'

export const TERMINALS_KEY = 'terminalWorkspaces'
export const MAX_TERMINALS = 500
const MAX_ID_CHARS = 1200

/** Terminal id -> workspace id as Orca gave it; insertion order is age (oldest first). */
let known = new Map<string, string>()
let loading: Promise<void> | null = null
let saving: Promise<unknown> = Promise.resolve()

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_CHARS

function prune(): void {
  for (const id of [...known.keys()].slice(0, Math.max(0, known.size - MAX_TERMINALS))) known.delete(id)
}

/** Reads what an earlier run of the worker kept. Pairings learnt meanwhile are newer and win. */
export function loadTerminals(orca: OrcaWorkerApi): Promise<void> {
  loading ??= (async () => {
    const stored = await orca.storage.get(TERMINALS_KEY).catch(() => null)
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return
    const merged = new Map<string, string>()
    for (const [terminal, workspace] of Object.entries(stored)) if (isId(terminal) && isId(workspace)) merged.set(terminal, workspace)
    for (const [terminal, workspace] of known) {
      merged.delete(terminal)
      merged.set(terminal, workspace)
    }
    known = merged
    prune()
  })()
  return loading
}

function save(orca: OrcaWorkerApi): void {
  // One write after another, each with the map as it is by then.
  saving = saving
    .then(() => loadTerminals(orca))
    .then(() => orca.storage.set(TERMINALS_KEY, Object.fromEntries(known) as JsonValue))
    .catch((error: unknown) => orca.log(`terminals: ${(error as Error).message}`))
}

/** Orca said this terminal is in this workspace (an agent event or a tool hook). */
export function learnTerminal(orca: OrcaWorkerApi, terminalId: unknown, workspaceId: unknown): void {
  if (!isId(terminalId) || !isId(workspaceId) || known.get(terminalId) === workspaceId) return
  known.delete(terminalId)
  known.set(terminalId, workspaceId)
  prune()
  save(orca)
}

/** The workspaces Orca named for these terminals, the one with the most of them first. */
export function workspacesOfTerminals(terminalIds: readonly string[]): string[] {
  const count = new Map<string, number>()
  for (const id of terminalIds) {
    const workspace = known.get(id)
    if (workspace) count.set(workspace, (count.get(workspace) ?? 0) + 1)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([workspace]) => workspace)
}

/** Resolves once everything learnt so far is in storage (tests, and "Delete everything"). */
export function terminalsSaved(): Promise<unknown> {
  return saving
}

/** Forgets every pairing, here and (with `orca`) in storage: "Delete everything", and between tests. */
export async function forgetTerminals(orca?: OrcaWorkerApi): Promise<void> {
  await saving.catch(() => undefined)
  known = new Map()
  loading = orca ? Promise.resolve() : null
  saving = Promise.resolve()
  if (orca) await orca.storage.delete(TERMINALS_KEY).catch(() => undefined)
}
