// File listing (git or a bounded walk), path filters, tree summaries and snippets.
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

const WALK_SKIP = new Set([
  '.git', 'node_modules', '.orca', 'dist', 'build', 'out', 'target', '.next', '.nuxt', '.venv', 'venv',
  '__pycache__', '.cache', 'coverage', 'vendor', '.idea', '.vscode', '.turbo', '.svelte-kit', 'Pods'
])

/** Paths that may hold secrets: never read, never listed for the model. */
export function isSensitive(path: string): boolean {
  const name = path.split('/').pop() ?? path
  return (
    /^\.env(\..*)?$/i.test(name) ||
    /\.(pem|key|p12|pfx|keystore|jks)$/i.test(name) ||
    /(^|[._-])(secret|secrets|credentials?)([._-]|$)/i.test(name) ||
    /^id_(rsa|ed25519|ecdsa)/.test(name)
  )
}

const BINARY = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tgz|7z|rar|jar|exe|dll|so|dylib|wasm|woff2?|ttf|otf|mp[34]|mov|avi|bin|dat|db|sqlite)$/i

export function isBinaryPath(path: string): boolean {
  return BINARY.test(path)
}

/** `*` matches within a segment, `**` across segments; a pattern without `/` matches any segment or the name. */
export function compilePatterns(lines: string): RegExp[] {
  return lines
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((pattern) => {
      const dirOnly = pattern.endsWith('/')
      const body = pattern.replace(/\/$/, '')
      const escaped = body
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\u0000/g, '.*')
      if (body.includes('/')) {
        return new RegExp(`^${escaped}${dirOnly ? '/' : '(/|$)'}`, 'i')
      }
      return new RegExp(`(^|/)${escaped}${dirOnly ? '/' : '(/|$)'}`, 'i')
    })
}

export function isExcluded(path: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path))
}

export async function walkFiles(root: string, maxFiles = 8000, maxDepth = 6, signal?: AbortSignal): Promise<string[]> {
  const out: string[] = []
  async function visit(dir: string, depth: number): Promise<void> {
    if (out.length >= maxFiles || depth > maxDepth || signal?.aborted) {
      return
    }
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) {
        return
      }
      if (entry.isDirectory()) {
        if (!WALK_SKIP.has(entry.name) && !entry.name.startsWith('.')) {
          await visit(join(dir, entry.name), depth + 1)
        }
      } else if (entry.isFile()) {
        out.push(relative(root, join(dir, entry.name)).split(sep).join('/'))
      }
    }
  }
  await visit(root, 0)
  return out
}

/** Directories (depth <= 2) with file counts, plus top-level files: a compact map of the repo. */
export function treeSummary(files: string[], maxLines = 70): string {
  const dirs = new Map<string, number>()
  const topFiles: string[] = []
  for (const file of files) {
    const parts = file.split('/')
    if (parts.length === 1) {
      topFiles.push(file)
      continue
    }
    dirs.set(`${parts[0]}/`, (dirs.get(`${parts[0]}/`) ?? 0) + 1)
    if (parts.length > 2) {
      const sub = `${parts[0]}/${parts[1]}/`
      dirs.set(sub, (dirs.get(sub) ?? 0) + 1)
    }
  }
  const lines = [...dirs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, count]) => `${dir.split('/').length > 2 ? '  ' : ''}${dir} (${count})`)
  const all = [...lines, ...topFiles.sort((a, b) => a.localeCompare(b))]
  return all.length > maxLines ? `${all.slice(0, maxLines).join('\n')}\n…(${all.length - maxLines} more)` : all.join('\n')
}

export async function readText(root: string, path: string, maxBytes = 200_000): Promise<string | null> {
  if (isSensitive(path) || isBinaryPath(path) || path.includes('..')) {
    return null
  }
  try {
    const full = join(root, path)
    const info = await stat(full)
    if (!info.isFile() || info.size > maxBytes) {
      return null
    }
    // A link is read as the file it leads to: one that leaves the workspace, or leads to a file
    // whose own name says it holds secrets (README.md -> .env), is not read.
    const actual = relative(await realpath(root), await realpath(full)).split(sep).join('/')
    if (actual.startsWith('..') || isAbsolute(actual) || isSensitive(actual)) {
      return null
    }
    const text = await readFile(full, 'utf8')
    return text.includes('\u0000') ? null : text
  } catch {
    return null
  }
}

/** Lines around each hit (or the head of the file), numbered, within `maxChars`. */
export function snippet(text: string, hits: number[], maxChars: number): string {
  const lines = text.split(/\r?\n/)
  const keep = new Set<number>()
  if (hits.length === 0) {
    for (let i = 0; i < Math.min(lines.length, 40); i++) keep.add(i)
  } else {
    for (const hit of hits.slice(0, 6)) {
      // `hit` is 1-based: keep 4 lines above it, the line itself and 2 below.
      for (let i = Math.max(0, hit - 5); i < Math.min(lines.length, hit + 2); i++) keep.add(i)
    }
  }
  const out: string[] = []
  let last = -2
  let size = 0
  for (const i of [...keep].sort((a, b) => a - b)) {
    const line = `${i + 1}: ${lines[i].slice(0, 240)}`
    if (size + line.length > maxChars) {
      out.push('…')
      break
    }
    if (i !== last + 1 && out.length > 0) {
      out.push('…')
    }
    out.push(line)
    size += line.length + 1
    last = i
  }
  return out.join('\n')
}
