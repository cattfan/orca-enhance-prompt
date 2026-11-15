// The changelogs keep the format CONTRIBUTING.md sets (Keep a Changelog 1.1.0), and the Vietnamese
// and Chinese ones, which the panel's What's new shows, follow the English one.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/** The first version written to the standard; older sections keep the form they were released in. */
const STANDARD_SINCE = '2.8.1'
/** Keep a Changelog's groups, in its order, as each changelog names them. */
const GROUPS = {
  en: ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'],
  vi: ['Thêm mới', 'Thay đổi', 'Ngừng hỗ trợ', 'Gỡ bỏ', 'Sửa lỗi', 'Bảo mật'],
  zh: ['新增', '变更', '弃用', '移除', '修复', '安全']
}
const FILES = { en: 'CHANGELOG.md', vi: 'docs/changelog/CHANGELOG.vi.md', zh: 'docs/changelog/CHANGELOG.zh-CN.md' }
const REPO = 'https://github.com/cattfan/orca-enhance-prompt'

const parts = (version) => version.split('.').map(Number)
const newer = (a, b) => {
  const [x, y] = [parts(a), parts(b)]
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

/** Each version's heading line and its groups, each group with its bullets and any other lines. */
function parse(text) {
  const releases = []
  for (const block of text.replace(/\r\n/g, '\n').split(/^(?=## )/m).slice(1)) {
    const [heading, ...lines] = block.split('\n')
    const release = { heading, version: /^## \[([^\]]+)\]/.exec(heading)?.[1] ?? '', groups: [], loose: [] }
    for (const line of lines) {
      if (/^\[[^\]]+\]: /.test(line) || line.trim() === '') continue
      if (line.startsWith('### ')) release.groups.push({ name: line.slice(4), bullets: [] })
      else if (line.startsWith('- ') && release.groups.length > 0) release.groups.at(-1).bullets.push(line.slice(2))
      else release.loose.push(line)
    }
    releases.push(release)
  }
  return releases
}

const changelogs = Object.fromEntries(Object.entries(FILES).map(([lang, path]) => [lang, parse(readFileSync(path, 'utf8'))]))
const english = changelogs.en
const linkLines = readFileSync(FILES.en, 'utf8').replace(/\r\n/g, '\n')

test('every version is "## [X.Y.Z] - YYYY-MM-DD", newest first, with its release link', () => {
  for (const release of english) {
    assert.match(release.heading, /^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}$/, release.heading)
    assert.ok(linkLines.includes(`\n[${release.version}]: ${REPO}/releases/tag/v${release.version}\n`), `no link line for ${release.version}`)
  }
  const versions = english.map((release) => release.version)
  assert.deepEqual(versions, [...versions].sort((a, b) => newer(b, a)))
})

test('the translations carry the same versions and dates', () => {
  for (const lang of ['vi', 'zh']) {
    assert.deepEqual(
      changelogs[lang].map((release) => release.heading),
      english.map((release) => release.heading),
      FILES[lang]
    )
  }
})

test(`from ${STANDARD_SINCE} on, a version has only Keep a Changelog groups, in order, and only bullets`, () => {
  for (const [lang, releases] of Object.entries(changelogs)) {
    for (const release of releases.filter((entry) => newer(entry.version, STANDARD_SINCE) >= 0)) {
      const where = `${FILES[lang]} ${release.version}`
      const names = release.groups.map((group) => group.name)
      assert.ok(names.length > 0, `${where}: no group`)
      for (const name of names) assert.ok(GROUPS[lang].includes(name), `${where}: "${name}" is not one of ${GROUPS[lang].join(', ')}`)
      const order = names.map((name) => GROUPS[lang].indexOf(name))
      assert.deepEqual(order, [...order].sort((a, b) => a - b), `${where}: groups out of order`)
      assert.equal(new Set(names).size, names.length, `${where}: a group twice`)
      assert.deepEqual(release.loose, [], `${where}: text outside the bullets`)
      for (const group of release.groups) assert.ok(group.bullets.length > 0, `${where}: "${group.name}" is empty`)
    }
  }
})

test(`from ${STANDARD_SINCE} on, the translations have the same groups and as many bullets`, () => {
  for (const release of english.filter((entry) => newer(entry.version, STANDARD_SINCE) >= 0)) {
    const shape = (entry) => entry.groups.map((group) => [GROUPS.en[GROUPS[entry.lang].indexOf(group.name)], group.bullets.length])
    for (const lang of ['vi', 'zh']) {
      const translated = changelogs[lang].find((entry) => entry.version === release.version)
      assert.deepEqual(shape({ ...translated, lang }), shape({ ...release, lang: 'en' }), `${FILES[lang]} ${release.version}`)
    }
  }
})
