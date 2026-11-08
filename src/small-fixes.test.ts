// Small fixes: non-JSON answers, `claude --help` memo, unticked context not read, git hardening, presets.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { claudeCatalog } from './catalog.ts'
import { gitStatus } from './context/git.ts'
import { complete, LlmError } from './llm.ts'
import { presetById } from './presets.ts'
import * as main from './worker.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
const dirs: string[] = []
const tempDir = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), name))
  dirs.push(dir)
  return dir
}
after(() => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch {
      // a just-killed process may still hold it (Windows): the OS temp cleaner gets it
    }
  }
})

const config = { provider: 'openai' as const, baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'k', temperature: 0.3, maxTokens: 100 }

test('a 200 answer that is an HTML page or empty is a clear, transient error', async () => {
  globalThis.fetch = (async () => new Response('<html><body><h1>Sign in to the Wi-Fi</h1></body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })) as typeof fetch
  const html = await complete(config, 's', 'u').catch((error: unknown) => error)
  assert.ok(html instanceof LlmError)
  assert.equal(html.code, 'unavailable')
  assert.match(html.message, /did not answer with JSON \(text\/html: "Sign in to the Wi-Fi"\)/)
  assert.ok(!/Unexpected token/.test(html.message))

  globalThis.fetch = (async () => new Response('', { status: 200 })) as typeof fetch
  const empty = await complete(config, 's', 'u').catch((error: unknown) => error)
  assert.ok(empty instanceof LlmError)
  assert.match(empty.message, /an empty answer/)
})

test('with fallback on transient errors only, an HTML answer moves on to the next model', async () => {
  globalThis.fetch = (async (url: RequestInfo | URL) =>
    String(url).includes('groq')
      ? new Response(JSON.stringify({ choices: [{ message: { content: 'from groq' } }] }), { status: 200 })
      : new Response('<html>portal</html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch
  const profile = (id: string, baseUrl: string) => ({ id, name: id, preset: 'openai', provider: 'openai', baseUrl, model: 'm', temperature: 0.3, maxTokens: 100, enabled: true })
  const worker = await mountWorker(main, {
    host: mockHost({
      storage: { models: { profiles: [profile('portal', 'https://api.openai.com/v1'), profile('groq', 'https://api.groq.com/openai/v1')] } },
      secrets: { 'apiKey.portal': 'k', 'apiKey.groq': 'k' },
      settings: { fallbackOn: 'transient' }
    })
  })
  const answer = await worker.request('prompt.enhance', { prompt: 'fix it', level: 'off' })
  assert.equal(answer.enhanced, 'from groq')
  assert.match(answer.attempts[0].error ?? '', /did not answer with JSON/)
  await worker.deactivate()
})

test('`claude --help` that fails once is asked again next time', async () => {
  const dir = tempDir('fake-claude-')
  const script = join(dir, 'help.mjs').replace(/\\/g, '/')
  const flag = join(dir, 'ran-once').replace(/\\/g, '/')
  writeFileSync(
    script,
    `import { existsSync, writeFileSync } from 'node:fs'
if (!existsSync(${JSON.stringify(flag)})) { writeFileSync(${JSON.stringify(flag)}, '1'); process.exit(1) }
process.stdout.write("Options:\\n  --model <model>  Model for the session. Provide an alias such as 'zetamodel' or 'sonnet'.\\n")
`
  )
  const command = join(dir, process.platform === 'win32' ? 'claude.cmd' : 'claude')
  writeFileSync(command, process.platform === 'win32' ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/bin/sh\n"${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 })
  const first = await claudeCatalog(command, false)
  assert.ok(!first.models.some((model) => model.id === 'zetamodel'))
  assert.ok(!first.source.includes('claude --help'))
  const second = await claudeCatalog(command, false)
  assert.ok(second.models.some((model) => model.id === 'zetamodel'), second.models.map((model) => model.id).join(','))
  assert.match(second.source, /claude --help/)
})

test('an unticked terminal output is not read at all', async () => {
  const host = mockHost({
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'demo', terminals: [{ id: 't1', title: 'Claude' }] },
      'agents.list': { agents: [] },
      'workspace.list': { workspaces: [], truncated: false },
      'terminal.read': { lines: ['secret output'], truncated: false }
    }
  })
  const worker = await mountWorker(main, { host })
  const shown = await worker.request('context.preview', { prompt: 'x', level: 'max', terminalId: 't1' })
  assert.ok(shown.context.some((item) => item.id === 'terminal'))
  assert.equal(host.callsOf('terminal.read').length, 1)
  const unticked = await worker.request('context.preview', { prompt: 'x', level: 'max', terminalId: 't1', exclude: ['terminal'] })
  assert.ok(!unticked.context.some((item) => item.id === 'terminal'))
  assert.equal(host.callsOf('terminal.read').length, 1)
  await worker.deactivate()
})

test("git reads never run a repository's fsmonitor program", async () => {
  const root = tempDir('fsmonitor-')
  const marker = join(root, 'ran.txt').replace(/\\/g, '/')
  const hook = join(root, 'monitor.sh').replace(/\\/g, '/')
  writeFileSync(hook, `#!/bin/sh\necho ran > "${marker}"\n`, { mode: 0o755 })
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['config', 'core.fsmonitor', hook], { cwd: root })
  writeFileSync(join(root, 'a.txt'), 'a')
  const status = await gitStatus(root)
  assert.ok(status)
  assert.ok(!existsSync(marker), 'the fsmonitor program ran')
})

test('an unknown preset id falls back to Custom', () => {
  assert.equal(presetById('no-such-preset').id, 'custom')
  assert.equal(presetById('openai').id, 'openai')
})
