import { readdirSync, readFileSync } from 'node:fs'
import { read } from 'orca'
import { assert, mockHost, test } from 'orca/testing'
import { currentLanguage, dictionaries, resolveLanguage, t, translate } from './i18n.ts'
import { changeUiLanguage, enhanceNow, previewContext } from './panel/actions.ts'
import { contextNotes, contextShown, draft, put, run, say } from './panel/state.ts'
import { mountPanel } from './panel/testing.ts'
import { itemWhy } from './panel/view.ts'
import { english, MESSAGES, msg, raw } from './messages.ts'
import { CONTEXT_LEVEL_LABELS, PRESETS } from './presets.ts'
import { STYLE_LABELS } from './prompts.ts'

test('every UI string has a Vietnamese and a Chinese translation', () => {
  // The panel is src/panel.tsx and its parts in src/panel/.
  const parts = readdirSync(new URL('./panel/', import.meta.url)).filter((name) => /\.tsx?$/.test(name))
  const source = [new URL('./panel.tsx', import.meta.url), ...parts.map((name) => new URL(`./panel/${name}`, import.meta.url))]
    .map((url) => readFileSync(url, 'utf8'))
    .join('\n')
  const keys = new Set<string>()
  for (const match of source.matchAll(/\bt\('((?:[^'\\]|\\.)+)'/g)) keys.add(match[1].replace(/\\'/g, "'"))
  for (const label of [...Object.values(STYLE_LABELS), ...Object.values(CONTEXT_LEVEL_LABELS)]) keys.add(label)
  for (const key of ['key saved', 'key from env', 'no key', 'local', 'subscription', 'Output: same as prompt', 'Output: English', 'Output: Vietnamese', 'Output: Chinese']) keys.add(key)
  // Every message the worker sends by code (notes, labels, errors); 'raw' is outside text, never translated.
  for (const [code, template] of Object.entries(MESSAGES)) if (code !== 'raw') keys.add(template)
  // Labels kept in tables and passed to t() by variable: progress steps and Privacy rows.
  for (const match of source.matchAll(/^\s+(?:workspace|project|git|search|pick|terminal|model): '([^']+)',?$/gm)) keys.add(match[1])
  for (const match of source.matchAll(/\{ key: '[A-Za-z]+', label: '([^']+)', hint: (['"])((?:(?!\2).)+)\2 \}/g)) {
    keys.add(match[1])
    keys.add(match[3])
  }
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

test('the panel speaks Vietnamese from the uiLanguage setting, and the language menu switches it at once', async () => {
  const host = mockHost({
    settings: { uiLanguage: 'vi' },
    requests: {
      'models.get': { profiles: [], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
      'targets.list': { targets: [] }
    }
  })
  const view = await mountPanel(host)
  assert.equal(currentLanguage(), 'vi')
  assert.equal(t('Your prompt'), 'Prompt của bạn')
  assert.equal(t('No model yet'), 'Chưa có model')
  // The language menu in the header.
  await changeUiLanguage('zh')
  assert.equal(t('Your prompt'), '你的提示词')
  assert.equal(host.data().settings.uiLanguage, 'zh')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('worker notes, context labels and errors arrive as codes and show in the panel language', async () => {
  // English stays the same text as before codes existed.
  assert.equal(english(msg('error.all_failed', { list: [msg('error.attempt', { name: 'A', reason: msg('error.timeout') }), msg('error.attempt', { name: 'B', reason: raw('503: overloaded') })] })), 'All models failed. A: The request was cancelled or timed out. · B: 503: overloaded')
  const failing = Object.assign(new Error('All models failed.'), {
    code: 'action_failed',
    text: msg('error.all_failed', { list: [msg('error.attempt', { name: 'A', reason: msg('error.timeout') })] })
  })
  const host = mockHost({
    settings: { uiLanguage: 'vi' },
    requests: {
      'models.get': { profiles: [], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
      'targets.list': { targets: [] },
      'models.detect': { found: [] },
      'context.preview': {
        context: [
          { id: 'tree', kind: 'tree', label: 'Repository tree (3 files)', chars: 10, title: msg('label.tree', { count: 3 }) },
          { id: 'file:src/a.ts', kind: 'file', label: 'src/a.ts', chars: 5, note: 'picked by AI', why: msg('why.ai') }
        ],
        notes: [msg('note.picker_skipped', { reason: msg('error.no_key') })],
        chars: 15
      },
      'prompt.enhance': () => {
        throw failing
      }
    }
  })
  // A note saved by an older version (plain English) still shows.
  const view = await mountPanel(host, { persisted: { plugin: { contextNotes: ['An old saved note'], contextShown: [{ id: 'workspace', kind: 'workspace', label: 'Workspace', chars: 4 }] } } })
  assert.deepEqual(read(contextNotes).map(say), ['An old saved note'])
  // Opening the options gathers the context: its titles, reasons and notes read in Vietnamese.
  put(draft, 'sửa lỗi')
  await previewContext()
  const [tree, file] = read(contextShown)
  assert.equal(tree.title ? say(tree.title) : tree.label, 'Cây thư mục (3 file)')
  assert.match(itemWhy(file), /AI chọn/)
  assert.match(read(contextNotes).map(say).join('\n'), /^Bỏ qua AI chọn file: Chưa có API key\./)
  // A failed run: the worker's error is shown in Vietnamese on the run card.
  await enhanceNow()
  assert.equal(read(run)?.status, 'error')
  assert.match(read(run)?.error ?? '', /Tất cả model đều lỗi\. A: Yêu cầu đã bị huỷ hoặc hết thời gian chờ\./)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the brand "Enhance Prompt" is the same in every language', async () => {
  const { BRAND } = await import('./brand.ts')
  assert.equal(BRAND, 'Enhance Prompt')
  // Every translation of a text that names the plugin keeps the name as it is.
  for (const [lang, dict] of Object.entries(dictionaries)) {
    for (const [en, local] of Object.entries(dict)) {
      if (en.includes(BRAND)) assert.ok(local.includes(BRAND), `${lang}: "${local}"`)
    }
  }
  // The panel's header shows it as it is: the name is the constant, never a string passed to t().
  for (const dict of Object.values(dictionaries)) assert.ok(!(BRAND in dict), 'the brand has a translation entry')
  const header = readFileSync(new URL('../web/src/main.tsx', import.meta.url), 'utf8')
  assert.match(header, /<h1[^>]*>\{BRAND\}<\/h1>/)
  assert.ok(!/\bt\(\s*BRAND\b/.test(header) && !header.includes(`t('${BRAND}')`), 'the brand goes through t()')
})
