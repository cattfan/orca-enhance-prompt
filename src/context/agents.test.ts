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

test('a secret is masked in the shapes source code gives it; names and addresses that only look like one stay', () => {
  const value = ['a1b2c3d4', 'e5f6g7h8'].join('')
  const google = `${['AIza', 'SyA1234567890abcdefghijklmnopqrstu'].join('')}-`
  const openai = ['sk', 'proj', 'Ab12Cd34Ef56Gh78Ij90'].join('-')
  const masked = [
    `const encryptionKey = "${value}"`,
    `private_key: "${value}"`,
    `accessKey = '${value}'`,
    `apiToken := "${value}"`,
    `'password' => '${value}',`,
    `app.config['SECRET_KEY'] = '${value}'`,
    `const apiKey: string = "${value}"`,
    `db_password: str = "${value}"`,
    `maps("${google}")`,
    `client = new Client("${openai}")`
  ]
  for (const line of masked) {
    const out = redactCode(line)
    assert.ok(!out.includes(value) && !out.includes(google) && !out.includes(openai), `not masked: ${line}`)
    assert.match(out, /\[redacted\]/)
  }
  // Ordinary code that starts like a key, or gives an address to such a name, is not touched.
  const kept = [
    'animation: sk-circleBounceDelay 1.2s infinite ease-in-out;',
    '  --rk-colors-accentColorForeground: #fff;',
    "import Card from './sk-skeleton-placeholder-card'",
    '.btn--pk-button-variant-2xl-rounded { color: red }',
    'const tokenUrl = "https://oauth2.googleapis.com/token"',
    'const keyboardLayout = "qwerty12345678"',
    'const monkey = "banana1234567890"'
  ]
  for (const line of kept) assert.equal(redactCode(line), line)
  // An address that carries a sign-in is a secret all the same.
  assert.ok(!redactCode(`const dbPasswordUrl = "postgres://admin:${value}@db.internal/app"`).includes(value))
  // A masked block keeps its line breaks, so the lines after it keep their numbers.
  const pem = ['-----BEGIN RSA PRIVATE KEY-----', 'MIIEow', 'IBAAKC', '-----END RSA PRIVATE KEY-----'].join('\n')
  const file = `line 1\n${pem}\nline 6`
  assert.equal(redactCode(file).split('\n').length, file.split('\n').length)
  assert.equal(redactCode(file).split('\n')[5], 'line 6')
})

test('a long text is masked before it is cut: a key at the cut is not shown in part', async () => {
  const { maskedStart } = await import('./git.ts')
  const token = ['npm', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_')
  const jwt = ['eyJ' + 'a'.repeat(200), 'b'.repeat(200), 'c'.repeat(200)].join('.')
  // An early value that masks to much less, so that the text after it moves up by hundreds of
  // characters; then a key. Wherever the key lies, also across a place where the text is cut,
  // no part of it is shown.
  const head = `+const session = "${jwt}"\n`
  const filler = '+const value = compute(input, options)\n'
  for (let at = head.length + 40; at < 3400; at += 23) {
    let text = head
    while (text.length < at) text += filler
    text = `${text.slice(0, at)}\n+publish("${token}")\n${filler.repeat(120)}`
    const out = maskedStart(text, 1000)
    assert.ok(out.length <= 1000)
    for (let length = 8; length <= token.length; length++) assert.ok(!out.includes(token.slice(0, length)), `key at ${at}: its first ${length} characters are shown`)
    assert.ok(!out.includes(jwt.slice(0, 40)))
  }
  // A pasted private key masks to almost nothing, so the text from far behind it moves up into
  // view: the line the first cut leaves unfinished is left out, not shown as it is.
  const pem = ['-----BEGIN RSA PRIVATE KEY-----', ...Array.from({ length: 40 }, () => 'M'.repeat(64)), '-----END RSA PRIVATE KEY-----'].join('\n')
  for (let at = 2940; at < 3010; at += 7) {
    let text = `+const pem = \`${pem}\`\n`
    while (text.length < at) text += filler
    text = `${text.slice(0, at)}\n+publish("${token}")\n${filler.repeat(120)}`
    const out = maskedStart(text, 1000)
    for (let length = 8; length <= token.length; length++) assert.ok(!out.includes(token.slice(0, length)), `key at ${at}, behind a masked block: its first ${length} characters are shown`)
    assert.ok(!out.includes('MMMMMMMM'))
  }
  // A short text is masked whole, and one very long line is cut at a blank, never inside a word.
  assert.equal(maskedStart(`+publish("${token}")`, 1000), '+publish("[redacted]")')
  const oneLine = `${'x '.repeat(600)}${token.slice(0, 20)}${'y'.repeat(3000)}`
  assert.ok(!maskedStart(oneLine, 1000).includes(token.slice(0, 8)))
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
