// The other agent sessions Orca runs in the focused workspace (Max level, Privacy "Read other agents'
// sessions"). Orca offers no API for an agent's chat history: what it does offer is the list of
// agents with their kind, title and state (`agents.list`), and each terminal's newest output
// (`terminal.read`), which for an agent CLI is its conversation as shown on screen. Both are read
// here, for the agents other than the one the prompt goes to, with obvious secrets masked.
import type { OrcaWorkerApi } from 'orca/worker'

/** The defaults (Privacy can change them, see OTHER_AGENTS_LIMITS): agents read, lines per terminal. */
export const MAX_SESSIONS = 4
export const SESSION_LINES = 80
/** Characters kept per session: 2,500 up to 80 lines, then about 32 a line, at most 8,000. */
export const SESSION_CHARS = 2500
export const sessionChars = (lines: number) => (lines <= SESSION_LINES ? SESSION_CHARS : Math.min(8000, lines * 32))

export type AgentSummary = { terminalId: string; agent: string | null; title: string | null; state: string; stateStartedAt: number }

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
]
/** `API_KEY=...`, `"token": "..."`, `password: ...`: the name stays, the value goes. */
const SECRET_ASSIGNMENT = /\b([A-Za-z0-9_]*(?:api[_-]?key|token|secret|passw(?:or)?d|credential)[A-Za-z0-9_]*)(["']?\s*[:=]\s*["']?)([^\s"',;]{6,})/gi

/** Masks values that look like keys, tokens or passwords. */
export function redactSecrets(text: string): string {
  let out = text
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]')
  // A count of tokens is not a token: `max_tokens: 200000`, `input_tokens=1234567` and
  // `{"max_tokens": 200000}` (the value takes the closing brace with it) stay as they are.
  return out.replace(SECRET_ASSIGNMENT, (match, name: string, sep: string, value: string) =>
    /tokens$/i.test(name) && /^\d+[\]})]*$/.test(value) ? match : `${name}${sep}[redacted]`
  )
}

/** How long ago, for the summary line: "3 min", "2 h". */
function since(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`
}

/** The agents in the focused workspace other than `except`, busiest first; [] when Orca cannot list them. */
export async function otherAgents(orca: OrcaWorkerApi, except: string | null | undefined, signal?: AbortSignal): Promise<AgentSummary[]> {
  if (!orca.host.has('agents.list')) return []
  const listed = await orca.host.call('agents.list', {}, signal ? { signal } : undefined).catch(() => null)
  const order: Record<string, number> = { working: 0, blocked: 1, waiting: 2, done: 3 }
  return (listed?.agents ?? [])
    .filter((entry): entry is typeof entry & { terminalId: string } => Boolean(entry.terminalId) && entry.terminalId !== except)
    .sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || b.stateStartedAt - a.stateStartedAt)
    .map((entry) => ({ terminalId: entry.terminalId, agent: entry.agent, title: entry.title, state: entry.state, stateStartedAt: entry.stateStartedAt }))
}

/** One line per agent: kind, title, state and for how long. */
export function agentsSummary(agents: readonly AgentSummary[], now = Date.now()): string {
  return agents.map((entry) => `- ${entry.agent ?? 'agent'} · ${entry.title ?? entry.terminalId} · ${entry.state} for ${since(entry.stateStartedAt, now)}`).join('\n')
}

/** The newest output of one agent's terminal, secrets masked, the end kept; '' when unreadable. */
export async function readSession(orca: OrcaWorkerApi, terminalId: string, signal?: AbortSignal, lines = SESSION_LINES): Promise<string> {
  if (!orca.host.has('terminal.read')) return ''
  const read = await orca.host.call('terminal.read', { terminalId, maxLines: lines }, signal ? { signal } : undefined).catch(() => null)
  // Orca may return more lines than asked (an older version): keep the last `lines`.
  const text = redactSecrets((read?.lines ?? []).map((line) => line.trimEnd()).filter(Boolean).slice(-lines).join('\n'))
  const chars = sessionChars(lines)
  return text.length > chars ? `…\n${text.slice(-chars)}` : text
}
