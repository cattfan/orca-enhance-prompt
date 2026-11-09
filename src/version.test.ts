// The version the panel shows is the one Orca installs.
import { readFileSync } from 'node:fs'
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel.tsx'
import { PRESETS } from './presets.ts'
import { VERSION } from './version.ts'

test('src/version.ts matches orca-plugin.json', () => {
  const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8')) as { version: string }
  assert.equal(VERSION, manifest.version)
})

test('the panel header shows the version', async () => {
  const host = mockHost({
    requests: {
      'models.get': { profiles: [], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
      'targets.list': { targets: [] },
      'models.detect': { found: [] },
      'rules.get': { rules: [], structures: [] }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: `v${VERSION}` }), JSON.stringify(view.summary()))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
