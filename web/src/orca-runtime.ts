// The `orca` module, as the panel's state and actions use it, built for the web panel's frame. That
// code (src/panel/state.ts, actions.ts, view.ts, setup.ts) is written against Orca's panel runtime
// (atom/read/set, plugin, settings), which is what the tests run it on; in the frame this file
// provides the same on top of `window.orca` (the frame API). Vite points the import 'orca' here;
// TypeScript keeps checking against Orca's own types.
// The atoms themselves are in ./store (no React there, so the plugin's tests can load them).
import { useSyncExternalStore } from 'react'
import { frame, subscribe, version } from './store'

export { atom, derived, read, ready, set, subscribe, update } from './store'

/** Re-renders the component calling it whenever any atom changes (the whole panel is small). */
export function useOrca(): number {
  return useSyncExternalStore(subscribe, version)
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
