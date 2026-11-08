import { assert, test } from 'orca/testing'
import { compilePatterns, isExcluded, isSensitive, snippet, treeSummary } from './files'
import { fitBudget, type ContextItem } from './index'
import { readmeDigest } from './instructions'
import { extractKeywords, scoreFiles } from './relevance'

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
  const grep = new Map([['src/ui/button.tsx', [3]]])
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
