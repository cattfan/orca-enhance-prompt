// The panel's atoms (atom, derived, read, set, update) and their storage, with no React import, so
// the plugin's own test runner can load it (src/web-runtime.test.ts). web/src/orca-runtime.ts adds
// the React hook and the Orca services on top.

type Box = { value: unknown; compute?: () => unknown }
type FrameApi = typeof window.orca

export const frame = (): FrameApi => window.orca

const listeners = new Set<() => void>()
let changes = 0

/** How many changes so far: React re-renders when it moves. */
export const version = (): number => changes

/**
 * Tells React at once (not on a later microtask): a typed character must reach the textarea's value
 * within the same event, or React puts the old text back and the caret jumps to the end. React
 * batches several set() calls in one handler into one render by itself.
 */
function changed(): void {
  changes += 1
  for (const listener of listeners) listener()
}

/** Called on every change (the panel's React hook subscribes here). */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const PLUGIN_PREFIX = 'enhance-prompt:'
/** Storage atoms load from the plugin's storage in ready(), before the first render. */
const storageAtoms: { box: Box; key: string; initial: unknown }[] = []
const persisted = new Map<Box, string>()
const storageKeys = new Map<Box, string>()

export function atom<T>(keyOrInitial: unknown, initial?: T, options?: { persist?: string }): Box {
  if (arguments.length < 2) return { value: keyOrInitial }
  const key = String(keyOrInitial)
  const box: Box = { value: initial }
  if (options?.persist === 'plugin' || options?.persist === 'workspace') {
    // Every run of the panel: the frame's own storage (kept by Orca per plugin).
    const saved = localStorage.getItem(PLUGIN_PREFIX + key)
    if (saved !== null) {
      try {
        box.value = JSON.parse(saved)
      } catch {
        // A damaged copy: start from the initial value.
      }
    }
    persisted.set(box, key)
  }
  if (options?.persist === 'storage') {
    storageKeys.set(box, key)
    storageAtoms.push({ box, key, initial })
  }
  return box
}

export function derived<T>(compute: () => T): Box {
  return { value: undefined, compute }
}

export function read<T>(target: unknown): T {
  const box = target as Box
  return (box.compute ? box.compute() : box.value) as T
}

export function set<T>(target: unknown, value: T): void {
  const box = target as Box
  if (Object.is(box.value, value)) return
  box.value = value
  const key = persisted.get(box)
  if (key !== undefined) localStorage.setItem(PLUGIN_PREFIX + key, JSON.stringify(value ?? null))
  const storageKey = storageKeys.get(box)
  if (storageKey !== undefined) void frame().storage.set(storageKey, (value ?? null) as never)
  changed()
}

export function update<T>(target: unknown, updater: (previous: T) => T): void {
  set(target, updater(read<T>(target)))
}

/**
 * Loads every storage atom and follows its changes (the worker writes history there). Called once
 * `window.orca` exists: atoms are created when the modules load, which can be before it does.
 */
export async function ready(): Promise<void> {
  await Promise.all(storageAtoms.map((entry) => follow(entry)))
}

function follow({ box, key, initial }: { box: Box; key: string; initial: unknown }): Promise<void> {
  const load = async (): Promise<void> => {
    const value = await frame().storage.get(key).catch(() => null)
    box.value = value ?? initial
    changed()
  }
  frame().storage.onDidChange((change) => {
    if (change.key === key) void load()
  })
  return load()
}
