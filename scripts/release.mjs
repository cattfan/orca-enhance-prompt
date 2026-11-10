// Usage: node scripts/release.mjs 1.2.0
// Before anything is committed it checks: on main, nothing changed but the release files
// (orca-plugin.json, CHANGELOG.md, src/version.ts), the version follows the last tag (odometer
// rule), those files name it, the committed panel (src/web-dist) is what the sources build, and
// tsc, tests, check and validate pass. Then it commits the release files only, tags vX.Y.Z,
// pushes, and creates the GitHub release with the changelog section as notes.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitSubject, latestTag, RELEASE_FILES, staleBuild, unexpectedChanges, versionProblem } from './release-lib.mjs'

const fail = (message) => {
  console.error(`release: ${message}`)
  process.exit(1)
}
const version = process.argv[2]
const tag = `v${version}`
// git and gh are real executables: no shell, so arguments with spaces stay intact. npm, npx and orca
// can be .cmd shims on Windows, which need a shell; their arguments here are fixed words.
const SHIMS = new Set(['npm', 'npx', 'orca'])
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && SHIMS.has(cmd) })
const raw = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' })
const out = (cmd, args) => raw(cmd, args).trim()

const branch = out('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main') fail(`releases are made from main, not ${branch}`)
// Untrimmed: each porcelain line starts with a two-letter status that may begin with a space.
const stray = unexpectedChanges(raw('git', ['status', '--porcelain', '--untracked-files=all']))
if (stray.length > 0) fail(`commit or remove these first (a release commits only ${RELEASE_FILES.join(', ')}):\n  ${stray.join('\n  ')}`)

const latest = latestTag(out('git', ['tag', '--list', 'v*']).split('\n'))
const problem = versionProblem(latest, version)
if (problem) fail(problem)
if (out('git', ['tag', '--list', tag])) fail(`${tag} already exists`)

let manifest
try {
  manifest = JSON.parse(readFileSync('orca-plugin.json', 'utf8'))
} catch (error) {
  fail(`cannot read orca-plugin.json: ${error.message}`)
}
if (manifest.version !== version) fail(`orca-plugin.json version is ${manifest.version}, not ${version}`)
// The panel shows src/version.ts: it must say the same.
const shown = /VERSION = '([^']+)'/.exec(readFileSync('src/version.ts', 'utf8'))?.[1]
if (shown !== version) fail(`src/version.ts says ${shown}, not ${version}`)
const changelog = readFileSync('CHANGELOG.md', 'utf8')
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const section = new RegExp(`## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|\\n\\[\\d)`).exec(changelog)
if (!section) fail(`CHANGELOG.md has no "## [${version}]" section`)
if (!changelog.includes(`[${version}]: `)) fail(`CHANGELOG.md has no "[${version}]: <link>" line at the bottom`)
// What's new reads the translated changelogs, bundled into the built panel: both need this version.
for (const path of ['docs/changelog/CHANGELOG.vi.md', 'docs/changelog/CHANGELOG.zh-CN.md']) {
  if (!readFileSync(path, 'utf8').includes(`## [${version}]`)) fail(`${path} has no "## [${version}]" section`)
}
const built = readdirSync('src/web-dist/assets').map((name) => readFileSync(`src/web-dist/assets/${name}`, 'utf8')).join('\n')
if (!built.includes(`[${version}]`)) fail(`src/web-dist does not include ${version}'s notes: run npm run web:build and commit it first`)
// Orca runs the committed build of the panel, not web/ and src/: it has to be what they build now.
// A change to a file the panel bundles (src/panel, the translations, the worker's messages…) made
// after the last build would otherwise be released without reaching the panel. The build is
// reproducible, so building again changes nothing when the committed one is up to date.
try {
  run('npm', ['run', 'web:build'])
} catch {
  fail('the panel did not build: run npm run web:install, then npm run web:build')
}
const rebuilt = staleBuild(raw('git', ['status', '--porcelain', '--', 'src/web-dist']))
if (rebuilt.length > 0) fail(`src/web-dist was not up to date: building it again changed\n  ${rebuilt.join('\n  ')}\nCommit the rebuilt panel, then run the release again.`)

run('npx', ['tsc', '-p', '.'])
run('orca', ['plugin', 'test', '.'])
run('orca', ['plugin', 'check', '.'])
run('orca', ['plugin', 'validate', '.'])

const notes = section[1].trim()
run('git', ['add', '--', ...RELEASE_FILES])
run('git', ['commit', '-m', commitSubject(tag, notes), '-m', notes])
run('git', ['tag', '-a', tag, '-m', tag])
run('git', ['push', 'origin', 'main', tag])

const notesFile = join(mkdtempSync(join(tmpdir(), 'release-')), 'notes.md')
writeFileSync(notesFile, `${notes}\n`)
run('gh', ['release', 'create', tag, '--title', tag, '--notes-file', notesFile, '--verify-tag'])
console.log(`Released ${tag}`)
