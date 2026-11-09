// The look: flat colours only, in the logo and in everything that draws pictures of the panel.
import { readdirSync, readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('no gradients in the logo, the panel preview or the picture scripts', () => {
  const scripts = readdirSync(new URL('../scripts/', import.meta.url)).filter((name) => name.endsWith('.mjs'))
  for (const path of ['assets/icon.svg', ...scripts.map((name) => `scripts/${name}`)]) {
    assert.ok(!/gradient/i.test(read(path)), `${path} has a gradient`)
  }
  // The logo is the flat tile with the prompt and the spark.
  const icon = read('assets/icon.svg')
  assert.match(icon, /fill="#4F46E5"/)
  assert.match(icon, /fill="#FBBF24"/)
})
