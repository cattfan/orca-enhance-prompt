// Pure helpers for scripts/release.mjs, kept apart so they can be tested without git or gh.

/** "1.2.3" -> [1, 2, 3]; null unless minor and patch are single digits (the odometer rule). */
export function parseVersion(text) {
  const match = /^(\d+)\.(\d)\.(\d)$/.exec(text ?? '')
  return match ? match.slice(1).map(Number) : null
}

/**
 * The versions allowed after `latest`: the next patch, minor or major, counted like an odometer
 * (minor and patch run 0-9 and carry over): 1.8.9 -> 1.9.0, 1.9.9 -> 2.0.0, 13.9.9 -> 14.0.0.
 */
export function nextVersions(latest) {
  const parsed = parseVersion(latest)
  if (!parsed) throw new Error(`Not a release version: ${latest}`)
  const [major, minor, patch] = parsed
  const carry = (x, y, z) => {
    if (z > 9) [y, z] = [y + 1, 0]
    if (y > 9) [x, y] = [x + 1, 0]
    return `${x}.${y}.${z}`
  }
  return {
    patch: carry(major, minor, patch + 1),
    minor: carry(major, minor + 1, 0),
    major: `${major + 1}.0.0`
  }
}

/** The highest vX.Y.Z among git tags, as "X.Y.Z"; null when there is none. */
export function latestTag(tags) {
  const versions = tags
    .map((tag) => tag.trim().replace(/^v/, ''))
    .filter((tag) => parseVersion(tag))
    .sort((a, b) => {
      const [x, y] = [parseVersion(a), parseVersion(b)]
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
    })
  return versions.at(-1) ?? null
}

/** Why `version` may not follow `latest`, or null when it may. */
export function versionProblem(latest, version) {
  if (!parseVersion(version)) return `${version} is not X.Y.Z with single-digit minor and patch (after 9 they carry: 1.9.9 -> 2.0.0)`
  if (latest === null) return null
  const next = nextVersions(latest)
  if (Object.values(next).includes(version)) return null
  return `${version} does not follow ${latest}: use ${next.patch} (fix), ${next.minor} (feature) or ${next.major} (breaking)`
}

/** The files a release edits by hand: the version, and the notes in the three changelogs. */
export const RELEASE_FILES = ['orca-plugin.json', 'src/version.ts', 'CHANGELOG.md', 'docs/changelog/CHANGELOG.vi.md', 'docs/changelog/CHANGELOG.zh-CN.md']
/** The built panel: the release builds it again (it bundles the version and the notes) and commits it. */
export const BUILD_DIR = 'src/web-dist/'

/** The paths in `git status --porcelain` output (for a rename, the new name). */
function statusPaths(porcelain) {
  return porcelain
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.slice(3).split(' -> ').pop().replace(/^"|"$/g, ''))
}

/** Paths in `git status --porcelain` output that a release commit must not take along. */
export function unexpectedChanges(porcelain) {
  return statusPaths(porcelain).filter((path) => !RELEASE_FILES.includes(path) && !path.startsWith(BUILD_DIR))
}

/**
 * The release commit's subject, in Conventional Commits form (CONTRIBUTING.md); the changelog
 * section goes in the body.
 */
export function commitSubject(tag) {
  return `chore(release): ${tag}`
}

/**
 * The GitHub release notes: the changelog section, then the link to everything that changed since
 * the previous tag (none for the first release).
 */
export function releaseNotes(section, tag, previous, repo = 'cattfan/orca-enhance-prompt') {
  const notes = section.trim()
  return previous ? `${notes}\n\n**Full changelog**: https://github.com/${repo}/compare/${previous}...${tag}\n` : `${notes}\n`
}
