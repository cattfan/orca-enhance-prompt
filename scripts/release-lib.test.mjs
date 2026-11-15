// The release rules: odometer versions, only release files committed, the chore(release) commit
// and the GitHub release notes.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commitSubject, latestTag, nextVersions, releaseNotes, unexpectedChanges, versionProblem } from './release-lib.mjs'

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

test('a release commits only the version, the three changelogs and the panel it builds', () => {
  const edited = ' M orca-plugin.json\n M src/version.ts\n M CHANGELOG.md\n M docs/changelog/CHANGELOG.vi.md\n M docs/changelog/CHANGELOG.zh-CN.md\n'
  assert.deepEqual(unexpectedChanges(edited), [])
  // The release builds the panel itself, so a panel already rebuilt is no obstacle.
  assert.deepEqual(unexpectedChanges(`${edited} M src/web-dist/assets/app.js\n?? src/web-dist/assets/new-chunk.js\n`), [])
  // Anything else would ride along unreviewed: a scratch test, a source change, a rename.
  assert.deepEqual(unexpectedChanges(' M orca-plugin.json\n?? src/zz-perf.test.ts\n M src/worker.ts\nR  a.ts -> b.ts\n'), ['src/zz-perf.test.ts', 'src/worker.ts', 'b.ts'])
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
