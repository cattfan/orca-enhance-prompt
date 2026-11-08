// Usage: node scripts/release.mjs 1.2.0
// Checks that orca-plugin.json and CHANGELOG.md mention the version, runs the checks, commits,
// tags vX.Y.Z, pushes, and creates the GitHub release with the changelog section as notes.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: node scripts/release.mjs <x.y.z>')
  process.exit(2)
}
const tag = `v${version}`
// git and gh are real executables: no shell, so arguments with spaces stay intact. npx and orca can
// be .cmd shims on Windows, which need a shell; their arguments here are fixed words.
const SHIMS = new Set(['npx', 'orca'])
const run = (cmd, args) =>
  execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && SHIMS.has(cmd) })
const out = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()

let manifest
try {
  manifest = JSON.parse(readFileSync('orca-plugin.json', 'utf8'))
} catch (error) {
  console.error(`Cannot read orca-plugin.json: ${error.message}`)
  process.exit(1)
}
if (manifest.version !== version) throw new Error(`orca-plugin.json version is ${manifest.version}, not ${version}`)
const changelog = readFileSync('CHANGELOG.md', 'utf8')
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const section = new RegExp(`## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|\\n\\[\\d)`).exec(changelog)
if (!section) throw new Error(`CHANGELOG.md has no "## [${version}]" section`)
if (out('git', ['tag', '--list', tag])) throw new Error(`${tag} already exists`)

run('npx', ['tsc', '-p', '.'])
run('orca', ['plugin', 'test', '.'])
run('orca', ['plugin', 'validate', '.'])

const firstLine = section[1].split('\n').find((line) => line.startsWith('- '))?.replace(/^- (\*\*)?/, '').replace(/\*\*.*$/, '') ?? 'release'
run('git', ['add', '-A'])
if (out('git', ['status', '--porcelain'])) run('git', ['commit', '-m', `${tag}: ${firstLine.slice(0, 70)}`])
run('git', ['tag', '-a', tag, '-m', tag])
run('git', ['push', 'origin', 'HEAD', tag])

const notesFile = join(mkdtempSync(join(tmpdir(), 'release-')), 'notes.md')
writeFileSync(notesFile, section[1].trim() + '\n')
run('gh', ['release', 'create', tag, '--title', tag, '--notes-file', notesFile, '--verify-tag'])
console.log(`Released ${tag}`)
