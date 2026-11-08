// Cancel really stops gathering context: running git commands are killed, later steps never run,
// and a half-read project is not cached.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { after } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from '../worker.ts'
import { git } from './git.ts'
import { gatherContext } from './index.ts'

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

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'cancel-ctx-'))
  tempDirs.push(root)
  writeFileSync(join(root, 'AGENTS.md'), '# Rules\nRun the tests.')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'session.ts'), 'export function validateSession() {}\n')
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: root })
  return root
}

async function orcaFor(root: string) {
  let orca: Parameters<typeof main.default>[0] | null = null
  const host = mockHost({
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'demo', terminals: [] },
      'workspace.list': { workspaces: [{ id: 'w', kind: 'folder', name: 'demo', path: root, branch: 'main', hostId: null }], truncated: false },
      'agents.list': { agents: [] }
    }
  })
  const worker = await mountWorker({ default: (api: Parameters<typeof main.default>[0]) => { orca = api } }, { host })
  return { orca: orca!, worker }
}

test('a cancelled git command is stopped at once and gives nothing', async () => {
  const root = repo()
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 300)
  const started = Date.now()
  // hash-object --stdin waits for input that never comes: only the cancel ends it.
  const out = await git(root, ['hash-object', '--stdin'], { timeoutMs: 20_000, signal: controller.signal })
  assert.equal(out, null)
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`)
  assert.equal(await git(root, ['status'], { signal: AbortSignal.abort() }), null)
})

test('cancel during the git step: the gather stops there, later steps never start', async () => {
  const root = repo()
  const { orca, worker } = await orcaFor(root)
  const controller = new AbortController()
  const seen: string[] = []
  await assert.rejects(
    gatherContext(orca, {
      level: 'deep',
      prompt: 'fix validateSession',
      terminalLines: 0,
      exclude: new Set(),
      extraFiles: [],
      excludePatterns: '',
      signal: controller.signal,
      onStep: (key, status) => {
        seen.push(`${key}:${status}`)
        if (key === 'git' && status === 'running') controller.abort()
      }
    }),
    /Cancelled/
  )
  assert.ok(seen.includes('git:running'))
  assert.ok(!seen.some((entry) => entry.startsWith('search')), seen.join(' '))
  await worker.deactivate()
})

test('cancel while the project is read: nothing half-read is cached for the next run', async () => {
  const root = repo()
  const { orca, worker } = await orcaFor(root)
  const options = { level: 'standard' as const, prompt: 'x', terminalLines: 0, exclude: new Set<string>(), extraFiles: [], excludePatterns: '' }
  const controller = new AbortController()
  await assert.rejects(
    gatherContext(orca, {
      ...options,
      signal: controller.signal,
      onStep: (key, status) => {
        if (key === 'project' && status === 'running') controller.abort()
      }
    }),
    /Cancelled/
  )
  const full = await gatherContext(orca, options)
  assert.ok(full.items.some((item) => item.id === 'rules:AGENTS.md'), full.items.map((item) => item.id).join(','))
  assert.ok(full.items.some((item) => item.kind === 'tree'))
  await worker.deactivate()
})
