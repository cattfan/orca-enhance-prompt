// The `orca` module of a components panel, rebuilt for the web panel's frame. The panel's state and
// actions (src/panel/state.ts, actions.ts, view.ts) are shared with the components panel unchanged:
// they use atom/read/set and plugin/settings, which this file provides on top of `window.orca` (the
// frame API). Vite points the import 'orca' here; TypeScript keeps checking against Orca's own types.
import { useSyncExternalStore } from 'react'

type Box = { value: unknown; compute?: () => unknown }
type FrameApi = typeof window.orca

const frame = (): FrameApi => window.orca

// ---------------------------------------------------------------- atoms

const listeners = new Set<() => void>()
let version = 0
let scheduled = false

function changed(): void {
  version += 1
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    for (const listener of listeners) listener()
  })
}

/** Re-renders the component calling it whenever any atom changes (the whole panel is small). */
export function useOrca(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version
  )
}

const PLUGIN_PREFIX = 'enhance-prompt:'
/** Storage atoms load from the plugin's storage in ready(), before the first render. */
const storageAtoms: { box: Box; key: string; initial: unknown }[] = []

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
const persisted = new Map<Box, string>()
const storageKeys = new Map<Box, string>()

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

// ---------------------------------------------------------------- Orca services

export const plugin = {
  request: (name: string, input?: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }) =>
    frame().plugin.request(name as never, input as never, options),
  on: (event: string, handler: (payload: never) => void) => frame().plugin.on(event as never, handler as never)
}

export const settings = {
  get: (key?: string) => (key === undefined ? frame().settings.get() : frame().settings.get(key)),
  set: (key: string, value: unknown) => frame().settings.set(key, value as never),
  onDidChange: (listener: (change: { key: string }) => void) => frame().settings.onDidChange(listener)
}

export const storage = {
  get: (key: string) => frame().storage.get(key),
  set: (key: string, value: unknown) => frame().storage.set(key, value as never),
  delete: (key: string) => frame().storage.delete(key),
  keys: () => frame().storage.keys(),
  onDidChange: (listener: (change: { key: string }) => void) => frame().storage.onDidChange(listener)
}

export const shell = {
  openExternal: async (url: string) => {
    const api = frame().shell
    if (!api) return { opened: false }
    return api.openExternal(url)
  }
}

export function on(event: string, handler: (payload: never) => void): { dispose(): void } {
  return frame().on(event as never, handler as never)
}

export const env = {
  get locale(): string {
    return frame().locale
  },
  get theme(): { colorScheme: 'light' | 'dark' } {
    return { colorScheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light' }
  },
  client: 'desktop' as const
}
