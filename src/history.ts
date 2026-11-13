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
  /** The project it was written in (its name in Orca), where that was known; older entries have none. */
  project?: string
}

/** Storage key; the panel reads it as a `persist: 'storage'` atom. */
export const HISTORY_KEY = 'history'

/** A prompt or rewrite longer than this is kept trimmed in history. */
export const HISTORY_ENTRY_CHARS = 20_000
/** All entries together stay under this many characters (the panel loads them all); oldest go first. */
export const HISTORY_TOTAL_CHARS = 1_000_000
const TRIMMED = '\n…(trimmed in history)'

export function trimForHistory(text: string): string {
  return text.length > HISTORY_ENTRY_CHARS ? text.slice(0, HISTORY_ENTRY_CHARS - TRIMMED.length) + TRIMMED : text
}

/** Newest first: at most `limit` entries and HISTORY_TOTAL_CHARS of text. */
export function capHistory(list: HistoryEntry[], limit: number): HistoryEntry[] {
  const out: HistoryEntry[] = []
  let total = 0
  for (const entry of list.slice(0, Math.max(0, limit))) {
    total += entry.original.length + entry.enhanced.length
    if (total > HISTORY_TOTAL_CHARS) break
    out.push(entry)
  }
  return out
}

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
    const { id, at, original, enhanced, style, model, source, project } = item
    if (typeof id === 'string' && typeof at === 'number' && typeof original === 'string' && typeof enhanced === 'string') {
      out.push({
        id,
        at,
        original,
        enhanced,
        style: typeof style === 'string' ? style : 'balanced',
        model: typeof model === 'string' ? model : '',
        source: source === 'hook' ? 'hook' : 'panel',
        ...(typeof project === 'string' && project.trim() ? { project: project.trim().slice(0, 200) } : {})
      })
    }
  }
  return out
}
