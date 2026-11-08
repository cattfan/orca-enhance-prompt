// Builds the rewriter's project context at a chosen level, within a character budget.
//   off       nothing
//   basic     workspace name/branch, target agent
//   standard  + agent rule files, README digest, stack & commands, repo tree
//   deep      + git status/log/diff, files relevant to the prompt (paths, grep, snippets)
//   max       + AI-picked files from the tree, recent output of the agent terminal
import type { OrcaWorkerApi } from 'orca/worker'
import type { ContextItemView, ContextLevel } from '../presets'
import { compilePatterns, isBinaryPath, isExcluded, isSensitive, readText, snippet, treeSummary, walkFiles } from './files'
import { changedPaths, gitDiff, gitFiles, gitGrep, gitGrepCount, gitLog, gitStatus, isGitRepo } from './git'
import { readRuleFiles } from './instructions'
import { contentScores, scoreFiles, weightedKeywords } from './relevance'
import { detectStack } from './stack'

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
}

export type GatherResult = { items: ContextItem[]; notes: string[]; root: string | null }

const item = (id: string, kind: string, label: string, content: string, note?: string): ContextItem => ({
  id,
  kind,
  label,
  content,
  chars: content.length,
  ...(note ? { note } : {})
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

export async function staticParts(root: string, extraFiles: string[], fresh = false, allowGit = true): Promise<StaticParts> {
  const cacheKey = `${allowGit ? 'git' : 'nogit'}:${root}`
  const hit = staticCache.get(cacheKey)
  if (hit && !fresh && Date.now() - hit.at < STATIC_TTL_MS) return hit
  const isGit = allowGit && (await isGitRepo(root))
  const listed = (isGit ? await gitFiles(root) : null) ?? (await walkFiles(root))
  const files = listed.filter((file) => !isSensitive(file))
  const items: ContextItem[] = []
  for (const rule of await readRuleFiles(root, files, extraFiles, 9000)) {
    items.push(item(`rules:${rule.name}`, 'rules', rule.name, rule.content))
  }
  const stack = await detectStack(root, files)
  if (stack) items.push(item('stack', 'stack', 'Stack & commands', stack))
  if (files.length > 0) items.push(item('tree', 'tree', `Repository tree (${files.length} files)`, treeSummary(files)))
  const parts = { at: Date.now(), files, isGit, items }
  staticCache.set(cacheKey, parts)
  return parts
}

// ---- the full gather ----

export async function gatherContext(orca: OrcaWorkerApi, options: GatherOptions): Promise<GatherResult> {
  const { level } = options
  const items: ContextItem[] = []
  const notes: string[] = []
  if (level === 'off') return { items, notes, root: null }

  const focused = await orca.host.call('workspace.readContext', {}).catch(() => null)
  if (focused) {
    items.push(item('workspace', 'workspace', 'Workspace', `${focused.displayName}${focused.branch ? ` (branch ${focused.branch})` : ''}`))
  } else {
    notes.push('No focused workspace.')
  }
  if (options.terminalId) {
    const agents = await orca.host.call('agents.list', {}).catch(() => null)
    const agent = agents?.agents.find((entry) => entry.terminalId === options.terminalId)
    if (agent?.agent) items.push(item('agent', 'agent', 'Target agent', `${agent.agent} (${agent.state})`))
  }

  let root: string | null = null
  if (focused && atLeast(level, 'standard')) {
    const workspace = await findFocusedWorkspace(orca, focused)
    if (!workspace) {
      notes.push('Could not tell which folder the workspace is in; project files skipped.')
    } else if (workspace.hostId !== null) {
      notes.push('Remote (SSH/WSL) workspace: project files are not readable from the plugin.')
    } else {
      root = workspace.path
    }
  }

  if (root) {
    const parts = await staticParts(root, options.extraFiles, false, options.allowGit !== false)
    items.push(...parts.items)
    if (atLeast(level, 'deep')) {
      items.push(...(await dynamicParts(root, parts, options, notes)))
    }
  }

  if (level === 'max' && options.allowTerminal === false) notes.push('Terminal output is off in Privacy.')
  if (level === 'max' && options.allowTerminal !== false && options.terminalId && options.terminalLines > 0) {
    const read = await orca.host
      .call('terminal.read', { terminalId: options.terminalId, maxLines: options.terminalLines })
      .catch(() => null)
    const lines = (read?.lines ?? []).map((line) => line.trimEnd()).filter(Boolean)
    if (lines.length > 0) {
      const title = focused?.terminals.find((t) => t.id === options.terminalId)?.title ?? 'agent terminal'
      items.push(item('terminal', 'terminal', `Recent output: ${title}`, lines.join('\n')))
    }
  }

  return { items: fitBudget(items.filter((entry) => !options.exclude.has(entry.id)), BUDGET[level]), notes, root }
}

async function dynamicParts(
  root: string,
  parts: StaticParts,
  options: GatherOptions,
  notes: string[]
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

  if (parts.isGit) {
    const status = await gitStatus(root)
    if (status && (status.changed.length > 0 || status.branchLine)) {
      changed = new Set(changedPaths(status.changed))
      const shown = status.changed.filter((line) => !isSensitive(changedPaths([line])[0] ?? ''))
      out.push(
        item(
          'git:status',
          'git',
          `Git status (${shown.length} changed)`,
          [status.branchLine && `## ${status.branchLine}`, ...shown.slice(0, 60)].filter(Boolean).join('\n')
        )
      )
    }
    const log = await gitLog(root, 6)
    if (log?.trim()) out.push(item('git:log', 'git', 'Recent commits', log.trim()))
    const diff = await gitDiff(root, options.level === 'max' ? 9000 : 5000)
    if (diff) out.push(item('git:diff', 'git', 'Uncommitted changes', `${diff.stat}\n\n${diff.diff}`))
  } else {
    notes.push('Not a git repository: no git context.')
  }

  const weighted = weightedKeywords(options.prompt)
  const keywords = weighted.map((entry) => entry.word)
  const grepTargets = weighted.filter((entry) => entry.word.length >= 4).slice(0, 8)
  const grepWords = grepTargets.map((entry) => entry.word)
  const perWord = parts.isGit ? await Promise.all(grepWords.map((word) => gitGrepCount(root, word))) : []
  const content = contentScores(perWord, files.length, grepTargets.map((entry) => entry.weight))
  const mentionsTests = /\btest|spec|kiểm thử/i.test(options.prompt)
  const scored = scoreFiles(files, weighted, content, changed, mentionsTests)
  const picked: { path: string; hits: number[]; why: string }[] = scored
    .slice(0, RELEVANT_FILES[options.level])
    .map((entry) => ({ path: entry.path, hits: [], why: 'keyword match' }))

  if (options.level === 'max' && options.pickFiles) {
    try {
      const shortlist = [...new Set([...scored.slice(0, 150).map((s) => s.path), ...files])].slice(0, 600)
      const chosen = await options.pickFiles(shortlist, options.prompt)
      for (const path of chosen.filter((p) => files.includes(p)).slice(0, 8)) {
        if (!picked.some((entry) => entry.path === path)) {
          picked.push({ path, hits: [], why: 'picked by AI' })
        }
      }
    } catch (error) {
      notes.push(`AI file picker skipped: ${(error as Error).message}`)
    }
  }

  // Line numbers of the keywords inside the chosen files, for focused snippets.
  const lines = parts.isGit ? await gitGrep(root, grepWords, picked.map((entry) => entry.path)) : new Map<string, number[]>()
  for (const entry of picked) entry.hits = lines.get(entry.path) ?? []

  const perFile = options.level === 'max' ? 1800 : 1400
  for (const entry of picked) {
    const text = await readText(root, entry.path)
    if (!text) continue
    out.push(item(`file:${entry.path}`, 'file', entry.path, snippet(text, entry.hits, perFile), entry.why))
  }
  if (keywords.length > 0 && picked.length === 0) {
    notes.push('No files matched the prompt; the agent will be told to locate them.')
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
      out.push({ ...entry, content, chars: content.length, note: 'trimmed' })
      used = budget
    }
  }
  return out
}
