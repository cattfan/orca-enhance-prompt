import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { aliasesFromText, parseCatalog, parseClaudeModelTable } from './catalog.ts'
import * as main from './worker.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test('aliasesFromText reads quoted aliases next to "alias"', () => {
  const help = "--model <model> Model for the current session. Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name."
  assert.deepEqual(aliasesFromText(help), ['fable', 'opus', 'sonnet'])
  const schema = 'Accepts a model alias ("opus", "sonnet", or "fable" on v2.1.170+) or a full model ID.'
  assert.deepEqual(aliasesFromText(schema), ['opus', 'sonnet', 'fable'])
  assert.deepEqual(aliasesFromText('Set "model" to a full id.'), [])
})

test('parseCatalog keeps only well-formed entries', () => {
  assert.equal(parseCatalog(null), null)
  const parsed = parseCatalog({ fetchedAt: 1, source: 's', models: [{ id: 'a', label: 'A', isDefault: true }, { nope: 1 }, 'x'] })
  assert.deepEqual(parsed, { models: [{ id: 'a', label: 'A', isDefault: true }], source: 's', fetchedAt: 1 })
})

test('API catalogs come from GET /models, newest first, and are cached', async () => {
  let calls = 0
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls++
    assert.equal(String(url), 'https://api.groq.com/openai/v1/models')
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer g')
    return new Response(JSON.stringify({ data: [{ id: 'old', created: 1 }, { id: 'new', created: 9 }] }), { status: 200 })
  }) as typeof fetch
  const host = mockHost({
    storage: {
      models: {
        profiles: [{ id: 'groq', name: 'Groq', preset: 'groq', provider: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'old', temperature: 0.3, maxTokens: 2000, enabled: true, command: '', args: '' }]
      }
    },
    secrets: { 'apiKey.groq': 'g' }
  })
  const worker = await mountWorker(main, { host })
  const first = await worker.request('models.catalog', { preset: 'groq', profileId: 'groq' })
  assert.deepEqual(first.models.map((m) => m.id), ['new', 'old'])
  await worker.request('models.catalog', { preset: 'groq', profileId: 'groq' })
  assert.equal(calls, 1, 'served from cache')
  await worker.request('models.catalog', { preset: 'groq', profileId: 'groq', refresh: true })
  assert.equal(calls, 2)
  await worker.deactivate()
})

test('a failed API catalog reports the error and caches nothing', async () => {
  globalThis.fetch = (async () => new Response('{}', { status: 401, statusText: 'Unauthorized' })) as typeof fetch
  const host = mockHost()
  const worker = await mountWorker(main, { host })
  const catalog = await worker.request('models.catalog', { preset: 'openai', apiKey: 'bad' })
  assert.equal(catalog.models.length, 0)
  assert.match(catalog.error ?? '', /401/)
  assert.equal(Object.keys(host.data().storage).filter((key) => key.startsWith('catalog:')).length, 0)
  await worker.deactivate()
})

test('reads the model table built into Claude Code', () => {
  const bundle =
    'x,{id:"claude-opus-4-8",name:"Opus 4.8",short_name:"Opus",section:"overflow",capabilities:{}},' +
    '{id:"claude-fable-5-1",name:"Fable 5.1",short_name:"Fable",description:"For your toughest challenges",section:"main",capabilities:{}},' +
    '{id:"claude-opus-4-8",name:"Opus 4.8",short_name:"Opus",section:"overflow"}'
  assert.deepEqual(parseClaudeModelTable(bundle), [
    { id: 'claude-fable-5-1', name: 'Fable 5.1', description: 'For your toughest challenges', main: true },
    { id: 'claude-opus-4-8', name: 'Opus 4.8', main: false }
  ])
})

test('opening the panel asks for the same list at once: one fetch serves them all', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    await new Promise((resolve) => setTimeout(resolve, 20))
    return new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 })
  }) as typeof fetch
  const host = mockHost({
    storage: {
      models: {
        profiles: [
          { id: 'a', name: 'A', preset: 'groq', provider: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'm1', temperature: 0.3, maxTokens: 2000, enabled: true, command: '', args: '' },
          { id: 'b', name: 'B', preset: 'groq', provider: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'm1', temperature: 0.3, maxTokens: 2000, enabled: true, command: '', args: '' }
        ]
      }
    },
    secrets: { 'apiKey.a': 'k', 'apiKey.b': 'k' }
  })
  const worker = await mountWorker(main, { host })
  const lists = await Promise.all([
    worker.request('models.catalog', { preset: 'groq', profileId: 'a' }),
    worker.request('models.catalog', { preset: 'groq', profileId: 'b' })
  ])
  assert.equal(calls, 1)
  assert.deepEqual(lists[0], lists[1])
  await worker.deactivate()
})

test('model lists: an environment key is not used while that Privacy switch is off', async () => {
  const previous = process.env.GROQ_API_KEY
  process.env.GROQ_API_KEY = 'from-env'
  const seen: (string | undefined)[] = []
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    seen.push((init?.headers as Record<string, string>).authorization)
    return new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 })
  }) as typeof fetch
  try {
    const worker = await mountWorker(main, { host: mockHost({ settings: { allowEnvKeys: false } }) })
    await worker.request('models.catalog', { preset: 'groq' })
    assert.deepEqual(seen, [undefined])
    await worker.deactivate()
  } finally {
    if (previous === undefined) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = previous
  }
})
