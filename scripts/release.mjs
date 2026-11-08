// Usage: node scripts/release.mjs 1.2.0
// Before anything is committed it checks: on main, nothing changed but orca-plugin.json and
// CHANGELOG.md, the version follows the last tag (odometer rule), both files name it, and
// tsc, tests, check and validate pass. Then it commits those two files only, tags vX.Y.Z, pushes,
// and creates the GitHub release with the changelog section as notes.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitSubject, latestTag, RELEASE_FILES, unexpectedChanges, versionProblem } from './release-lib.mjs'

const fail = (message) => {
  console.error(`release: ${message}`)
  process.exit(1)
}
const version = process.argv[2]
const tag = `v${version}`
// git and gh are real executables: no shell, so arguments with spaces stay intact. npx and orca can
// be .cmd shims on Windows, which need a shell; their arguments here are fixed words.
const SHIMS = new Set(['npx', 'orca'])
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && SHIMS.has(cmd) })
const raw = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' })
const out = (cmd, args) => raw(cmd, args).trim()

const branch = out('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main') fail(`releases are made from main, not ${branch}`)
// Untrimmed: each porcelain line starts with a two-letter status that may begin with a space.
const stray = unexpectedChanges(raw('git', ['status', '--porcelain', '--untracked-files=all']))
if (stray.length > 0) fail(`commit or remove these first (a release commits only ${RELEASE_FILES.join(' and ')}):\n  ${stray.join('\n  ')}`)

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
const changelog = readFileSync('CHANGELOG.md', 'utf8')
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const section = new RegExp(`## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|\\n\\[\\d)`).exec(changelog)
if (!section) fail(`CHANGELOG.md has no "## [${version}]" section`)
if (!changelog.includes(`[${version}]: `)) fail(`CHANGELOG.md has no "[${version}]: <link>" line at the bottom`)

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
