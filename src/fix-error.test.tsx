// "Fix this error": the error is picked out of a terminal's output and becomes a bug-fix prompt.
import { afterEach, assert, mockHost, mount, mountWorker, test } from 'orca/testing'
import * as panel from './panel.tsx'
import { PRESETS, type ProfileView } from './presets.ts'
import { ERROR_MAX_CHARS, ERROR_MAX_LINES, extractError } from './terminal-error.ts'
import * as main from './worker.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const output = [
  '$ pnpm dev',
  '  VITE ready in 300 ms',
  ...Array.from({ length: 40 }, (_, index) => `  page reload src/app.tsx (${index})`),
  '$ pnpm test',
  ' RUN  v2.1.0',
  ' FAIL  src/auth/session.test.ts > validateSession > rejects an empty token',
  'AssertionError: expected true to be false',
  '    at src/auth/session.test.ts:12:20',
  ' Test Files  1 failed | 4 passed (5)',
  '$ '
]

test('extractError keeps the last error block with what led to it, not the noise before', () => {
  const { text, found } = extractError(output)
  assert.ok(found)
  assert.match(text, /FAIL {2}src\/auth\/session\.test\.ts/)
  assert.match(text, /AssertionError: expected true to be false/)
  assert.match(text, /\$ pnpm test/)
  assert.ok(!text.includes('page reload src/app.tsx (5)'), text)
  assert.ok(!text.endsWith('$'))
})

test('extractError without an error line keeps the last lines; huge output stays within the limits', () => {
  const quiet = extractError(Array.from({ length: 200 }, (_, index) => `line ${index}`))
  assert.equal(quiet.found, false)
  assert.match(quiet.text, /line 199$/)
  assert.ok(!quiet.text.includes('line 100\n'))
  const huge = extractError(Array.from({ length: 1000 }, (_, index) => `error ${index} ${'x'.repeat(300)}`))
  assert.ok(huge.text.length <= ERROR_MAX_CHARS + 2)
  assert.ok(huge.text.split('\n').length <= ERROR_MAX_LINES + 1)
  assert.deepEqual(extractError([]), { text: '', found: false })
  assert.deepEqual(extractError(['', '   ']), { text: '', found: false })
})

const gpt = { id: 'gpt', name: 'gpt', preset: 'openai', provider: 'openai', baseUrl: '', model: '', temperature: 0.3, maxTokens: 2000, enabled: true }
function hostWith(settings: Record<string, boolean | string> = {}) {
  return mockHost({
    settings,
    storage: { models: { profiles: [gpt] } },
    secrets: { 'apiKey.gpt': 'k' },
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'demo', terminals: [{ id: 'tests', title: 'Tests' }, { id: 'agent', title: 'Claude' }] },
      'agents.list': { agents: [] },
      'terminal.read': { lines: output, truncated: false }
    }
  })
}

test('the worker puts the error first in the context and asks for a bug-fix brief', async () => {
  const bodies: { messages: { role: string; content: string }[] }[] = []
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Fix validateSession' } }] }), { status: 200 })
  }) as typeof fetch
  const host = hostWith()
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('prompt.enhance', { prompt: 'fix it', style: 'bugfix', level: 'off', errorTerminalId: 'tests', runId: 'r1' })
  assert.equal(answer.context[0].id, 'error')
  assert.equal(answer.context[0].title?.code, 'label.error')
  const [system, user] = bodies[0].messages
  assert.match(system.content, /bug-fix brief/)
  assert.match(user.content, /<item kind="error" label="Error output: Tests">/)
  assert.match(user.content, /AssertionError: expected true to be false/)
  // The progress shows the error step first.
  const steps = worker.posts.filter((post) => post.event === 'enhance.progress').at(-1)?.payload as { steps: { key: string; status: string }[] }
  assert.equal(steps.steps[0].key, 'error')
  assert.equal(steps.steps[0].status, 'done')
  await worker.deactivate()
})

test('"Fix this error" obeys the terminal-output Privacy switch, and refuses an empty terminal', async () => {
  const off = await mountWorker(main, { host: hostWith({ allowTerminalRead: false }) })
  await assert.rejects(off.request('prompt.enhance', { prompt: 'fix', level: 'off', errorTerminalId: 'tests' }), /off in Privacy/)
  await off.deactivate()
  const host = hostWith()
  host.respond('terminal.read', { lines: [], truncated: false })
  const empty = await mountWorker(main, { host })
  await assert.rejects(empty.request('prompt.enhance', { prompt: 'fix', level: 'off', errorTerminalId: 'tests' }), /no output to fix/)
  await empty.deactivate()
})

test('the panel: the bug button opens Fix this error, which sends a bug-fix request for that terminal', async () => {
  const sent: Record<string, unknown>[] = []
  const profile: ProfileView = { ...gpt, provider: 'openai', command: '', args: '', effectiveBaseUrl: 'https://api.openai.com/v1', effectiveModel: 'gpt-4.1-mini', keySource: 'secret', envName: '' }
  const host = mockHost({
    requests: {
      'models.get': { profiles: [profile], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
      'targets.list': {
        targets: [
          { terminalId: 'agent', label: 'Claude · working', agent: 'claude' },
          { terminalId: 'tests', label: 'Tests', agent: null }
        ]
      },
      'models.detect': { found: [] },
      'models.catalog': { models: [], source: '', fetchedAt: 1 },
      'prompt.enhance': (input: unknown) => {
        sent.push(input as Record<string, unknown>)
        return { enhanced: 'Fix the failing session test', model: 'm', profileName: 'gpt', ms: 5, attempts: [], context: [], notes: [] }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ role: 'button', label: 'Fix an error from a terminal' })
  // The error terminal defaults to one that is not the agent.
  assert.equal(view.valueOf(view.find({ label: 'Error in' })!), 'tests')
  await view.press({ role: 'button', text: 'Fix this error' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].errorTerminalId, 'tests')
  assert.equal(sent[0].style, 'bugfix')
  assert.equal(sent[0].terminalId, 'agent')
  assert.match(String(sent[0].prompt), /Fix the error shown in the output of Tests/)
  assert.equal(view.valueOf(view.find({ label: 'Enhanced prompt' })!), 'Fix the failing session test')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
