// Gathers project context for the rewriter: focused workspace, its instruction files, and the
// target terminal's recent output. Every part is optional and fails soft.
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import type { PromptContext } from './prompts'

const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'README.md']
const MAX_FILE_CHARS = 3000
const MAX_TOTAL_CHARS = 7000
const MAX_TOP_LEVEL = 60
const SKIP_DIRS = new Set(['.git', 'node_modules', '.orca', '.DS_Store'])

type Workspace = {
  id: string
  name: string
  path: string
  branch: string | null
  hostId: string | null
}

export type ContextOptions = {
  includeWorkspace: boolean
  includeProjectFiles: boolean
  terminalLines: number
  terminalId?: string | null
}

async function readContext(orca: OrcaWorkerApi) {
  try {
    return await orca.host.call('workspace.readContext', {})
  } catch {
    return null
  }
}

/** The focused workspace's entry in workspace.list, matched by name and branch. */
export async function findFocusedWorkspace(
  orca: OrcaWorkerApi,
  focused: { displayName: string; branch: string }
): Promise<Workspace | null> {
  if (!orca.host.has('workspace.list')) {
    return null
  }
  try {
    const { workspaces } = await orca.host.call('workspace.list', {})
    const local = workspaces.filter((ws) => ws.hostId === null)
    const exact = local.filter((ws) => ws.name === focused.displayName && (ws.branch ?? '') === focused.branch)
    if (exact.length === 1) {
      return exact[0]
    }
    const byBranch = focused.branch ? local.filter((ws) => ws.branch === focused.branch) : []
    if (byBranch.length === 1) {
      return byBranch[0]
    }
    const byName = local.filter((ws) => ws.name === focused.displayName)
    return byName.length === 1 ? byName[0] : null
  } catch {
    return null
  }
}

export async function readProjectFiles(root: string): Promise<{
  files: { name: string; content: string }[]
  topLevel: string[]
}> {
  const files: { name: string; content: string }[] = []
  let total = 0
  for (const name of INSTRUCTION_FILES) {
    if (total >= MAX_TOTAL_CHARS) {
      break
    }
    try {
      const path = join(root, name)
      const info = await stat(path)
      if (!info.isFile()) {
        continue
      }
      const raw = await readFile(path, 'utf8')
      const budget = Math.min(MAX_FILE_CHARS, MAX_TOTAL_CHARS - total)
      const content = raw.length > budget ? `${raw.slice(0, budget)}\n…(truncated)` : raw
      total += content.length
      files.push({ name, content })
    } catch {
      // missing or unreadable
    }
  }
  let topLevel: string[] = []
  try {
    const entries = await readdir(root, { withFileTypes: true })
    topLevel = entries
      .filter((entry) => !SKIP_DIRS.has(entry.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, MAX_TOP_LEVEL)
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
  } catch {
    // not reachable
  }
  return { files, topLevel }
}

export async function gatherContext(
  orca: OrcaWorkerApi,
  options: ContextOptions
): Promise<PromptContext> {
  const context: PromptContext = {}
  const needsWorkspace = options.includeWorkspace || options.includeProjectFiles
  const focused = needsWorkspace ? await readContext(orca) : null

  if (focused && options.includeWorkspace) {
    context.workspace = { name: focused.displayName, branch: focused.branch }
  }
  if (focused && options.includeProjectFiles) {
    const workspace = await findFocusedWorkspace(orca, focused)
    if (workspace) {
      const project = await readProjectFiles(workspace.path)
      context.projectFiles = project.files
      context.topLevel = project.topLevel
    }
  }

  if (options.terminalId) {
    try {
      const { agents } = await orca.host.call('agents.list', {})
      context.agent = agents.find((agent) => agent.terminalId === options.terminalId)?.agent ?? null
    } catch {
      // agent:read missing or no workspace
    }
    if (options.terminalLines > 0) {
      try {
        const { lines } = await orca.host.call('terminal.read', {
          terminalId: options.terminalId,
          maxLines: options.terminalLines
        })
        const label =
          focused?.terminals.find((terminal) => terminal.id === options.terminalId)?.title ??
          options.terminalId
        context.terminal = { label, lines: lines.map((line) => line.trimEnd()).filter(Boolean) }
      } catch {
        // terminal gone
      }
    }
  }
  return context
}
