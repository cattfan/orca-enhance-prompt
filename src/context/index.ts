// Builds the rewriter's project context at a chosen level, within a character budget.
//   off       nothing
//   basic     workspace name/branch, target agent
//   standard  + agent rule files, README digest, stack & commands, repo tree
//   deep      + git status/log/diff, files relevant to the prompt (paths, grep, snippets)
//   max       + AI-picked files from the tree, recent output of the agent terminal, and (Privacy
//             "Read other agents' sessions", off by default) the other agents and their sessions
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
import { agentsSummary, MAX_SESSIONS, otherAgents, readSession, SESSION_LINES } from './agents.ts'
import { redactCode, redactSecrets } from './secrets.ts'
import { agentActivity, savedFiles } from './activity.ts'
import { forgetTerminal, learnTerminal, loadTerminals, workspacesOfTerminals } from './terminals.ts'
import { namesWorkspace, workspaceTitle } from '../workspaces.ts'

export type ContextItem = ContextItemView & { content: string }

const LEVEL_RANK: Record<ContextLevel, number> = { off: 0, basic: 1, standard: 2, deep: 3, max: 4 }
const BUDGET: Record<ContextLevel, number> = { off: 0, basic: 1000, standard: 12_000, deep: 28_000, max: 45_000 }
const RELEVANT_FILES: Record<ContextLevel, number> = { off: 0, basic: 0, standard: 0, deep: 6, max: 10 }

export const atLeast = (level: ContextLevel, min: ContextLevel) => LEVEL_RANK[level] >= LEVEL_RANK[min]

/** A workspace as workspace.list answers it; `project` is its repository's name (host API 1.5). */
export type Workspace = { id: string; name: string; project?: string | null; path: string; branch: string | null; hostId: string | null }
/**
 * What workspace.readContext answers: a name, a branch and the terminals, and no path. The Orcas
 * this was written on give no id either; a newer one does (`workspaceId`, host API 1.9 documents it).
 */
export type Focused = { displayName: string; branch: string; terminals?: readonly { id: string }[]; workspaceId?: string }

/**
 * Whether a workspace's files are on this machine. Orca names this machine's host `local` (older
 * versions left it null); any other host is SSH or WSL, whose files the plugin cannot read.
 */
export const isLocalWorkspace = (workspace: { hostId: string | null }) => workspace.hostId === null || workspace.hostId === 'local'

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
  /** Max level: the other agents of the workspace and their recent sessions. Off unless true. */
  allowOtherAgents?: boolean
  /** How many other agents, and how many lines of each terminal (defaults: 4 and 80). */
  otherAgentsLimits?: { agents: number; lines: number }
  /** Deep and Max: what the agents did lately (tools and targets, how sessions ended). Off unless true. */
  allowAgentActivity?: boolean
  /** Deep and Max: the files saved lately in Orca's editor (ranked first in the code search). Off unless true. */
  allowEditorSaves?: boolean
  /** Progress: called when a step starts, finishes or is skipped. */
  onStep?: StepReporter
  /** Cancel: running git commands are stopped and the gather ends with a cancelled error. */
  signal?: AbortSignal
  /** Orca's id of the focused workspace, when the panel knows it (several may share a name). */
  workspaceId?: string | null
}

/** Ends a gather that was cancelled (between steps, and after any step a cancel cut short). */
function stopIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LlmError(msg('error.cancelled'), 'cancelled')
}

export type GatherResult = { items: ContextItem[]; notes: Message[]; root: string | null }

/** A context item made outside the gather (the text of an attached file); `why` says why it is as it is (trimmed). */
export function contextItem(id: string, kind: string, label: Message, content: string, why?: Message): ContextItem {
  return item(id, kind, label, content, why)
}

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

/**
 * The workspaces the focused one could be when several share its name and branch (several checkouts
 * on "main", say): the person picks one. Empty when it is clear.
 */
export async function focusedCandidates(orca: OrcaWorkerApi, focused: Focused): Promise<{ id: string; path: string; project?: string }[]> {
  if (!orca.host.has('workspace.list')) return []
  const list = await orca.host.call('workspace.list', {}).catch(() => null)
  const exact: Workspace[] = (list?.workspaces ?? []).filter((ws) => ws.name === focused.displayName && (ws.branch ?? '') === focused.branch && isLocalWorkspace(ws))
  return exact.length > 1 ? exact.map((ws) => ({ id: ws.id, path: ws.path, ...(ws.project ? { project: ws.project } : {}) })) : []
}

/**
 * The one listed workspace an id names that still fits the focus (its name or its branch), or null.
 * An id from an event names a workspace by its path, and a path can exist on two hosts: then the
 * one that fits both name and branch, and nothing when that is still more than one.
 */
function fittingWorkspace(workspaces: readonly Workspace[], id: string, focused: Focused): Workspace | null {
  const named = workspaces.filter((ws) => namesWorkspace(id, ws) && (ws.name === focused.displayName || (ws.branch ?? '') === focused.branch))
  if (named.length === 1) return named[0]
  const both = named.filter((ws) => ws.name === focused.displayName && (ws.branch ?? '') === focused.branch)
  return both.length === 1 ? both[0] : null
}

/**
 * The focused workspace's entry in workspace.list. Orca gives the focus only a name and a branch,
 * so it is found by its terminals first: Orca said which workspace each agent's terminal is in
 * (terminals.ts). Then by what the panel knows, then by name and branch when only one fits.
 */
export async function findFocusedWorkspace(
  orca: OrcaWorkerApi,
  focused: Focused,
  /** What the panel knows this workspace as: ids it noted from Orca's events, or the folder the person picked. */
  hint?: string | readonly string[] | null
): Promise<Workspace | null> {
  if (!orca.host.has('workspace.list')) return null
  try {
    const workspaces: Workspace[] = (await orca.host.call('workspace.list', {})).workspaces
    const terminals = (focused.terminals ?? []).map((terminal) => terminal.id)
    // What an earlier run of the worker kept is read once; a lookup right after a start waits for it.
    await loadTerminals(orca)
    // A newer Orca names the focused workspace itself: then there is nothing to work out. It must
    // still be a listed workspace that fits the focus, like every other id.
    if (typeof focused.workspaceId === 'string' && focused.workspaceId) {
      const named = fittingWorkspace(workspaces, focused.workspaceId, focused)
      if (named) {
        for (const terminal of terminals) learnTerminal(orca, terminal, focused.workspaceId)
        return named
      }
    }
    for (const id of workspacesOfTerminals(terminals)) {
      const said = fittingWorkspace(workspaces, id, focused)
      if (said) {
        // A terminal is in one workspace only: the others of this workspace are in it too.
        for (const terminal of terminals) learnTerminal(orca, terminal, id)
        return said
      }
    }
    // The panel's notes also hold the person's pick, which can be wrong: after what Orca said.
    for (const id of typeof hint === 'string' ? [hint] : (hint ?? [])) {
      const hinted = fittingWorkspace(workspaces, id, focused)
      if (hinted) return hinted
    }
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

/**
 * The workspace a terminal is in, when Orca said so (terminals.ts) and exactly one listed workspace
 * carries that id; null otherwise. For a prompt that goes to one terminal, which need not be in the
 * focused workspace.
 *
 * What was kept is what Orca said at some time, and it stays in storage across restarts. `focused`
 * (Orca's focus as it is now) is the one check there is: a terminal Orca lists in the focused
 * workspace is in that workspace, so a pairing that does not fit the focus is an old one (the id
 * went to a new terminal). It is dropped, and the answer is null: the caller takes the focus.
 */
export async function workspaceOfTerminal(orca: OrcaWorkerApi, terminalId: string, focused?: Focused | null): Promise<Workspace | null> {
  if (!terminalId || !orca.host.has('workspace.list')) return null
  await loadTerminals(orca)
  const ids = workspacesOfTerminals([terminalId])
  if (ids.length === 0) return null
  const list = await orca.host.call('workspace.list', {}).catch(() => null)
  const workspaces: Workspace[] = list?.workspaces ?? []
  const inFocus = focused?.terminals?.some((terminal) => terminal.id === terminalId) ?? false
  for (const id of ids) {
    if (focused && inFocus) {
      const fits = inFocusedWorkspace(workspaces, id, focused)
      // Dropped only on what a whole list said: a list that failed or was cut short proves nothing.
      if (!fits && list && !list.truncated) forgetTerminal(orca, terminalId)
      return fits
    }
    const named = workspaces.filter((ws) => namesWorkspace(id, ws))
    if (named.length === 1) return named[0]
  }
  return null
}

/**
 * The listed workspace an id names when that workspace can be the focused one: the very workspace
 * a newer Orca names as the focus, else one with the focus's name and its branch (both, unlike
 * `fittingWorkspace`: this decides whether a kept pairing is still true). Several projects can
 * share both ("main" on "main"); among those a pairing cannot be checked, and is taken as it is.
 */
function inFocusedWorkspace(workspaces: readonly Workspace[], id: string, focused: Focused): Workspace | null {
  const named = workspaces.filter((ws) => namesWorkspace(id, ws))
  const fits =
    typeof focused.workspaceId === 'string' && focused.workspaceId
      ? named.filter((ws) => namesWorkspace(focused.workspaceId!, ws))
      : named.filter((ws) => ws.name === focused.displayName && (ws.branch ?? '') === focused.branch)
  return fits.length === 1 ? fits[0] : null
}

/**
 * The name a project's rules are kept under (rules.ts): its repository's name in Orca, since the
 * workspace's own name is "main" for every project's first checkout. Null when Orca cannot tell
 * which of several workspaces of that name is open: a rule of one project is then followed in none
 * of them. Where Orca lists no workspaces (an older Orca), the workspace's name is all there is.
 */
export async function projectNameOf(orca: OrcaWorkerApi, focused: Focused, workspace: Workspace | null): Promise<string | null> {
  if (workspace) return workspace.project?.trim() || workspace.name
  if (!orca.host.has('workspace.list')) return focused.displayName
  const list = await orca.host.call('workspace.list', {}).catch(() => null)
  const alike = (list?.workspaces ?? []).filter((ws) => ws.name === focused.displayName && (ws.branch ?? '') === focused.branch)
  return alike.length > 1 ? null : focused.displayName
}

/** Where a run's rules apply: the focused workspace's name, and its project's. */
export async function focusedProject(orca: OrcaWorkerApi, hint?: string | readonly string[] | null): Promise<{ workspace: string | null; project: string | null }> {
  const focused = await orca.host.call('workspace.readContext', {}).catch(() => null)
  if (!focused) return { workspace: null, project: null }
  return { workspace: focused.displayName, project: await projectNameOf(orca, focused, await findFocusedWorkspace(orca, focused, hint)) }
}

// ---- prompt-independent parts, cached per workspace root (also what the hook uses) ----

type StaticParts = { at: number; files: string[]; isGit: boolean; items: ContextItem[] }
const staticCache = new Map<string, StaticParts>()
const STATIC_TTL_MS = 90_000

export function cachedStatic(root: string): StaticParts | null {
  const hit = staticCache.get(`git:${root}`) ?? staticCache.get(`nogit:${root}`)
  return hit && Date.now() - hit.at < STATIC_TTL_MS * 4 ? hit : null
}

export async function staticParts(
  root: string,
  extraFiles: string[],
  fresh = false,
  allowGit = true,
  signal?: AbortSignal,
  /** How far the read has got, 0-1 (progress bar). */
  onProgress: (fraction: number) => void = () => undefined
): Promise<StaticParts> {
  const cacheKey = `${allowGit ? 'git' : 'nogit'}:${root}`
  const hit = staticCache.get(cacheKey)
  if (hit && !fresh && Date.now() - hit.at < STATIC_TTL_MS) return hit
  const isGit = allowGit && (await isGitRepo(root, signal))
  onProgress(0.15)
  const listed = (isGit ? await gitFiles(root, signal) : null) ?? (await walkFiles(root, undefined, undefined, signal))
  // A cancelled read is incomplete: never cache it.
  stopIfCancelled(signal)
  onProgress(0.5)
  const files = listed.filter((file) => !isSensitive(file))
  const items: ContextItem[] = []
  for (const rule of await readRuleFiles(root, files, extraFiles, 9000)) {
    items.push(item(`rules:${rule.name}`, 'rules', raw(rule.name), rule.content))
  }
  onProgress(0.8)
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
  // Which of Orca's workspaces this is: its project's name for the label, its folder from Standard on.
  const workspace = focused ? await findFocusedWorkspace(orca, focused, options.workspaceId) : null
  const title = focused ? workspaceTitle(focused.displayName, workspace?.project) : undefined
  if (focused) {
    items.push(item('workspace', 'workspace', msg('label.workspace'), `${title}${focused.branch ? ` (branch ${focused.branch})` : ''}`))
  } else {
    notes.push(msg('note.no_workspace'))
  }
  if (options.terminalId) {
    const agents = await orca.host.call('agents.list', {}).catch(() => null)
    const agent = agents?.agents.find((entry) => entry.terminalId === options.terminalId)
    if (agent?.agent) items.push(item('agent', 'agent', msg('label.agent'), `${agent.agent} (${agent.state})`))
  }
  step('workspace', 'done', title)

  let root: string | null = null
  if (atLeast(level, 'standard')) step('project', 'running')
  if (focused && atLeast(level, 'standard')) {
    if (!workspace) {
      notes.push(msg('note.workspace_unknown'))
    } else if (!isLocalWorkspace(workspace)) {
      notes.push(msg('note.remote'))
    } else {
      root = workspace.path
    }
  }
  // Files saved lately in Orca's editor (paths inside this workspace, made relative to it).
  const saved =
    root && workspace && options.allowEditorSaves === true && atLeast(level, 'deep')
      ? savedFiles(workspace)
          .map((path) => relativeTo(root as string, path))
          .filter((path): path is string => path !== null && !isSensitive(path))
      : []

  if (root) {
    stopIfCancelled(signal)
    const parts = await staticParts(root, options.extraFiles, false, options.allowGit !== false, signal, (fraction) => step('project', 'running', undefined, fraction))
    items.push(...parts.items)
    step('project', 'done', String(parts.files.length))
    if (atLeast(level, 'deep')) {
      items.push(...(await dynamicParts(root, parts, options, notes, saved)))
      if (saved.length > 0 && !options.exclude.has('saved')) items.push(item('saved', 'saved', msg('label.saved'), saved.map((path) => `- ${path}`).join('\n')))
      const activity = workspace && options.allowAgentActivity === true && !options.exclude.has('activity') ? agentActivity(workspace) : ''
      if (activity) items.push(item('activity', 'activity', msg('label.activity'), activity))
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
      // What a terminal printed can hold a key or a password: masked like the other agents' sessions.
      items.push(item('terminal', 'terminal', msg('label.terminal', { name: title }), redactSecrets(lines.join('\n'))))
    }
    step('terminal', 'done', String(lines.length))
  }

  if (level === 'max' && options.allowOtherAgents === true) {
    items.push(...(await otherAgentItems(orca, options, step)))
  }

  stopIfCancelled(signal)
  return { items: fitBudget(items.filter((entry) => !options.exclude.has(entry.id)), BUDGET[level]), notes, root }
}

/** A path inside `root`, relative to it with forward slashes; null for a path outside it. */
export function relativeTo(root: string, path: string): string | null {
  const norm = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = norm(root)
  const full = norm(path)
  if (!/^([a-zA-Z]:)?\//.test(full)) return full.includes('..') ? null : full.replace(/^\.\//, '')
  const same = process.platform === 'win32' ? full.toLowerCase().startsWith(`${base.toLowerCase()}/`) : full.startsWith(`${base}/`)
  return same ? full.slice(base.length + 1) : null
}

async function dynamicParts(
  root: string,
  parts: StaticParts,
  options: GatherOptions,
  notes: Message[],
  /** Files the person saved lately: ranked like changed files. */
  saved: string[] = []
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
    // Status, log and diff are independent reads: run them side by side (a large repository spends
    // most of this step waiting on git). Status also ranks changed files, so it is read even unticked.
    const diffChars = options.level === 'max' ? 9000 : 5000
    // Each of the three reads that finishes is a third of the step.
    let finished = 0
    const counted = <T>(read: Promise<T> | T): Promise<T> =>
      Promise.resolve(read).then((value) => {
        finished++
        if (finished < 3) step('git', 'running', undefined, finished / 3)
        return value
      })
    const [status, log, diff] = await Promise.all([
      counted(gitStatus(root, signal)),
      counted(skip('git:log') ? null : gitLog(root, 6, signal)),
      counted(skip('git:diff') ? null : gitDiff(root, diffChars, (path) => !isExcluded(path, patterns), signal))
    ])
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
    if (status) changed = new Set([...changedPaths(status.changed), ...saved])
    if (log?.trim()) out.push(item('git:log', 'git', msg('label.log'), log.trim()))
    if (diff) out.push(item('git:diff', 'git', msg('label.diff'), `${diff.stat}\n\n${diff.diff}`))
    step('git', 'done', String(changed.size))
  } else {
    notes.push(msg('note.not_git'))
    step('git', 'skipped')
    changed = new Set(saved)
  }

  stopIfCancelled(signal)
  step('search', 'running')
  const weighted = weightedKeywords(options.prompt)
  const keywords = weighted.map((entry) => entry.word)
  const grepTargets = weighted.filter((entry) => entry.word.length >= 4).slice(0, 8)
  const grepWords = grepTargets.map((entry) => entry.word)
  // Each word searched is a share of the step; ranking the files is the last tenth.
  let searched = 0
  const perWord = parts.isGit
    ? await Promise.all(
        grepWords.map((word) =>
          gitGrepCount(root, word, signal).then((counts) => {
            searched++
            step('search', 'running', undefined, (searched / grepWords.length) * 0.9)
            return counts
          })
        )
      )
    : []
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
    // A key that sits in a source file is masked where it is certainly one; the code around it
    // stays. Before the lines are picked and cut to width: a key the cut would split is not
    // recognised (a masked value keeps its line breaks, so the line numbers still hold).
    out.push(item(`file:${entry.path}`, 'file', raw(entry.path), snippet(redactCode(text), entry.hits, perFile), entry.why))
  }
  if (keywords.length > 0 && picked.length === 0) {
    notes.push(msg('note.no_files'))
  }
  return out
}

/**
 * The other agents of the focused workspace (not the one the prompt goes to): one summary item, then
 * the newest output of each, as many as the person set (OTHER_AGENTS_LIMITS). An unticked item is not read; no other agent, or an
 * Orca without these calls, adds nothing and says nothing.
 */
async function otherAgentItems(orca: OrcaWorkerApi, options: GatherOptions, step: StepReporter): Promise<ContextItem[]> {
  const { signal } = options
  if (options.exclude.has('agents')) {
    step('agents', 'skipped')
    return []
  }
  step('agents', 'running')
  stopIfCancelled(signal)
  const limits = options.otherAgentsLimits ?? { agents: MAX_SESSIONS, lines: SESSION_LINES }
  const agents = (await otherAgents(orca, options.terminalId, signal)).slice(0, limits.agents)
  stopIfCancelled(signal)
  if (agents.length === 0) {
    step('agents', 'done', '0')
    return []
  }
  const out: ContextItem[] = [item('agents', 'agents', msg('label.agents'), agentsSummary(agents))]
  for (const [index, agent] of agents.entries()) {
    const id = `session:${agent.terminalId}`
    if (options.exclude.has(id)) continue
    const text = await readSession(orca, agent.terminalId, signal, limits.lines)
    stopIfCancelled(signal)
    step('agents', 'running', undefined, (index + 1) / agents.length)
    if (text) out.push(item(id, 'session', msg('label.session', { name: agent.title ?? agent.agent ?? agent.terminalId }), text))
  }
  step('agents', 'done', String(agents.length))
  return out
}

/** Keeps items in priority order until the budget; trims the one that crosses it. */
export function fitBudget(items: ContextItem[], budget: number): ContextItem[] {
  // Other agents come after everything else, so they never push out what a run used before them.
  const priority: Record<string, number> = { workspace: 0, agent: 0, rules: 1, stack: 2, file: 3, git: 4, terminal: 5, tree: 6, activity: 7, saved: 7, agents: 8, session: 9 }
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
