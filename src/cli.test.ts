// The CLI provider with a stand-in CLI: a small Node script that reads stdin like `claude -p` does.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { cliArgs, runCli } from './cli.ts'
import * as main from './worker.ts'

const dir = mkdtempSync(join(tmpdir(), 'fake-cli-'))
const script = join(dir, 'fake.mjs').replace(/\\/g, '/')
writeFileSync(
  script,
  `let input = ''
process.stdin.on('data', (c) => (input += c))
process.stdin.on('end', () => {
  if (process.argv.includes('fail')) { console.error('Please log in first'); process.exit(1) }
  const request = /<request>\\n([\\s\\S]*?)\\n<\\/request>/.exec(input)?.[1] ?? '?'
  process.stdout.write('Rewritten: ' + request + (input.includes('<instructions>') ? ' [with instructions]' : ''))
})`
)
const node = process.execPath

test('runCli passes the prompt on stdin and reads stdout', async () => {
  const out = await runCli({ kind: 'custom-cli', command: node, model: '', customArgs: script }, 'SYSTEM', '<request>\nfix login\n</request>')
  assert.equal(out, 'Rewritten: fix login [with instructions]')
})

test('runCli reports a sign-in failure and a missing binary', async () => {
  await assert.rejects(
    runCli({ kind: 'custom-cli', command: node, model: '', customArgs: `${script} fail` }, 's', 'u'),
    /exited with 1: Please log in first \(run it once in a terminal to sign in\)/
  )
  await assert.rejects(runCli({ kind: 'claude-code', command: 'C:/nope/claude.exe', model: '', customArgs: '' }, 's', 'u'), /was not found/)
})

test('cliArgs: fixed flags, model validated, custom tokens filtered', () => {
  const claude = cliArgs('claude-code', 'haiku', '/tmp/o', '')
  assert.deepEqual(claude.slice(0, 3), ['-p', '--output-format', 'text'])
  assert.ok(claude.includes('--tools') && claude.at(-1) === 'haiku')
  assert.ok(!cliArgs('claude-code', 'x; rm -rf /', '/tmp/o', '').includes('--model'))
  const codex = cliArgs('codex', 'gpt-5', '/tmp/o', '')
  assert.deepEqual(codex.slice(0, 2), ['exec', '--skip-git-repo-check'])
  assert.ok(codex.includes('read-only') && codex.at(-1) === '-')
  assert.deepEqual(cliArgs('custom-cli', '', '', 'run --quiet $(evil) "x"'), ['run', '--quiet'])
})

test('a CLI profile works in the chain, needs no key, and is skipped by the hook', async () => {
  const cli = { id: 'sub', name: 'Sub', preset: 'custom-cli', provider: 'cli', baseUrl: '', model: '', temperature: 0.3, maxTokens: 2000, enabled: true, command: node, args: script }
  const host = mockHost({
    storage: { models: { profiles: [cli] } },
    settings: { autoEnhanceMode: 'ai' },
    results: { 'workspace.readContext': null, 'agents.list': { agents: [] } }
  })
  const worker = await mountWorker(main, { host })
  const view = await worker.request('models.get')
  assert.equal(view.profiles[0].keySource, 'subscription')
  const answer = await worker.request('prompt.enhance', { prompt: 'add dark mode', level: 'off' })
  assert.equal(answer.enhanced, 'Rewritten: add dark mode [with instructions]')
  const event = { agent: 'claude', terminalId: 't1', prompt: 'add a login page', inputKind: 'launch' as const }
  assert.deepEqual(await worker.hooks.fire('agent.prompt.before', event), { kind: 'continue', event })
  await worker.deactivate()
})

test('"CLI default" (model \'\') passes no model flag for every CLI preset; an API profile falls back to its preset', async () => {
  const { effectiveModel } = await import('./models.ts')
  const { PRESETS } = await import('./presets.ts')
  for (const preset of PRESETS.filter((entry) => entry.provider === 'cli')) {
    const profile = { id: 'p', name: 'p', preset: preset.id, provider: 'cli' as const, baseUrl: '', model: '', temperature: 0.3, maxTokens: 2000, enabled: true, command: '', args: '' }
    assert.equal(effectiveModel(profile), '', preset.id)
    const args = cliArgs(preset.id as 'claude-code', effectiveModel(profile), '/tmp/o', '')
    assert.ok(!args.includes('--model') && !args.includes('-m'), `${preset.id}: ${args.join(' ')}`)
    assert.equal(effectiveModel({ ...profile, model: 'sonnet' }), 'sonnet')
  }
  const api = { id: 'a', name: 'a', preset: 'openai', provider: 'openai' as const, baseUrl: '', model: '', temperature: 0.3, maxTokens: 2000, enabled: true, command: '', args: '' }
  assert.equal(effectiveModel(api), 'gpt-4.1-mini')
})

test('a Claude Code profile on "CLI default" runs claude without --model', async () => {
  const fake = join(dir, process.platform === 'win32' ? 'claude.cmd' : 'claude')
  writeFileSync(fake, process.platform === 'win32' ? '@echo off\r\necho ARGS %*\r\n' : '#!/bin/sh\necho ARGS "$@"\n', { mode: 0o755 })
  const profile = { id: 'cc', name: 'Claude Code', preset: 'claude-code', provider: 'cli', baseUrl: '', model: '', temperature: 0.3, maxTokens: 2000, enabled: true, command: fake, args: '' }
  const host = mockHost({ storage: { models: { profiles: [profile] } }, results: { 'workspace.readContext': null, 'agents.list': { agents: [] } } })
  const worker = await mountWorker(main, { host })
  const view = await worker.request('models.get')
  assert.equal(view.profiles[0].model, '')
  assert.equal(view.profiles[0].effectiveModel, '')
  const answer = await worker.request('prompt.enhance', { prompt: 'add dark mode', level: 'off' })
  assert.match(answer.enhanced, /^ARGS -p/)
  assert.ok(!/--model/.test(answer.enhanced), answer.enhanced)
  await worker.deactivate()
})
