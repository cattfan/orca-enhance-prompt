// Paths that had no test: the hook's 2 s budget, Anthropic answers, Codex and Gemini model lists,
// and the clipboard tools.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { after } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { codexCatalog, geminiCatalog } from './catalog.ts'
import { clipboardTools, copyToClipboard } from './clipboard.ts'
import { complete } from './llm.ts'
import * as main from './worker.ts'

const realFetch = globalThis.fetch
const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
afterEach(() => {
  globalThis.fetch = realFetch
  for (const [key, value] of Object.entries(realHome)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})
const tempDirs: string[] = []
after(() => {
  for (const folder of tempDirs) {
    try {
      rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch {
      // a just-killed process may still hold it (Windows): the OS temp cleaner gets it
    }
  }
})
function tempDir(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(folder)
  return folder
}
/** A fake home folder, so the catalogs read our config files instead of the real ones. */
function fakeHome(): string {
  const home = tempDir('home-')
  process.env.HOME = home
  process.env.USERPROFILE = home
  return home
}
/** An executable that prints `output` whatever its arguments. */
function fakeCommand(name: string, output: string): string {
  const dir = tempDir('fake-bin-')
  const data = join(dir, 'out.txt')
  writeFileSync(data, output)
  const script = join(dir, 'print.mjs').replace(/\\/g, '/')
  writeFileSync(script, `import { readFileSync } from 'node:fs'\nprocess.stdout.write(readFileSync(${JSON.stringify(data.replace(/\\/g, '/'))}, 'utf8'))\n`)
  const command = join(dir, process.platform === 'win32' ? `${name}.cmd` : name)
  writeFileSync(command, process.platform === 'win32' ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/bin/sh\n"${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 })
  return command
}

test('auto-enhance (AI) past its 2 s budget sends the original prompt, in time', async () => {
  globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) =>
    new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch
  const profile = { id: 'slow', name: 'slow', preset: 'openai', provider: 'openai', baseUrl: '', model: '', maxTokens: 100, enabled: true }
  const worker = await mountWorker(main, {
    host: mockHost({ settings: { autoEnhanceMode: 'ai', autoEnhanceContext: false }, storage: { models: { profiles: [profile] } }, secrets: { 'apiKey.slow': 'k' } })
  })
  const event = { agent: 'claude', terminalId: 't1', prompt: 'add a login page', inputKind: 'launch' as const }
  const started = Date.now()
  assert.deepEqual(await worker.hooks.fire('agent.prompt.before', event), { kind: 'continue', event })
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`)
  assert.ok(worker.logs.some((line) => /auto-enhance skipped/.test(line)), worker.logs.join('\n'))
  await worker.deactivate()
})

test('Anthropic: the request goes to /v1/messages with its headers; text parts are joined, thinking dropped', async () => {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) })
    return new Response(
      JSON.stringify({ content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: '<think>plan</think>Fix the ' }, { type: 'text', text: 'login form.' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }) as typeof fetch
  const text = await complete(
    { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/', model: 'claude-haiku-4-5', apiKey: 'sk-ant', maxTokens: 500 },
    'SYSTEM',
    'USER'
  )
  assert.equal(text, 'Fix the login form.')
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages')
  assert.equal(calls[0].headers['x-api-key'], 'sk-ant')
  assert.equal(calls[0].headers['anthropic-version'], '2023-06-01')
  assert.equal(calls[0].body.system, 'SYSTEM')
  assert.deepEqual(calls[0].body.messages, [{ role: 'user', content: 'USER' }])
})

test('Codex model list: listed models by priority, the configured one marked or added', async () => {
  const home = fakeHome()
  mkdirSync(join(home, '.codex'))
  writeFileSync(join(home, '.codex', 'config.toml'), 'model = "gpt-5-codex"\n')
  const codex = fakeCommand(
    'codex',
    JSON.stringify({
      models: [
        { slug: 'gpt-5', display_name: 'GPT-5', visibility: 'list', priority: 2 },
        { slug: 'gpt-5-codex', display_name: 'GPT-5 Codex', description: 'For code', visibility: 'list', priority: 1 },
        { slug: 'internal', visibility: 'hide', priority: 0 },
        { display_name: 'no slug', visibility: 'list' }
      ]
    })
  )
  const catalog = await codexCatalog(codex)
  assert.deepEqual(catalog.models, [
    { id: 'gpt-5-codex', label: 'GPT-5 Codex', description: 'For code', isDefault: true },
    { id: 'gpt-5', label: 'GPT-5' }
  ])
  writeFileSync(join(home, '.codex', 'config.toml'), 'model = "my-own"\n')
  assert.deepEqual((await codexCatalog(codex)).models[0], { id: 'my-own', label: 'my-own', isDefault: true })
  const broken = await codexCatalog(fakeCommand('codex', 'not json'))
  assert.equal(broken.models.length, 0)
  assert.match(broken.error ?? '', /could not read/)
})

test('Gemini model list: built-in models plus the one in ~/.gemini/settings.json', async () => {
  const home = fakeHome()
  const plain = await geminiCatalog('', false)
  assert.ok(plain.models.length >= 3)
  assert.ok(plain.models.every((model) => !model.isDefault))
  mkdirSync(join(home, '.gemini'))
  writeFileSync(join(home, '.gemini', 'settings.json'), JSON.stringify({ model: { name: 'gemini-9-ultra' } }))
  const configured = await geminiCatalog('', false)
  assert.deepEqual(configured.models[0], { id: 'gemini-9-ultra', label: 'gemini-9-ultra', isDefault: true })
})

test('clipboard: the right tool per OS, UTF-16 with a BOM for clip.exe; no tool is a clear failure', async () => {
  const windows = clipboardTools('win32')
  assert.deepEqual(windows.map((tool) => tool.command), ['clip.exe'])
  const bytes = windows[0].encode('Sửa lỗi 修复')
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe])
  assert.equal(bytes.subarray(2).toString('utf16le'), 'Sửa lỗi 修复')
  assert.deepEqual(clipboardTools('darwin').map((tool) => tool.command), ['pbcopy'])
  const linux = clipboardTools('linux')
  assert.deepEqual(linux.map((tool) => tool.command), ['wl-copy', 'xclip', 'xsel'])
  assert.equal(linux[1].encode('Sửa').toString('utf8'), 'Sửa')
  if (process.platform === 'win32') {
    // None of the Linux tools exist here: every one is tried, then a clear failure (no throw).
    const result = await copyToClipboard('x', 'linux')
    assert.equal(result.copied, false)
    assert.ok(result.error)
  }
})

test('Gemini model list comes from `gemini models list` when the CLI can list, else the known models', async () => {
  fakeHome()
  const listing = JSON.stringify([
    { modelId: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', description: 'Fast' },
    { modelId: 'gemini-2.5-pro', name: 'gemini-2.5-pro' }
  ])
  const gemini = fakeCommand('gemini', `Loaded cached credentials.\n${listing}\n`)
  const listed = await geminiCatalog(gemini, true)
  assert.deepEqual(listed.models, [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (gemini-3.5-flash)', description: 'Fast' },
    { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' }
  ])
  assert.match(listed.source, /gemini models list/)
  // An older CLI without `models list`: the known models.
  const old = await geminiCatalog(fakeCommand('gemini', 'Unknown command: models'), true)
  assert.match(old.source, /built-in/)
  assert.ok(old.models.some((model) => model.id === 'gemini-2.5-pro'))
  // Online lists off in Privacy: the CLI is not even started.
  const dir = tempDir('gemini-off-')
  const marker = join(dir, 'ran').replace(/\\/g, '/')
  const script = join(dir, 'mark.mjs').replace(/\\/g, '/')
  writeFileSync(script, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, '1')\nprocess.stdout.write(${JSON.stringify(listing)})\n`)
  const command = join(dir, process.platform === 'win32' ? 'gemini.cmd' : 'gemini')
  writeFileSync(command, process.platform === 'win32' ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/bin/sh\n"${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 })
  const offline = await geminiCatalog(command, false)
  assert.match(offline.source, /built-in/)
  const { existsSync } = await import('node:fs')
  assert.ok(!existsSync(marker), 'gemini ran while online lists are off')
})
