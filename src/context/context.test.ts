import { assert, test } from 'orca/testing'
import { compilePatterns, isExcluded, isSensitive, snippet, treeSummary } from './files.ts'
import { fitBudget, type ContextItem } from './index.ts'
import { readmeDigest } from './instructions.ts'
import { extractKeywords, scoreFiles } from './relevance.ts'

test('extractKeywords keeps identifiers and paths, drops stop words (EN + VI)', () => {
  const words = extractKeywords('sửa lỗi validateSession trong `src/auth/session.ts` khi token rỗng, please fix the login page')
  assert.ok(words.includes('validatesession'), words.join(','))
  assert.ok(words.includes('src/auth/session.ts'))
  assert.ok(words.includes('session.ts'))
  assert.ok(words.includes('login'))
  assert.ok(!words.includes('the') && !words.includes('trong') && !words.includes('fix'))
})

test('scoreFiles ranks name matches, grep hits and changed files', () => {
  const files = ['src/auth/session.ts', 'src/auth/session.test.ts', 'src/ui/button.tsx', 'docs/session-notes.md', 'test-fixtures/session.ts']
  const grep = new Map([['src/ui/button.tsx', 3]])
  const ranked = scoreFiles(files, ['session'], grep, new Set(['docs/session-notes.md']), false)
  assert.equal(ranked[0].path, 'src/auth/session.ts')
  assert.ok(ranked.findIndex((r) => r.path === 'test-fixtures/session.ts') > ranked.findIndex((r) => r.path === 'src/auth/session.ts'))
  assert.ok(ranked.some((r) => r.path === 'src/ui/button.tsx'))
})

test('sensitive files and exclude patterns', () => {
  for (const path of ['.env', 'config/.env.local', 'certs/server.pem', 'aws-credentials.json', 'id_rsa']) assert.ok(isSensitive(path), path)
  assert.ok(!isSensitive('src/environment.ts'))
  const patterns = compilePatterns('dist/\n*.lock\nsrc/**/*.gen.ts\n# comment')
  assert.ok(isExcluded('dist/app.js', patterns))
  assert.ok(isExcluded('packages/a/dist/x.js', patterns))
  assert.ok(isExcluded('yarn.lock', patterns))
  assert.ok(isExcluded('src/api/types.gen.ts', patterns))
  assert.ok(!isExcluded('src/distance.ts', patterns))
})

test('readmeDigest keeps intro and setup/test sections', () => {
  const readme = '# App\nA tool.\n## Screenshots\nimg\n## Installation\nnpm i\n## License\nMIT\n## Running tests\nnpm test'
  const digest = readmeDigest(readme, 2000)
  assert.match(digest, /A tool/)
  assert.match(digest, /npm i/)
  assert.match(digest, /npm test/)
  assert.ok(!/MIT|Screenshots/.test(digest))
})

test('snippet numbers lines around hits', () => {
  const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n')
  const out = snippet(text, [25], 2000)
  assert.match(out, /^21: line 21/)
  assert.match(out, /27: line 27$/)
})

test('treeSummary and fitBudget', () => {
  const tree = treeSummary(['README.md', 'src/a.ts', 'src/lib/b.ts', 'src/lib/c.ts'])
  assert.match(tree, /src\/ \(3\)/)
  assert.match(tree, / {2}src\/lib\/ \(2\)/)
  const mk = (id: string, kind: string, size: number): ContextItem => ({ id, kind, label: id, content: 'x'.repeat(size), chars: size })
  const fitted = fitBudget([mk('tree', 'tree', 500), mk('rules', 'rules', 800), mk('file', 'file', 900)], 2150)
  assert.deepEqual(fitted.map((i) => i.id), ['rules', 'file', 'tree'])
  assert.equal(fitted[2].note, 'trimmed')
})

test('git diff leaves out secret files, renames of them and excluded paths', async () => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { gitDiff, parseNameStatus, statusLinePaths } = await import('./git.ts')
  const root = mkdtempSync(join(tmpdir(), 'diff-secrets-'))
  const run = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root })
  try {
    run('init', '-q')
    mkdirSync(join(root, 'config'))
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'dist'))
    const files: Record<string, string> = {
      'config/credentials.yml': 'token: OLD-CRED\n',
      'secrets.json': '{"key":"OLD-SECRET"}\n',
      'id_rsa': 'OLD-PRIVATE-KEY\n',
      'certs.p12': 'OLD-P12\n',
      'src/app.ts': 'export const a = 1\n',
      'dist/bundle.js': 'old bundle\n'
    }
    for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text)
    run('add', '-A')
    run('commit', '-q', '-m', 'init')
    writeFileSync(join(root, 'config/credentials.yml'), 'token: NEW-CRED\n')
    writeFileSync(join(root, 'certs.p12'), 'NEW-P12\n')
    writeFileSync(join(root, 'src/app.ts'), 'export const a = 2 // VISIBLE\n')
    writeFileSync(join(root, 'dist/bundle.js'), 'new bundle EXCLUDED\n')
    run('mv', 'secrets.json', 'data.json')
    unlinkSync(join(root, 'id_rsa'))
    run('add', '-A')

    const result = await gitDiff(root, 20_000, (path) => !path.startsWith('dist/'))
    assert.ok(result)
    const all = `${result.stat}\n${result.diff}`
    assert.match(all, /VISIBLE/)
    for (const secret of ['CRED', 'SECRET', 'PRIVATE-KEY', 'P12', 'EXCLUDED', 'data.json', 'credentials.yml', 'id_rsa']) {
      assert.ok(!all.includes(secret), `${secret} leaked:\n${all}`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  assert.deepEqual(parseNameStatus('M\0src/a.ts\0R100\0secrets.json\0data.json\0D\0id_rsa\0'), [['src/a.ts'], ['secrets.json', 'data.json'], ['id_rsa']])
  assert.deepEqual(statusLinePaths('R  secrets.json -> "data file.json"'), ['secrets.json', 'data file.json'])
})
