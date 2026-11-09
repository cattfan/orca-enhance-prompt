// History: size limits, and edits from the panel going through the worker's queue.
import { afterEach, assert, mockHost, mount, mountWorker, test, type MockRequests } from 'orca/testing'
import { capHistory, HISTORY_ENTRY_CHARS, HISTORY_TOTAL_CHARS, parseHistory, trimForHistory, type HistoryEntry } from './history.ts'
import * as panel from './panel.tsx'
import { PRESETS } from './presets.ts'
import * as main from './worker.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const entry = (id: string, size = 10): HistoryEntry => ({ id, at: 1, original: 'o'.repeat(size), enhanced: 'e'.repeat(size), style: 'balanced', model: 'm', source: 'panel' })
const gpt = { id: 'gpt', name: 'gpt', preset: 'openai', provider: 'openai', baseUrl: '', model: '', temperature: 0.3, maxTokens: 2000, enabled: true }

test('history keeps at most the limit (500) and stays under its total size; one huge entry is trimmed', () => {
  const many = Array.from({ length: 600 }, (_, index) => entry(`e${index}`))
  assert.equal(capHistory(many, 500).length, 500)
  assert.equal(capHistory(many, 500)[0].id, 'e0')
  // 100 entries of 2 × 9000 chars: only what fits in HISTORY_TOTAL_CHARS, newest first.
  const big = Array.from({ length: 100 }, (_, index) => entry(`b${index}`, 9000))
  const kept = capHistory(big, 500)
  assert.equal(kept.length, Math.floor(HISTORY_TOTAL_CHARS / 18_000))
  assert.equal(kept[0].id, 'b0')
  const trimmed = trimForHistory('x'.repeat(HISTORY_ENTRY_CHARS * 3))
  assert.ok(trimmed.length <= HISTORY_ENTRY_CHARS)
  assert.match(trimmed, /trimmed in history\)$/)
  assert.equal(trimForHistory('short'), 'short')
})

test('a very long prompt is saved trimmed, and older entries make room', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'r'.repeat(HISTORY_ENTRY_CHARS * 2) } }] }), { status: 200 })) as typeof fetch
  const old = Array.from({ length: 499 }, (_, index) => entry(`old${index}`, 1500))
  const host = mockHost({ storage: { models: { profiles: [gpt] }, history: old }, secrets: { 'apiKey.gpt': 'k' }, settings: { historyLimit: 500 } })
  const worker = await mountWorker(main, { host })
  await worker.request('prompt.enhance', { prompt: 'p'.repeat(HISTORY_ENTRY_CHARS * 2), level: 'off' })
  const saved = parseHistory(host.data().storage.history as never)
  assert.ok(saved[0].original.length <= HISTORY_ENTRY_CHARS && saved[0].enhanced.length <= HISTORY_ENTRY_CHARS)
  const total = saved.reduce((sum, item) => sum + item.original.length + item.enhanced.length, 0)
  assert.ok(total <= HISTORY_TOTAL_CHARS, String(total))
  assert.ok(saved.length < 500)
  await worker.deactivate()
})

test('history.remove and history.clear run in order with a new entry being saved', async () => {
  globalThis.fetch = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
  }) as typeof fetch
  const host = mockHost({ storage: { models: { profiles: [gpt] }, history: [entry('a'), entry('b')] }, secrets: { 'apiKey.gpt': 'k' } })
  const worker = await mountWorker(main, { host })
  await Promise.all([worker.request('prompt.enhance', { prompt: 'new one', level: 'off' }), worker.request('history.remove', { id: 'a' })])
  const afterRemove = parseHistory(host.data().storage.history as never)
  assert.deepEqual(afterRemove.map((item) => item.original).sort(), ['new one', 'oooooooooo'])
  assert.ok(!afterRemove.some((item) => item.id === 'a'))

  // Clear while a run is finishing: the clear is not undone by the run's write, nor the reverse.
  const run = worker.request('prompt.enhance', { prompt: 'during clear', level: 'off' })
  await worker.request('history.clear')
  await run
  const afterClear = parseHistory((host.data().storage.history ?? null) as never)
  assert.ok(afterClear.length <= 1)
  assert.ok(afterClear.every((item) => item.original === 'during clear'))
  await worker.deactivate()
})

test('the History tab: Clear asks twice and goes through the worker; long lists show a page at a time', async () => {
  const requests: string[] = []
  const host = mockHost({
    storage: { history: Array.from({ length: 120 }, (_, index) => ({ ...entry(`h${index}`), original: `prompt ${index}` })) },
    requests: {
      'models.get': { profiles: [], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
      'targets.list': { targets: [] },
      'models.detect': { found: [] },
      'history.remove': (input: unknown) => {
        requests.push(`remove:${(input as { id: string }).id}`)
        return { ok: true }
      },
      'history.clear': () => {
        requests.push('clear')
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ role: 'button', label: 'History (120)' })
  assert.ok(view.find({ text: 'prompt 49' }))
  assert.equal(view.find({ text: 'prompt 50' }), null)
  await view.press({ role: 'button', text: 'Show more' })
  assert.ok(view.find({ text: 'prompt 99' }))
  await view.press({ role: 'button', text: 'Clear history' })
  assert.deepEqual(requests, [])
  await view.press({ role: 'button', text: 'Press again to clear history' })
  assert.deepEqual(requests, ['clear'])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

const panelRequests: MockRequests = {
  'models.get': { profiles: [], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
  'targets.list': { targets: [] },
  'models.detect': { found: [] },
  'data.clear': { ok: true as const },
  'data.summary': { history: 0, profiles: 0, keys: 0, catalogs: 0 }
}
const persistedRun = { draft: 'my secret draft', result: 'the rewritten secret', lastRun: { model: 'm', profileName: 'p', ms: 1, attempts: [] }, contextShown: [{ id: 'workspace', kind: 'workspace', label: 'Workspace', chars: 4 }], contextNotes: ['No focused workspace.'] }

test('the draft and last result are kept across panel runs while history is saved', async () => {
  const view = await mount(panel, { host: mockHost({ requests: panelRequests }), persisted: { plugin: persistedRun } })
  assert.equal(view.valueOf(view.find({ label: 'Your prompt' })!), 'my secret draft')
  await view.type({ label: 'Your prompt' }, 'next idea', { replace: true })
  assert.equal(view.persisted.plugin.draft, 'next idea')
  await view.unmount()
})

test('"Save history" off: the draft and last result are not kept on disk, but still usable now', async () => {
  const view = await mount(panel, { host: mockHost({ requests: panelRequests, settings: { saveHistory: false } }), persisted: { plugin: persistedRun } })
  await view.settled()
  for (const key of ['draft', 'result']) assert.equal(view.persisted.plugin[key], '', key)
  assert.equal(view.persisted.plugin.lastRun, null)
  assert.deepEqual(view.persisted.plugin.contextShown, [])
  // What was on screen stays for this run; new typing is not written either.
  assert.equal(view.valueOf(view.find({ label: 'Your prompt' })!), 'my secret draft')
  await view.type({ label: 'Your prompt' }, 'typed now', { replace: true })
  assert.equal(view.persisted.plugin.draft, '')
  assert.equal(view.valueOf(view.find({ label: 'Your prompt' })!), 'typed now')
  await view.unmount()
})

test('"Delete everything" also clears the saved draft and last result', async () => {
  const view = await mount(panel, { host: mockHost({ requests: panelRequests }), persisted: { plugin: { ...persistedRun, tab: 'privacy' } } })
  await view.press({ role: 'button', text: 'Delete everything' })
  await view.press({ role: 'button', text: 'Press again to delete everything' })
  for (const key of ['draft', 'result']) assert.equal(view.persisted.plugin[key], '', key)
  assert.equal(view.persisted.plugin.lastRun, null)
  assert.deepEqual(view.persisted.plugin.contextNotes, [])
  await view.press({ role: 'button', label: 'Enhance Prompt' })
  assert.equal(view.valueOf(view.find({ label: 'Your prompt' })!), '')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
