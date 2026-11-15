// The release rules: odometer versions, only release files committed, the chore(release) commit
// and the GitHub release notes.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commitSubject, latestTag, nextVersions, releaseNotes, staleBuild, unexpectedChanges, versionProblem } from './release-lib.mjs'

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

test('the release commit is chore(release) in Conventional Commits form', () => {
  assert.equal(commitSubject('v2.8.1'), 'chore(release): v2.8.1')
  assert.match(commitSubject('v13.9.9'), /^chore\(release\): v\d+\.\d+\.\d+$/)
})

test('the GitHub release notes are the changelog section and a link to the full diff', () => {
  const section = '\n### Fixed\n\n- The panel opens faster.\n'
  assert.equal(
    releaseNotes(section, 'v2.8.1', 'v2.8.0'),
    '### Fixed\n\n- The panel opens faster.\n\n**Full changelog**: https://github.com/cattfan/orca-enhance-prompt/compare/v2.8.0...v2.8.1\n'
  )
  // The first release has nothing to compare with.
  assert.equal(releaseNotes(section, 'v1.0.0', null), '### Fixed\n\n- The panel opens faster.\n')
})
