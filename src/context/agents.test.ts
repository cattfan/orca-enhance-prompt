// The other agents' sessions: secrets are masked, the newest output is kept, the target is left out.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import { agentsSummary, otherAgents, readSession, redactSecrets, SESSION_CHARS } from './agents.ts'
import { redactCode } from './secrets.ts'

// Fake credentials, built at run time so they never sit in the source as one string.
const AWS_ID = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('')

test('keys, tokens and passwords are masked; ordinary text stays', () => {
  const text = [
    'export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456',
    'token: ghp_abcdefghijklmnopqrstuvwxyz0123',
    '"password": "hunter2-very-secret"',
    `${AWS_ID} in the log`,
    'running pnpm test, 12 passed'
  ].join('\n')
  const out = redactSecrets(text)
  for (const secret of ['sk-abcdef', 'ghp_abcdef', 'hunter2', AWS_ID]) assert.ok(!out.includes(secret), out)
  assert.match(out, /OPENAI_API_KEY=\[redacted\]/)
  assert.match(out, /running pnpm test, 12 passed/)
})

test('in source code only what is certainly a secret is masked: the code keeps reading as code', () => {
  // Fake values, put together here so that none of them sits in the source as one string.
  const stripe = ['sk', 'live', 'abcdefghijklmnop1234'].join('_')
  const google = ['AIza', 'SyA1234567890abcdefghijklmnopqrstuv'].join('')
  const literal = ['hunter2', 'very', 'secret', '99'].join('-')
  const code = [
    'const token = getToken()',
    'type Login = { password: string; apiKey?: string }',
    "const tokenUrl = '/oauth/token'",
    'if (password.length < 12) throw new Error("password too short")',
    'max_tokens: 200000,',
    `const stripeKey = "${stripe}"`,
    `const maps = { key: '${google}' }`,
    `  client_secret: '${literal}',`,
    `+DB_PASSWORD="${literal}"`
  ].join('\n')
  const out = redactCode(code)
  for (const secret of [stripe, google, literal]) assert.ok(!out.includes(secret), out)
  // Every line that held no secret is exactly as it was.
  assert.deepEqual(out.split('\n').slice(0, 5), code.split('\n').slice(0, 5))
  // Where a value went, the name and the quotes stay: it still parses as the code it was.
  assert.match(out, /client_secret: '\[redacted\]',/)
  assert.match(out, /\+DB_PASSWORD="\[redacted\]"/)
  // What was printed is masked more broadly, by the name alone.
  assert.match(redactSecrets('const token = getToken()'), /token = \[redacted\]/)
  // The newer key formats are known in both.
  for (const secret of [stripe, google]) assert.ok(!redactSecrets(`saw ${secret} in the log`).includes(secret))
})

test('other agents: busiest first, without the target or agents with no terminal; a long session keeps its end', async () => {
  const host = mockHost({
    results: {
      'agents.list': {
        agents: [
          { terminalId: 'done', title: 'Old', agent: 'codex', state: 'done', stateStartedAt: 1 },
          { terminalId: 'target', title: 'Me', agent: 'claude', state: 'working', stateStartedAt: 2 },
          { terminalId: 'busy', title: 'Busy', agent: 'claude', state: 'working', stateStartedAt: 3 },
          { terminalId: null, title: 'None', agent: null, state: 'working', stateStartedAt: 4 }
        ]
      },
      'terminal.read': { lines: Array.from({ length: 80 }, (_, index) => `line ${index} ${'x'.repeat(60)}`), truncated: true }
    }
  })
  let captured: OrcaWorkerApi | null = null
  const worker = await mountWorker({ default: (api: OrcaWorkerApi) => void (captured = api) }, { host })
  const orca = captured as unknown as OrcaWorkerApi
  const agents = await otherAgents(orca, 'target')
  assert.deepEqual(agents.map((entry) => entry.terminalId), ['busy', 'done'])
  assert.match(agentsSummary(agents, 63_000), /claude · Busy · working for 1 min/)
  const session = await readSession(orca, 'busy')
  assert.ok(session.length <= SESSION_CHARS + 2)
  assert.match(session, /line 79/)
  await worker.deactivate()
})
