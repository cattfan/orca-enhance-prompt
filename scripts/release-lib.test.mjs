// The release rules: odometer versions, only release files committed, whole-sentence subjects.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commitSubject, latestTag, nextVersions, staleBuild, unexpectedChanges, versionProblem } from './release-lib.mjs'

test('versions count like an odometer and must follow the last tag', () => {
  assert.deepEqual(nextVersions('2.0.1'), { patch: '2.0.2', minor: '2.1.0', major: '3.0.0' })
  assert.deepEqual(nextVersions('1.8.9'), { patch: '1.9.0', minor: '1.9.0', major: '2.0.0' })
  assert.deepEqual(nextVersions('1.9.9'), { patch: '2.0.0', minor: '2.0.0', major: '2.0.0' })
  assert.deepEqual(nextVersions('13.9.9'), { patch: '14.0.0', minor: '14.0.0', major: '14.0.0' })
  assert.equal(versionProblem('2.0.1', '2.0.2'), null)
  assert.equal(versionProblem('2.0.1', '2.1.0'), null)
  assert.equal(versionProblem(null, '1.0.0'), null)
  assert.match(versionProblem('2.0.1', '2.0.4'), /does not follow 2\.0\.1: use 2\.0\.2/)
  assert.match(versionProblem('2.0.1', '2.0.1'), /does not follow/)
  assert.match(versionProblem('2.0.1', '1.9.9'), /does not follow/)
  assert.match(versionProblem('1.9.9', '1.10.0'), /single-digit/)
  assert.equal(latestTag(['v1.9.0', 'v2.0.1', 'v2.0.0', 'v10.0.0-beta', 'junk', '']), '2.0.1')
  assert.equal(latestTag([]), null)
})

test('only orca-plugin.json and CHANGELOG.md may be changed when releasing', () => {
  assert.deepEqual(unexpectedChanges(' M orca-plugin.json\n M CHANGELOG.md\n M src/version.ts\n'), [])
  assert.deepEqual(unexpectedChanges(' M orca-plugin.json\n?? src/zz-perf.test.ts\nR  a.ts -> b.ts\n'), ['src/zz-perf.test.ts', 'b.ts'])
})

test('a panel build that changes src/web-dist means the committed panel was stale', () => {
  // Building again changed nothing: the committed panel is what the sources build.
  assert.deepEqual(staleBuild(''), [])
  assert.deepEqual(staleBuild('\n'), [])
  // A shared file changed after the last build: these are the files the release must not ship as they were.
  assert.deepEqual(staleBuild(' M src/web-dist/assets/app.js\n M src/web-dist/assets/index.css\n?? src/web-dist/assets/new-chunk.js\n'), [
    'src/web-dist/assets/app.js',
    'src/web-dist/assets/index.css',
    'src/web-dist/assets/new-chunk.js'
  ])
})

test('the commit subject is a whole first sentence, never cut', () => {
  const section = '\n### Fixed\n\n- The panel opens faster. Claude Code\'s model list is read straight from its program file bytes and remembered until that file changes.\n- Other.\n'
  assert.equal(commitSubject('v2.0.1', section), 'v2.0.1: The panel opens faster.')
  const long = '- **Git diff** in the context leaves out secret files, both sides of a rename, and the person\'s exclude patterns, also at the Max level'
  assert.equal(commitSubject('v2.0.2', long), "v2.0.2: Git diff in the context leaves out secret files, both sides of a rename, and the person's exclude patterns, also at the Max level")
  assert.equal(commitSubject('v1.0.0', 'no bullets'), 'v1.0.0')
})
