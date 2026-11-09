// What's new shows the changelog in the panel's language: every release needs its Vietnamese and
// Chinese notes (docs/changelog), with the same versions in the same order.
import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'

const versions = (path: string) =>
  [...readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').matchAll(/^## \[([^\]]+)\]/gm)].map((match) => match[1])

test('the translated changelogs have every release of CHANGELOG.md', () => {
  const english = versions('CHANGELOG.md')
  assert.ok(english.length > 10)
  assert.deepEqual(versions('docs/changelog/CHANGELOG.vi.md'), english)
  assert.deepEqual(versions('docs/changelog/CHANGELOG.zh-CN.md'), english)
})
