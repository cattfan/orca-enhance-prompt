// Auto-enhance (AI): only models that can answer within the hook's 2 s are offered, and the panel
// says so when there is none.
import { assert, mockHost, mount, mountWorker, test } from 'orca/testing'
import * as panel from './panel.tsx'
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
  temperature: 0.3,
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

test('AI auto-enhance with only a subscription CLI: the panel warns instead of staying silent', async () => {
  const view = await mount(panel, { host: host([cli]), persisted: { plugin: { tab: 'privacy' } } })
  assert.ok(view.find({ label: 'Auto-enhance (AI) has no model to use' }) ?? view.find({ text: /no model to use/ }))
  assert.equal(view.find({ label: 'Auto-enhance hook model (needs to answer in under 2 s)' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the hook model menu lists only enabled API models; a stored CLI choice shows as "Same as the chain"', async () => {
  const profiles = [api('fast'), api('slow'), api('off', { enabled: false }), cli]
  const view = await mount(panel, { host: host(profiles, 'claude'), persisted: { plugin: { tab: 'privacy' } } })
  const select = view.find({ label: 'Auto-enhance hook model (needs to answer in under 2 s)' })
  assert.ok(select)
  const options = (select.props.options as { value: string }[]).map((option) => option.value)
  assert.deepEqual(options, ['chain', 'fast', 'slow'])
  assert.equal(view.valueOf(select), 'chain')
  assert.equal(view.find({ text: /no model to use/ }), null)
  await view.unmount()
})

test('the worker never stores a CLI as the hook model and skips disabled ones', async () => {
  const stored = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, preset: 'openai', provider: 'openai', baseUrl: '', model: '', temperature: 0.3, maxTokens: 2000, enabled: true, ...extra })
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
