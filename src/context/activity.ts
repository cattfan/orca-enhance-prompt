// What happened lately in each workspace, as Orca reports it to the worker: the tools agents ran
// (hook `agent.tool.after`: the tool and its target, a file or a command, never its output), how
// their sessions ended (event `agent.status.changed`), and the files the person saved in Orca's
// editor (hook `editor.save.before`: the path only, never the text). Kept in memory only, at most
// MAX_ENTRIES per workspace and for KEEP_MS; nothing is written to disk. Each kind is recorded only
// while its Privacy switch is on, and switching it off forgets what was kept.
import type { JsonValue } from 'orca'
import { redactSecrets } from './agents.ts'

export const MAX_ENTRIES = 60
export const KEEP_MS = 45 * 60_000
const TARGET_CHARS = 160

type ToolEntry = { kind: 'tool'; at: number; agent: string; tool: string; target: string }
type StatusEntry = { kind: 'status'; at: number; title: string; state: string; outcome?: string }
type SaveEntry = { kind: 'save'; at: number; path: string }
type Entry = ToolEntry | StatusEntry | SaveEntry

const byWorkspace = new Map<string, Entry[]>()

function push(workspaceId: string | null, entry: Entry): void {
  if (!workspaceId) return
  const list = byWorkspace.get(workspaceId) ?? []
  list.push(entry)
  const cutoff = entry.at - KEEP_MS
  byWorkspace.set(workspaceId, list.filter((item) => item.at >= cutoff).slice(-MAX_ENTRIES))
}

/** The part of a tool's input that says what it acted on: a path, a command, a pattern or a URL. */
export function toolTarget(input: JsonValue): string {
  if (typeof input === 'string') return redactSecrets(input).slice(0, TARGET_CHARS)
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ''
  const fields = input as Record<string, JsonValue>
  for (const key of ['file_path', 'filePath', 'path', 'notebook_path', 'command', 'cmd', 'pattern', 'query', 'url']) {
    const value = fields[key]
    if (typeof value === 'string' && value.trim()) return redactSecrets(value.replace(/\s+/g, ' ').trim()).slice(0, TARGET_CHARS)
    if (Array.isArray(value) && value.every((part) => typeof part === 'string')) return redactSecrets(value.join(' ')).slice(0, TARGET_CHARS)
  }
  return ''
}

export function recordTool(event: { agent: string; workspaceId: string | null; tool: string; input: JsonValue }, now = Date.now()): void {
  push(event.workspaceId, { kind: 'tool', at: now, agent: event.agent, tool: event.tool, target: toolTarget(event.input) })
}

/** Only the end of a session is kept (done, with how it ended), not every state change. */
export function recordStatus(event: { workspaceId: string | null; title?: string; state: string; mainAgent?: { outcome?: string } }, now = Date.now()): void {
  if (event.state !== 'done' && event.state !== 'blocked') return
  push(event.workspaceId, { kind: 'status', at: now, title: event.title ?? 'agent', state: event.state, ...(event.mainAgent?.outcome ? { outcome: event.mainAgent.outcome } : {}) })
}

export function recordSave(event: { workspaceId: string | null; path: string }, now = Date.now()): void {
  push(event.workspaceId, { kind: 'save', at: now, path: event.path })
}

/** Forgets one kind (its switch went off) or everything (Delete everything). */
export function forgetActivity(kind?: 'agents' | 'saves'): void {
  for (const [id, list] of byWorkspace) {
    const kept = kind === undefined ? [] : list.filter((item) => (kind === 'saves' ? item.kind !== 'save' : item.kind === 'save'))
    if (kept.length > 0) byWorkspace.set(id, kept)
    else byWorkspace.delete(id)
  }
}

const ago = (at: number, now: number) => {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  return minutes === 0 ? 'just now' : `${minutes} min ago`
}

/** The agents' recent actions in a workspace, newest last; '' when there are none. */
export function agentActivity(workspaceId: string, now = Date.now()): string {
  const list = (byWorkspace.get(workspaceId) ?? []).filter((item) => item.kind !== 'save' && now - item.at <= KEEP_MS)
  return list
    .map((item) =>
      item.kind === 'tool'
        ? `- ${ago(item.at, now)} · ${item.agent} · ${item.tool}${item.target ? `: ${item.target}` : ''}`
        : item.kind === 'status'
          ? `- ${ago(item.at, now)} · session "${item.title}" ${item.state}${item.outcome ? ` (${item.outcome})` : ''}`
          : ''
    )
    .filter(Boolean)
    .join('\n')
}

/** The files the person saved lately in a workspace, newest first, each once. */
export function savedFiles(workspaceId: string, now = Date.now()): string[] {
  const list = (byWorkspace.get(workspaceId) ?? []).filter((item): item is SaveEntry => item.kind === 'save' && now - item.at <= KEEP_MS)
  return [...new Set(list.reverse().map((item) => item.path))].slice(0, 20)
}
