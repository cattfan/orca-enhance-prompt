// Dev-server bridge: lets the web panel in a normal browser (npm run dev) talk to the real worker of
// the development plugin (`orca plugin dev load .` → local.enhance-prompt) through Orca's CLI,
// `orca plugin dev request`. Only the dev server uses it; nothing here ships in the panel.
import { execFile } from 'node:child_process'
import type { Plugin } from 'vite'

const PLUGIN_KEY = 'local.enhance-prompt'

type Answer = { ok: true; result: unknown } | { ok: false; code: string; message: string }

function orca(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('orca', args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error && !stdout.trim()) reject(new Error(stderr.split('\n').find((line) => line.trim() && !line.includes('crashpad')) ?? error.message))
      else resolve(stdout)
    })
  })
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** `{ ok, result: { result } }` on success; `{ ok: false, error: { message, data: { requestCode } } }` on failure. */
async function request(name: string, input: unknown, timeoutMs: number): Promise<Answer> {
  const args = ['plugin', 'dev', 'request', PLUGIN_KEY, name, '--json', '--timeout-ms', String(timeoutMs)]
  if (input !== undefined && input !== null) args.push('--data', JSON.stringify(input))
  const out = await orca(args, timeoutMs + 15_000)
  const parsed = parseJson(out.slice(Math.max(0, out.indexOf('{'))))
  if (!parsed) return { ok: false, code: 'unavailable', message: out.trim().slice(0, 300) || 'No answer from Orca' }
  const result = parsed.result as Record<string, unknown> | undefined
  if (parsed.ok === true && result && 'result' in result) return { ok: true, result: result.result }
  const error = (parsed.error ?? {}) as { code?: string; message?: string; data?: { requestCode?: string } }
  // "local.enhance-prompt answered X with <code>: <the worker's message>" → the worker's message.
  const message = (error.message ?? 'Request failed').replace(/^.*? answered \S+ with [\w-]+: /, '')
  return { ok: false, code: error.data?.requestCode ?? error.code ?? 'failed', message }
}

export function orcaBridge(): Plugin {
  return {
    name: 'orca-bridge',
    apply: 'serve',
    // ?fresh: start from empty saved panel state (pictures taken one after another share a browser profile).
    transformIndexHtml: () => [{ tag: 'script', children: "if (new URLSearchParams(location.search).has('fresh')) localStorage.clear()", injectTo: 'head-prepend' }],
    configureServer(server) {
      server.middlewares.use('/__orca/status', (_req, res) => {
        orca(['plugin', 'list'], 20_000)
          .then((out) => res.end(JSON.stringify({ live: out.includes(PLUGIN_KEY) })))
          .catch(() => res.end(JSON.stringify({ live: false })))
      })
      server.middlewares.use('/__orca/request', (req, res) => {
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          const call = parseJson(body || '{}')
          if (!call || typeof call.name !== 'string') {
            res.end(JSON.stringify({ ok: false, code: 'invalid_params', message: 'Bad request' }))
            return
          }
          request(call.name, call.input, Math.min(Number(call.timeoutMs) || 30_000, 120_000))
            .then((answer) => res.end(JSON.stringify(answer)))
            .catch((error: Error) => res.end(JSON.stringify({ ok: false, code: 'unavailable', message: error.message })))
        })
      })
    }
  }
}
