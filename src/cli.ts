// Runs an installed agent CLI in one-shot mode, so the rewrite uses the person's own subscription
// (Claude Pro/Max via Claude Code, ChatGPT via Codex, Google via Gemini CLI) instead of an API key.
// Arguments are fixed tokens (plus a validated model name); the prompt always goes over stdin.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { LlmError } from './llm'

export type CliKind = 'claude-code' | 'codex' | 'gemini-cli' | 'custom-cli'

export const CLI_BINARIES: Record<Exclude<CliKind, 'custom-cli'>, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  'gemini-cli': 'gemini'
}

const SAFE_TOKEN = /^[\w.:/=@+,-]{1,200}$/

/** Directories GUI apps often miss from PATH. */
function extraDirs(): string[] {
  const home = homedir()
  const dirs = [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ]
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    const roaming = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    dirs.push(join(roaming, 'npm'), join(local, 'Programs', 'OpenAI', 'Codex', 'bin'), join(local, 'pnpm'))
  }
  return dirs
}

/** Finds an executable by name (or checks an explicit path), PATH first. */
export function resolveBinary(nameOrPath: string): string | null {
  if (/[/\\]/.test(nameOrPath)) {
    return existsSync(nameOrPath) ? nameOrPath : null
  }
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  const dirs = [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...extraDirs()]
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = join(dir, nameOrPath + ext)
      if (existsSync(full)) return full
    }
  }
  return null
}

export function detectClis(): { kind: Exclude<CliKind, 'custom-cli'>; path: string }[] {
  const out: { kind: Exclude<CliKind, 'custom-cli'>; path: string }[] = []
  for (const [kind, name] of Object.entries(CLI_BINARIES) as [Exclude<CliKind, 'custom-cli'>, string][]) {
    const path = resolveBinary(name)
    if (path) out.push({ kind, path })
  }
  return out
}

const INSTRUCTION = 'Follow the instructions in the input exactly and output only the final prompt.'

/** The arguments for each CLI; `outFile` is where Codex writes its last message. */
export function cliArgs(kind: CliKind, model: string, outFile: string, customArgs: string): string[] {
  const m = model && SAFE_TOKEN.test(model) ? model : ''
  switch (kind) {
    case 'claude-code':
      return [
        '-p',
        '--output-format', 'text',
        '--tools', '',
        '--no-session-persistence',
        '--setting-sources', '',
        '--system-prompt', INSTRUCTION,
        ...(m ? ['--model', m] : [])
      ]
    case 'codex':
      return [
        'exec',
        '--skip-git-repo-check',
        '--ephemeral',
        '--sandbox', 'read-only',
        '--ignore-rules',
        '--color', 'never',
        '-o', outFile,
        ...(m ? ['-m', m] : []),
        '-'
      ]
    case 'gemini-cli':
      return ['-p', INSTRUCTION, ...(m ? ['-m', m] : [])]
    case 'custom-cli':
      return customArgs.split(/\s+/).filter(Boolean).filter((token) => SAFE_TOKEN.test(token))
  }
}

/** cmd.exe quoting for fixed tokens; refuses anything cmd would interpret. */
function cmdQuote(arg: string): string {
  if (/["%^&|<>!\r\n]/.test(arg)) throw new LlmError('Unsafe argument for a .cmd launcher.', 'invalid_params')
  return arg === '' || /\s/.test(arg) ? `"${arg}"` : arg
}

export async function runCli(
  options: { kind: CliKind; command: string; model: string; customArgs: string },
  system: string,
  user: string,
  signal?: AbortSignal
): Promise<string> {
  const binary = resolveBinary(options.command || (options.kind === 'custom-cli' ? '' : CLI_BINARIES[options.kind]))
  if (!binary) {
    throw new LlmError(
      `${options.command || options.kind} was not found. Install it and sign in, or set its full path in the model.`,
      'unavailable'
    )
  }
  // A neutral working directory: no project rules, hooks or files of its own get loaded.
  const cwd = await mkdtemp(join(tmpdir(), 'enhance-prompt-'))
  const outFile = join(cwd, 'last-message.txt')
  const args = cliArgs(options.kind, options.model, outFile, options.customArgs)
  const input = `<instructions>\n${system}\n</instructions>\n\n${user}`
  const isCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(binary)
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = isCmd
        ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${[cmdQuote(binary), ...args.map(cmdQuote)].join(' ')}"`], {
            cwd,
            windowsHide: true,
            windowsVerbatimArguments: true,
            stdio: ['pipe', 'pipe', 'pipe']
          })
        : spawn(binary, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        if (out.length < 2_000_000) out += chunk
      })
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        if (err.length < 20_000) err += chunk
      })
      const onAbort = () => child.kill()
      signal?.addEventListener('abort', onAbort)
      child.on('error', (error) => {
        signal?.removeEventListener('abort', onAbort)
        reject(new LlmError(`Could not start ${binary}: ${error.message}`, 'unavailable'))
      })
      child.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort)
        if (signal?.aborted) {
          reject(new LlmError('The request was cancelled or timed out.', 'timeout'))
        } else if (code === 0) {
          resolve(out)
        } else {
          const detail = (err || out).trim().split('\n').slice(-3).join(' ').slice(0, 300)
          const auth = /log ?in|auth|sign in|credential|unauthori[sz]ed|401/i.test(detail)
          reject(
            new LlmError(
              `${options.kind} exited with ${code}${detail ? `: ${detail}` : ''}${auth ? ' (run it once in a terminal to sign in)' : ''}`,
              /limit|quota|429|rate/i.test(detail) ? 'rate_limited' : 'action_failed'
            )
          )
        }
      })
      child.stdin.on('error', () => undefined)
      child.stdin.end(input)
    })
    const text = options.kind === 'codex' ? await readFile(outFile, 'utf8').catch(() => stdout) : stdout
    const clean = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    if (!clean) throw new LlmError(`${options.kind} returned an empty answer.`)
    return clean
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined)
  }
}
