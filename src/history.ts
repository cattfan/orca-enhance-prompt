// History entries, shared by the panel and the worker (no Node imports here).
import type { JsonValue } from 'orca'

export type HistoryEntry = {
  id: string
  at: number
  original: string
  enhanced: string
  style: string
  model: string
  source: 'panel' | 'hook'
}

/** Storage key; the panel reads it as a `persist: 'storage'` atom. */
export const HISTORY_KEY = 'history'

export function toJson(entry: HistoryEntry): JsonValue {
  return { ...entry }
}

/** Keeps only well-formed entries from whatever storage holds. */
export function parseHistory(value: JsonValue | null): HistoryEntry[] {
  if (!Array.isArray(value)) {
    return []
  }
  const out: HistoryEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    const { id, at, original, enhanced, style, model, source } = item
    if (typeof id === 'string' && typeof at === 'number' && typeof original === 'string' && typeof enhanced === 'string') {
      out.push({
        id,
        at,
        original,
        enhanced,
        style: typeof style === 'string' ? style : 'balanced',
        model: typeof model === 'string' ? model : '',
        source: source === 'hook' ? 'hook' : 'panel'
      })
    }
  }
  return out
}
