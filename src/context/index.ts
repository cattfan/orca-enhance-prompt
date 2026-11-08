// Builds the rewriter's project context at a chosen level, within a character budget.
//   off       nothing
//   basic     workspace name/branch, target agent
//   standard  + agent rule files, README digest, stack & commands, repo tree
//   deep      + git status/log/diff, files relevant to the prompt (paths, grep, snippets)
//   max       + AI-picked files from the tree, recent output of the agent terminal
import type { OrcaWorkerApi } from 'orca/worker'
import { LlmError, messageOf } from '../llm.ts'
import { english, msg, raw, type Message } from '../messages.ts'
import type { ContextItemView, ContextLevel } from '../presets.ts'
import type { StepReporter } from '../progress.ts'
import { compilePatterns, isBinaryPath, isExcluded, isSensitive, readText, snippet, treeSummary, walkFiles } from './files.ts'
import { changedPaths, gitDiff, gitFiles, gitGrep, gitGrepCount, gitLog, gitStatus, isGitRepo, statusLinePaths } from './git.ts'
import { readRuleFiles } from './instructions.ts'
import { contentScores, scoreFiles, weightedKeywords } from './relevance.ts'
import { detectStack } from './stack.ts'

export type ContextItem = ContextItemView & { content: string }

const LEVEL_RANK: Record<ContextLevel, number> = { off: 0, basic: 1, standard: 2, deep: 3, max: 4 }
const BUDGET: Record<ContextLevel, number> = { off: 0, basic: 1000, standard: 12_000, deep: 28_000, max: 45_000 }
const RELEVANT_FILES: Record<ContextLevel, number> = { off: 0, basic: 0, standard: 0, deep: 6, max: 10 }

export const atLeast = (level: ContextLevel, min: ContextLevel) => LEVEL_RANK[level] >= LEVEL_RANK[min]

type Workspace = { name: string; path: string; branch: string | null; hostId: string | null }

export type GatherOptions = {
  level: ContextLevel
  prompt: string
  terminalId?: string | null
  terminalLines: number
  exclude: Set<string>
  extraFiles: string[]
  excludePatterns: string
  /** Max level: asks a model to pick files from the tree. */
  pickFiles?: (tree: string[], prompt: string) => Promise<string[]>
  /** Privacy switches: no git commands, no terminal output. */
  allowGit?: boolean
  allowTerminal?: boolean
  /** Progress: called when a step starts, finishes or is skipped. */
  onStep?: StepReporter
  /** Cancel: running git commands are stopped and the gather ends with a cancelled error. */
  signal?: AbortSignal
}

/** Ends a gather that was cancelled (between steps, and after any step a cancel cut short). */
function stopIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LlmError(msg('error.cancelled'), 'cancelled')
}

export type GatherResult = { items: ContextItem[]; notes: Message[]; root: string | null }

/** `label` is a Message for the panel; the model reads its English text. A file's label is its path. */
const item = (id: string, kind: string, label: Message, content: string, why?: Message): ContextItem => ({
  id,
  kind,
  label: english(label),
  content,
  chars: content.length,
  ...(label.code === 'raw' ? {} : { title: label }),
  ...(why ? { note: english(why), why } : {})
})

/** The focused workspace's entry in workspace.list, matched by name and branch. */
export async function findFocusedWorkspace(
  orca: OrcaWorkerApi,
  focused: { displayName: string; branch: string }
): Promise<Workspace | null> {
  if (!orca.host.has('workspace.list')) return null
  try {
    const { workspaces } = await orca.host.call('workspace.list', {})
    const exact = workspaces.filter((ws) => ws.name === focused.displayName && (ws.branch ?? '') === focused.branch)
    if (exact.length === 1) return exact[0]
    const byBranch = focused.branch ? workspaces.filter((ws) => ws.branch === focused.branch) : []
    if (byBranch.length === 1) return byBranch[0]
    const byName = workspaces.filter((ws) => ws.name === focused.displayName)
    return byName.length === 1 ? byName[0] : null
  } catch {
    return null
  }
}

// ---- prompt-independent parts, cached per workspace root (also what the hook uses) ----

type StaticParts = { at: number; files: string[]; isGit: boolean; items: ContextItem[] }
const staticCache = new Map<string, StaticParts>()
const STATIC_TTL_MS = 90_000

export function cachedStatic(root: string): StaticParts | null {
  const hit = staticCache.get(`git:${root}`) ?? staticCache.get(`nogit:${root}`)
  return hit && Date.now() - hit.at < STATIC_TTL_MS * 4 ? hit : null
}

export async function staticParts(root: string, extraFiles: string[], fresh = false, allowGit = true, signal?: AbortSignal): Promise<StaticParts> {
  const cacheKey = `${allowGit ? 'git' : 'nogit'}:${root}`
  const hit = staticCache.get(cacheKey)
  if (hit && !fresh && Date.now() - hit.at < STATIC_TTL_MS) return hit
  const isGit = allowGit && (await isGitRepo(root, signal))
  const listed = (isGit ? await gitFiles(root, signal) : null) ?? (await walkFiles(root, undefined, undefined, signal))
  // A cancelled read is incomplete: never cache it.
  stopIfCancelled(signal)
  const files = listed.filter((file) => !isSensitive(file))
  const items: ContextItem[] = []
  for (const rule of await readRuleFiles(root, files, extraFiles, 9000)) {
    items.push(item(`rules:${rule.name}`, 'rules', raw(rule.name), rule.content))
  }
  const stack = await detectStack(root, files)
  if (stack) items.push(item('stack', 'stack', msg('label.stack'), stack))
  if (files.length > 0) items.push(item('tree', 'tree', msg('label.tree', { count: files.length }), treeSummary(files)))
  stopIfCancelled(signal)
  const parts = { at: Date.now(), files, isGit, items }
  staticCache.set(cacheKey, parts)
  return parts
}

// ---- the full gather ----

export async function gatherContext(orca: OrcaWorkerApi, options: GatherOptions): Promise<GatherResult> {
  const { level } = options
  const step: StepReporter = options.onStep ?? (() => undefined)
  const items: ContextItem[] = []
  const notes: Message[] = []
  if (level === 'off') return { items, notes, root: null }

  const { signal } = options
  stopIfCancelled(signal)
  step('workspace', 'running')
  const focused = await orca.host.call('workspace.readContext', {}).catch(() => null)
  if (focused) {
    items.push(item('workspace', 'workspace', msg('label.workspace'), `${focused.displayName}${focused.branch ? ` (branch ${focused.branch})` : ''}`))
  } else {
    notes.push(msg('note.no_workspace'))
  }
  if (options.terminalId) {
    const agents = await orca.host.call('agents.list', {}).catch(() => null)
    const agent = agents?.agents.find((entry) => entry.terminalId === options.terminalId)
    if (agent?.agent) items.push(item('agent', 'agent', msg('label.agent'), `${agent.agent} (${agent.state})`))
  }
  step('workspace', 'done', focused?.displayName)

  let root: string | null = null
  if (atLeast(level, 'standard')) step('project', 'running')
  if (focused && atLeast(level, 'standard')) {
    const workspace = await findFocusedWorkspace(orca, focused)
    if (!workspace) {
      notes.push(msg('note.workspace_unknown'))
    } else if (workspace.hostId !== null) {
      notes.push(msg('note.remote'))
    } else {
      root = workspace.path
    }
  }

  if (root) {
    stopIfCancelled(signal)
    const parts = await staticParts(root, options.extraFiles, false, options.allowGit !== false, signal)
    items.push(...parts.items)
    step('project', 'done', String(parts.files.length))
    if (atLeast(level, 'deep')) {
      items.push(...(await dynamicParts(root, parts, options, notes)))
    }
  } else if (atLeast(level, 'standard')) {
    step('project', 'skipped')
    if (atLeast(level, 'deep')) {
      step('git', 'skipped')
      step('search', 'skipped')
    }
    if (level === 'max') step('pick', 'skipped')
  }

  if (level === 'max' && options.allowTerminal === false) notes.push(msg('note.terminal_off'))
  // An unticked item is not read at all (not just left out afterwards).
  const readTerminal =
    level === 'max' && options.allowTerminal !== false && Boolean(options.terminalId) && options.terminalLines > 0 && !options.exclude.has('terminal')
  if (level === 'max' && !readTerminal) step('terminal', 'skipped')
  if (readTerminal && options.terminalId) {
    step('terminal', 'running')
    stopIfCancelled(signal)
    const read = await orca.host
      .call('terminal.read', { terminalId: options.terminalId, maxLines: options.terminalLines }, signal ? { signal } : undefined)
      .catch(() => null)
    stopIfCancelled(signal)
    const lines = (read?.lines ?? []).map((line) => line.trimEnd()).filter(Boolean)
    if (lines.length > 0) {
      const title = focused?.terminals.find((t) => t.id === options.terminalId)?.title ?? 'agent terminal'
      items.push(item('terminal', 'terminal', msg('label.terminal', { name: title }), lines.join('\n')))
    }
    step('terminal', 'done', String(lines.length))
  }

  stopIfCancelled(signal)
  return { items: fitBudget(items.filter((entry) => !options.exclude.has(entry.id)), BUDGET[level]), notes, root }
}

async function dynamicParts(
  root: string,
  parts: StaticParts,
  options: GatherOptions,
  notes: Message[]
): Promise<ContextItem[]> {
  const out: ContextItem[] = []
  const patterns = compilePatterns(options.excludePatterns)
  const alreadyIncluded = new Set(parts.items.filter((entry) => entry.kind === 'rules').map((entry) => entry.label))
  // Prose files compete with code only when they live under docs/; rule files are already in.
  const isProse = (file: string) => /\.(md|mdx|rst|txt)$/i.test(file)
  const files = parts.files.filter((file) => {
    if (isExcluded(file, patterns) || isBinaryPath(file) || alreadyIncluded.has(file)) return false
    return !isProse(file) || file.startsWith('docs/')
  })
  let changed = new Set<string>()
  const step: StepReporter = options.onStep ?? (() => undefined)

  const { signal } = options
  stopIfCancelled(signal)
  if (parts.isGit) {
    step('git', 'running')
    const skip = (id: string) => options.exclude.has(id)
    // Status also ranks changed files higher, so it is read even when its item is unticked.
    const status = await gitStatus(root, signal)
    stopIfCancelled(signal)
    if (status && !skip('git:status') && (status.changed.length > 0 || status.branchLine)) {
      const shown = status.changed.filter((line) => !statusLinePaths(line).some((path) => isSensitive(path) || isExcluded(path, patterns)))
      out.push(
        item(
          'git:status',
          'git',
          msg('label.status', { count: shown.length }),
          [status.branchLine && `## ${status.branchLine}`, ...shown.slice(0, 60)].filter(Boolean).join('\n')
        )
      )
    }
    if (status) changed = new Set(changedPaths(status.changed))
    const log = skip('git:log') ? null : await gitLog(root, 6, signal)
    stopIfCancelled(signal)
    if (log?.trim()) out.push(item('git:log', 'git', msg('label.log'), log.trim()))
    const diff = skip('git:diff') ? null : await gitDiff(root, options.level === 'max' ? 9000 : 5000, (path) => !isExcluded(path, patterns), signal)
    stopIfCancelled(signal)
    if (diff) out.push(item('git:diff', 'git', msg('label.diff'), `${diff.stat}\n\n${diff.diff}`))
    step('git', 'done', String(changed.size))
  } else {
    notes.push(msg('note.not_git'))
    step('git', 'skipped')
  }

  stopIfCancelled(signal)
  step('search', 'running')
  const weighted = weightedKeywords(options.prompt)
  const keywords = weighted.map((entry) => entry.word)
  const grepTargets = weighted.filter((entry) => entry.word.length >= 4).slice(0, 8)
  const grepWords = grepTargets.map((entry) => entry.word)
  const perWord = parts.isGit ? await Promise.all(grepWords.map((word) => gitGrepCount(root, word, signal))) : []
  stopIfCancelled(signal)
  const content = contentScores(perWord, files.length, grepTargets.map((entry) => entry.weight))
  const mentionsTests = /\btest|spec|kiểm thử/i.test(options.prompt)
  const scored = scoreFiles(files, weighted, content, changed, mentionsTests)
  const picked: { path: string; hits: number[]; why: Message }[] = scored
    .slice(0, RELEVANT_FILES[options.level])
    .map((entry) => ({ path: entry.path, hits: [], why: msg('why.keyword') }))

  step('search', 'done', String(picked.length))
  if (options.level === 'max' && !options.pickFiles) step('pick', 'skipped')
  if (options.level === 'max' && options.pickFiles) {
    step('pick', 'running')
    try {
      const shortlist = [...new Set([...scored.slice(0, 150).map((s) => s.path), ...files])].slice(0, 600)
      const chosen = await options.pickFiles(shortlist, options.prompt)
      for (const path of chosen.filter((p) => files.includes(p)).slice(0, 8)) {
        if (!picked.some((entry) => entry.path === path)) {
          picked.push({ path, hits: [], why: msg('why.ai') })
        }
      }
      step('pick', 'done', String(picked.length))
    } catch (error) {
      stopIfCancelled(signal)
      notes.push(msg('note.picker_skipped', { reason: messageOf(error) }))
      step('pick', 'skipped')
    }
  }

  // Line numbers of the keywords inside the chosen files, for focused snippets.
  stopIfCancelled(signal)
  const lines = parts.isGit ? await gitGrep(root, grepWords, picked.map((entry) => entry.path), undefined, signal) : new Map<string, number[]>()
  stopIfCancelled(signal)
  for (const entry of picked) entry.hits = lines.get(entry.path) ?? []

  const perFile = options.level === 'max' ? 1800 : 1400
  for (const entry of picked) {
    if (options.exclude.has(`file:${entry.path}`)) continue
    const text = await readText(root, entry.path)
    if (!text) continue
    out.push(item(`file:${entry.path}`, 'file', raw(entry.path), snippet(text, entry.hits, perFile), entry.why))
  }
  if (keywords.length > 0 && picked.length === 0) {
    notes.push(msg('note.no_files'))
  }
  return out
}

/** Keeps items in priority order until the budget; trims the one that crosses it. */
export function fitBudget(items: ContextItem[], budget: number): ContextItem[] {
  const priority: Record<string, number> = { workspace: 0, agent: 0, rules: 1, stack: 2, file: 3, git: 4, terminal: 5, tree: 6 }
  const sorted = [...items].sort((a, b) => (priority[a.kind] ?? 9) - (priority[b.kind] ?? 9))
  const out: ContextItem[] = []
  let used = 0
  for (const entry of sorted) {
    if (used >= budget) {
      break
    }
    if (used + entry.chars <= budget) {
      out.push(entry)
      used += entry.chars
    } else if (budget - used > 400) {
      const content = `${entry.content.slice(0, budget - used)}\n…(trimmed to fit)`
      out.push({ ...entry, content, chars: content.length, note: english(msg('why.trimmed')), why: msg('why.trimmed') })
      used = budget
    }
  }
  return out
}
