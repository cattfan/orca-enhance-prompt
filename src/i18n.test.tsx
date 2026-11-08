import { readFileSync } from 'node:fs'
import { assert, mockHost, mount, test } from 'orca/testing'
import { dictionaries, resolveLanguage, translate } from './i18n'
import * as panel from './panel'
import { CONTEXT_LEVEL_LABELS, PRESETS } from './presets'
import { STYLE_LABELS } from './prompts'

test('every UI string has a Vietnamese and a Chinese translation', () => {
  const source = readFileSync(new URL('./panel.tsx', import.meta.url), 'utf8')
  const keys = new Set<string>()
  for (const match of source.matchAll(/\bt\('((?:[^'\\]|\\.)+)'/g)) keys.add(match[1].replace(/\\'/g, "'"))
  for (const label of [...Object.values(STYLE_LABELS), ...Object.values(CONTEXT_LEVEL_LABELS)]) keys.add(label)
  for (const key of ['key saved', 'key from env', 'no key', 'local', 'subscription', 'Output: same as prompt', 'Output: English', 'Output: Vietnamese', 'Output: Chinese']) keys.add(key)
  for (const [lang, dict] of Object.entries(dictionaries)) {
    const missing = [...keys].filter((key) => !(key in dict))
    assert.deepEqual(missing, [], `${lang} is missing translations`)
  }
  assert.ok(keys.size > 80)
})

test('placeholders survive translation; auto follows the Orca locale', () => {
  assert.equal(translate('vi', 'Sent to {label}.', { label: 'Claude' }), 'Đã gửi tới Claude.')
  assert.equal(translate('zh', 'Saved {name}.', { name: 'GPT' }), '已保存 GPT。')
  assert.equal(translate('en', 'Not translated {x}', { x: 1 }), 'Not translated 1')
  for (const dict of Object.values(dictionaries)) {
    for (const [en, local] of Object.entries(dict)) {
      const want = [...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      const got = [...local.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      assert.deepEqual(got, want, en)
    }
  }
  assert.equal(resolveLanguage('auto', 'vi-VN'), 'vi')
  assert.equal(resolveLanguage('auto', 'zh-CN'), 'zh')
  assert.equal(resolveLanguage('auto', 'fr'), 'en')
  assert.equal(resolveLanguage('zh', 'vi'), 'zh')
  assert.ok(PRESETS.length > 10)
})

test('the panel renders in Vietnamese from the uiLanguage setting', async () => {
  const host = mockHost({
    settings: { uiLanguage: 'vi' },
    requests: {
      'models.get': { profiles: [], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
      'targets.list': { targets: [] }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ label: 'Prompt của bạn' }))
  assert.ok(view.find({ text: /Chưa có model/ }) ?? view.find({ label: 'Chưa có model' }))
  // The language menu is at the bottom of the Models tab.
  await view.select({ type: 'Tabs' }, 'models')
  await view.select({ label: 'Ngôn ngữ' }, 'zh')
  await view.select({ type: 'Tabs' }, 'enhance')
  assert.ok(view.find({ label: '你的提示词' }))
  assert.equal(host.data().settings.uiLanguage, 'zh')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
