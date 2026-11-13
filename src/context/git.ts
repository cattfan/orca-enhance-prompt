// Read-only git helpers. Fixed argument arrays, no shell; every call has a timeout and size cap.
import { execFile } from 'node:child_process'
import { killTree } from '../cli.ts'
import { isSensitive } from './files.ts'
import { redactCode } from './secrets.ts'

export function git(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal } = {}
): Promise<string | null> {
  const { signal } = options
  if (signal?.aborted) return Promise.resolve(null)
  return new Promise((resolve) => {
    // Cancel: stop git (and anything it started) at once, the same way a CLI model is stopped.
    const onAbort = () => {
      killTree(child)
      resolve(null)
    }
    const child = execFile(
      'git',
      // core.fsmonitor=false: a repository's own config cannot make a read run a program.
      ['-c', 'core.quotepath=off', '-c', 'color.ui=never', '-c', 'core.fsmonitor=false', ...args],
      {
        cwd,
        timeout: options.timeoutMs ?? 4000,
        maxBuffer: options.maxBytes ?? 2_000_000,
        windowsHide: true,
        encoding: 'utf8',
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
      },
      (error, stdout) => {
        signal?.removeEventListener('abort', onAbort)
        if (signal?.aborted) {
          resolve(null)
          return
        }
        // git grep exits 1 when nothing matched; a too-large output still has a useful prefix.
        if (error && !stdout) {
          resolve(null)
          return
        }
        resolve(stdout)
      }
    )
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function isGitRepo(root: string, signal?: AbortSignal): Promise<boolean> {
  return (await git(root, ['rev-parse', '--is-inside-work-tree'], { timeoutMs: 2000, signal }))?.trim() === 'true'
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

export async function gitStatus(root: string, signal?: AbortSignal): Promise<{ branchLine: string; changed: string[] } | null> {
  const out = await git(root, ['status', '--porcelain=v1', '-b', '--untracked-files=normal'], { signal })
  if (out === null) {
    return null
  }
  const lines = out.split('\n').filter(Boolean)
  const branchLine = lines[0]?.startsWith('##') ? lines.shift()!.slice(3) : ''
  return { branchLine, changed: lines }
}

/** Both names of a status line ("R  old -> new"), unquoted. */
export function statusLinePaths(line: string): string[] {
  return line
    .slice(3)
    .split(' -> ')
    .map((path) => path.replace(/^"|"$/g, ''))
    .filter(Boolean)
}

export function changedPaths(statusLines: string[]): string[] {
  return statusLines
    .map((line) => (line.slice(3).split(' -> ').pop() ?? '').replace(/^"|"$/g, ''))
    .filter(Boolean)
}

export async function gitLog(root: string, count: number, signal?: AbortSignal): Promise<string | null> {
  return git(root, ['log', `-n${count}`, '--no-merges', '--pretty=format:%h %s (%cr)'], { signal })
}

/** Most files a diff may leave out by name; past this the diff is skipped rather than risk a leak. */
const MAX_DIFF_EXCLUSIONS = 300

/**
 * Paths of every changed file (both sides of a rename or copy), from `git diff HEAD --name-status -z`.
 * Exported for tests.
 */
export function parseNameStatus(out: string): string[][] {
  const fields = out.split('\0').filter(Boolean)
  const entries: string[][] = []
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++]
    const sides = /^[RC]/.test(status) ? 2 : 1
    entries.push(fields.slice(index, index + sides))
    index += sides
  }
  return entries
}

/**
 * Uncommitted changes, without any file that may hold secrets (`isSensitive`) or that `allow` refuses
 * (the person's exclude patterns). A rename or copy is left out whole when either side is refused,
 * so renaming `secrets.json` to `data.json` does not show its content. In the files that are shown,
 * a value that is certainly a credential is masked (`redactCode`); the code around it stays.
 */
export async function gitDiff(
  root: string,
  maxChars: number,
  allow: (path: string) => boolean = () => true,
  signal?: AbortSignal
): Promise<{ stat: string; diff: string } | null> {
  const names = await git(root, ['diff', 'HEAD', '--name-status', '-z', '-M', '--', ...SAFE_PATHSPECS], { signal })
  if (names === null) return null
  const refused = new Set<string>()
  for (const paths of parseNameStatus(names)) {
    if (paths.some((path) => isSensitive(path) || !allow(path))) paths.forEach((path) => refused.add(path))
  }
  if (refused.size > MAX_DIFF_EXCLUSIONS) return null
  const pathspecs = [...SAFE_PATHSPECS, ...[...refused].map((path) => `:(exclude,literal)${path}`)]
  const stat = await git(root, ['diff', 'HEAD', '-M', '--stat=100', '--', ...pathspecs], { signal })
  if (stat === null || !stat.trim()) {
    return null
  }
  const diff = (await git(root, ['diff', 'HEAD', '-M', '-U2', '--no-ext-diff', '--', ...pathspecs], { maxBytes: 4_000_000, signal })) ?? ''
  // A key pasted into a source file is in the diff too: masked where it is certainly one.
  return { stat: stat.trim(), diff: diff.length > maxChars ? `${maskedStart(diff, maxChars)}\n…(diff truncated)` : redactCode(diff) }
}

/**
 * The first `maxChars` characters of a long text, masked. Only whole lines are masked: a key that
 * the cut would split is not recognised, and its first part must not be shown. So the text is cut
 * with some to spare, its unfinished last line is dropped, it is masked, and then cut to length;
 * what the second cut splits is text the masking has already been over. Exported for tests.
 */
export function maskedStart(text: string, maxChars: number): string {
  const spare = text.slice(0, maxChars + 2000)
  if (spare.length === text.length) return redactCode(text).slice(0, maxChars)
  // The last line of `spare` is unfinished. With a line break after `maxChars` it is simply left
  // out; in one very long line (minified code), the unfinished last word is.
  let end = spare.lastIndexOf('\n')
  if (end < maxChars) {
    end = spare.length
    while (end > 0 && !/\s/.test(spare[end - 1])) end--
  }
  return redactCode(spare.slice(0, end)).slice(0, maxChars)
}

export async function gitFiles(root: string, signal?: AbortSignal): Promise<string[] | null> {
  const out = await git(root, ['ls-files', '-co', '--exclude-standard'], { maxBytes: 16_000_000, timeoutMs: 6000, signal })
  return out === null ? null : out.split('\n').filter(Boolean).slice(0, 50_000)
}

/** Per file, how many lines contain `word` (case-insensitive, fixed string). */
export async function gitGrepCount(root: string, word: string, signal?: AbortSignal): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const out = await git(root, ['grep', '-c', '-I', '-i', '-F', '--untracked', '--exclude-standard', '-e', word, '--', ...SAFE_PATHSPECS], {
    maxBytes: 4_000_000,
    timeoutMs: 5000,
    signal
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
  maxLines = 600,
  signal?: AbortSignal
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
  const out = await git(root, args, { maxBytes: 3_000_000, timeoutMs: 5000, signal })
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
