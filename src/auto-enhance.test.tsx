// Auto-enhance (AI): only models that can answer within the hook's 2 s are offered, and the panel
// says so when there is none.
import { read } from 'orca'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { defaults } from './panel/state.ts'
import { mountPanel } from './panel/testing.ts'
import { hookChoice, hookModels } from './panel/view.ts'
import { PRESETS, type ProfileView } from './presets.ts'
import * as main from './worker.ts'

const api = (id: string, extra: Partial<ProfileView> = {}): ProfileView => ({
  id,
  name: id,
  preset: 'openai',
  provider: 'openai',
  baseUrl: '',
  model: '',
  effectiveBaseUrl: 'https://api.openai.com/v1',
  effectiveModel: 'gpt-4.1-mini',
  maxTokens: 2000,
  enabled: true,
  command: '',
  args: '',
  keySource: 'secret',
  envName: 'OPENAI_API_KEY',
  ...extra
})
const cli = api('claude', { preset: 'claude-code', provider: 'cli', effectiveBaseUrl: '', effectiveModel: '', keySource: 'subscription', envName: '' })

function host(profiles: ProfileView[], hookProfileId: string | null = null) {
  return mockHost({
    settings: { autoEnhanceMode: 'ai' },
    requests: {
      'models.get': { profiles, hookProfileId, selectorProfileId: null, fromEnv: false, presets: PRESETS },
      'targets.list': { targets: [] },
      'models.detect': { found: [] },
      'data.summary': { history: 0, profiles: profiles.length, keys: 0, catalogs: 0 }
    }
  })
}

test('AI auto-enhance with only a subscription CLI: the panel has no model to offer the hook, so it warns', async () => {
  const view = await mountPanel(host([cli]), { persisted: { plugin: { tab: 'privacy' } } })
  // The Settings section shows "Auto-enhance (AI) has no model to use" when this list is empty.
  assert.equal(read(defaults).autoEnhanceMode, 'ai')
  assert.deepEqual(hookModels(), [])
  assert.equal(hookChoice(), 'chain')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the hook model menu lists only enabled API models; a stored CLI choice shows as "Same as the chain"', async () => {
  const profiles = [api('fast'), api('slow'), api('off', { enabled: false }), cli]
  const view = await mountPanel(host(profiles, 'claude'), { persisted: { plugin: { tab: 'privacy' } } })
  assert.deepEqual(hookModels().map((profile) => profile.id), ['fast', 'slow'])
  assert.equal(hookChoice(), 'chain')
  await view.unmount()
  // A saved API model that can answer in time is the one shown; a disabled one is not.
  const saved = await mountPanel(host(profiles, 'slow'))
  assert.equal(hookChoice(), 'slow')
  await saved.unmount()
  const disabled = await mountPanel(host(profiles, 'off'))
  assert.equal(hookChoice(), 'chain')
  await disabled.unmount()
})

test('the worker never stores a CLI as the hook model and skips disabled ones', async () => {
  const stored = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, preset: 'openai', provider: 'openai', baseUrl: '', model: '', maxTokens: 2000, enabled: true, ...extra })
  const profiles = [stored('off', { enabled: false }), stored('claude', { preset: 'claude-code', provider: 'cli' })]
  const worker = await mountWorker(main, { host: mockHost({ storage: { models: { profiles, hookProfileId: 'off' } }, secrets: { 'apiKey.off': 'k' }, settings: { autoEnhanceMode: 'ai' } }) })
  const roles = await worker.request('models.roles', { hookProfileId: 'claude', selectorProfileId: 'claude' })
  assert.equal(roles.hookProfileId, null)
  assert.equal(roles.selectorProfileId, 'claude')
  // The hook model is disabled and the other is a CLI: nothing is called, the prompt passes unchanged.
  const event = { agent: 'claude', terminalId: 't1', prompt: 'add a login page', inputKind: 'launch' as const }
  assert.deepEqual(await worker.hooks.fire('agent.prompt.before', event), { kind: 'continue', event })
  assert.ok(worker.logs.some((line) => /no enabled API model/.test(line)), worker.logs.join('\n'))
  await worker.deactivate()
})

test('the AI rewrite reaches the terminal without control characters; an empty rewrite leaves the prompt as it was', async () => {
  const realFetch = globalThis.fetch
  let answer = ''
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 })) as typeof fetch
  try {
    const profile = { id: 'fast', name: 'fast', preset: 'openai', provider: 'openai', baseUrl: '', model: '', maxTokens: 2000, enabled: true }
    const host = mockHost({ storage: { models: { profiles: [profile] } }, secrets: { 'apiKey.fast': 'k' }, settings: { autoEnhanceMode: 'ai', autoEnhanceContext: false } })
    const worker = await mountWorker(main, { host })
    const event = { agent: 'claude', terminalId: 't1', prompt: 'add a login page', inputKind: 'launch' as const }

    // An escape sequence that would end a paste, a carriage return (Enter) and a bell, from the model.
    answer = 'Add a login page.\u001b[201~\r\nThen run the tests.\u0007\u009b31m'
    const rewritten = await worker.hooks.fire('agent.prompt.before', event)
    assert.deepEqual(rewritten, { kind: 'continue', event: { ...event, prompt: 'Add a login page.[201~\nThen run the tests.31m' } })

    // A rewrite that is nothing once its wrapping is removed: the prompt goes out as the person wrote it.
    answer = '```\n\n```'
    assert.deepEqual(await worker.hooks.fire('agent.prompt.before', event), { kind: 'continue', event })
    assert.ok(worker.logs.some((line) => /returned no prompt/.test(line)), worker.logs.join('\n'))
    // ...and no history entry is kept for it.
    const history = (host.data().storage.history ?? []) as { enhanced: string }[]
    assert.deepEqual(history.map((entry) => entry.enhanced), ['Add a login page.[201~\nThen run the tests.31m'])
    await worker.deactivate()
  } finally {
    globalThis.fetch = realFetch
  }
})
