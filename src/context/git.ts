// Read-only git helpers. Fixed argument arrays, no shell; every call has a timeout and size cap.
import { execFile } from 'node:child_process'

export function git(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', '-c', 'color.ui=never', ...args],
      {
        cwd,
        timeout: options.timeoutMs ?? 4000,
        maxBuffer: options.maxBytes ?? 2_000_000,
        windowsHide: true,
        encoding: 'utf8',
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
      },
      (error, stdout) => {
        // git grep exits 1 when nothing matched; a too-large output still has a useful prefix.
        if (error && !stdout) {
          resolve(null)
          return
        }
        resolve(stdout)
      }
    )
  })
}

export async function isGitRepo(root: string): Promise<boolean> {
  return (await git(root, ['rev-parse', '--is-inside-work-tree'], { timeoutMs: 2000 }))?.trim() === 'true'
}

/** Pathspecs that keep secrets and noise out of diffs and greps. */
export const SAFE_PATHSPECS = [
  '.',
  ':(exclude,glob)**/.env*',
  ':(exclude,glob)**/*.pem',
  ':(exclude,glob)**/*.key',
  ':(exclude,glob)**/*lock*',
  ':(exclude,glob)**/*.min.*',
  ':(exclude,glob)**/*.map'
]

export async function gitStatus(root: string): Promise<{ branchLine: string; changed: string[] } | null> {
  const out = await git(root, ['status', '--porcelain=v1', '-b', '--untracked-files=normal'])
  if (out === null) {
    return null
  }
  const lines = out.split('\n').filter(Boolean)
  const branchLine = lines[0]?.startsWith('##') ? lines.shift()!.slice(3) : ''
  return { branchLine, changed: lines }
}

export function changedPaths(statusLines: string[]): string[] {
  return statusLines
    .map((line) => line.slice(3).split(' -> ').pop()!.replace(/^"|"$/g, ''))
    .filter(Boolean)
}

export async function gitLog(root: string, count: number): Promise<string | null> {
  return git(root, ['log', `-n${count}`, '--no-merges', '--pretty=format:%h %s (%cr)'])
}

export async function gitDiff(root: string, maxChars: number): Promise<{ stat: string; diff: string } | null> {
  const stat = await git(root, ['diff', 'HEAD', '--stat=100', '--', ...SAFE_PATHSPECS])
  if (stat === null || !stat.trim()) {
    return null
  }
  const diff = (await git(root, ['diff', 'HEAD', '-U2', '--no-ext-diff', '--', ...SAFE_PATHSPECS], { maxBytes: 4_000_000 })) ?? ''
  return { stat: stat.trim(), diff: diff.length > maxChars ? `${diff.slice(0, maxChars)}\n…(diff truncated)` : diff }
}

export async function gitFiles(root: string): Promise<string[] | null> {
  const out = await git(root, ['ls-files', '-co', '--exclude-standard'], { maxBytes: 16_000_000, timeoutMs: 6000 })
  return out === null ? null : out.split('\n').filter(Boolean).slice(0, 50_000)
}

/** Per file, how many lines contain `word` (case-insensitive, fixed string). */
export async function gitGrepCount(root: string, word: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const out = await git(root, ['grep', '-c', '-I', '-i', '-F', '--untracked', '--exclude-standard', '-e', word, '--', ...SAFE_PATHSPECS], {
    maxBytes: 4_000_000,
    timeoutMs: 5000
  })
  for (const line of (out ?? '').split('\n')) {
    const match = /^(.+):(\d+)$/.exec(line)
    if (match) counts.set(match[1], Number(match[2]))
  }
  return counts
}

/** Line numbers in `paths` matching any keyword. */
export async function gitGrep(
  root: string,
  keywords: string[],
  paths: string[],
  maxLines = 600
): Promise<Map<string, number[]>> {
  const hits = new Map<string, number[]>()
  if (keywords.length === 0 || paths.length === 0) {
    return hits
  }
  const args = ['grep', '-n', '-I', '-i', '-F', '--untracked', '--exclude-standard']
  for (const word of keywords.slice(0, 12)) {
    args.push('-e', word)
  }
  args.push('--', ...paths.map((path) => `:(literal)${path}`))
  const out = await git(root, args, { maxBytes: 3_000_000, timeoutMs: 5000 })
  if (!out) {
    return hits
  }
  for (const line of out.split('\n').slice(0, maxLines * 4)) {
    const match = /^(.+?):(\d+):/.exec(line)
    if (!match) {
      continue
    }
    const list = hits.get(match[1]) ?? []
    if (list.length < 20) {
      list.push(Number(match[2]))
    }
    hits.set(match[1], list)
  }
  return hits
}
