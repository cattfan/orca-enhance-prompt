// The composer's model menu: every model of every enabled profile, like the menu in ChatGPT or Claude.
import { assert, mockHost, mount, mountWorker, test } from 'orca/testing'
import * as panel from './panel'
import { PRESETS, type ProfileView } from './presets'
import * as main from './worker'

const claude: ProfileView = {
  id: 'claude',
  name: 'Claude Code',
  preset: 'claude-code',
  provider: 'cli',
  baseUrl: '',
  model: 'haiku',
  temperature: 0.3,
  maxTokens: 2000,
  enabled: true,
  command: '',
  args: '',
  keySource: 'subscription',
  envName: ''
}
const codex: ProfileView = { ...claude, id: 'codex', name: 'Codex', preset: 'codex', model: '' }

test('lists each model of each profile and sends the one you pick', async () => {
  const sent: { profileId?: string | null; model?: string }[] = []
  const host = mockHost({
    requests: {
      'models.get': { profiles: [claude, codex], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
      'targets.list': { targets: [] },
      'models.detect': { found: [] },
      'models.catalog': ({ preset }: { preset: string }) => ({
        models:
          preset === 'claude-code'
            ? [
                { id: 'haiku', label: 'haiku: Haiku, newest (fastest)' },
                { id: 'sonnet', label: 'sonnet: Sonnet, newest', isDefault: true },
                { id: 'opus', label: 'opus: Opus, newest' }
              ]
            : [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' }],
        source: 'test',
        fetchedAt: 1
      }),
      'prompt.enhance': (input) => {
        sent.push(input)
        return { enhanced: 'ok', model: input.model ?? 'haiku', profileName: 'Claude Code', ms: 1, attempts: [], context: [], notes: [] }
      }
    }
  })
  const view = await mount(panel, { host })
  const menu = view.find({ label: 'Model', type: 'Select' })!
  const labels = (menu.props.options as { label: string }[]).map((option) => option.label)
  assert.deepEqual(labels, [
    'Auto (chain with fallback)',
    'Claude Code · Haiku, newest (fastest) · default',
    'Claude Code · Sonnet, newest',
    'Claude Code · Opus, newest',
    'Codex · CLI default',
    'Codex · GPT-6.1-Sol'
  ])

  await view.select(menu, 'claude|opus')
  await view.type({ label: 'Your prompt' }, 'fix it')
  await view.press({ role: 'button', text: 'Enhance' })
  assert.equal(sent[0].profileId, 'claude')
  assert.equal(sent[0].model, 'opus')

  // The profile's own model is sent as no override, so editing the profile later still applies.
  await view.select({ label: 'Model', type: 'Select' }, 'claude|haiku')
  await view.press({ role: 'button', text: 'Enhance' })
  assert.equal(sent[1].model, undefined)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the worker runs the picked model on the picked profile only', async () => {
  const calls: { url: string; model: string }[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    calls.push({ url: String(url), model: body.model })
    return new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] }), { status: 200 })
  }) as typeof fetch
  try {
    const profile = { id: 'oa', name: 'OpenAI', preset: 'openai', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', temperature: 0.3, maxTokens: 2000, enabled: true, command: '', args: '' }
    const host = mockHost({ storage: { models: { profiles: [profile] } }, secrets: { 'apiKey.oa': 'k' }, results: { 'workspace.readContext': null } })
    const worker = await mountWorker(main, { host })
    const answer = await worker.request('prompt.enhance', { prompt: 'x y z', level: 'off', profileId: 'oa', model: 'gpt-4.1' })
    assert.equal(calls[0].model, 'gpt-4.1')
    assert.equal(answer.model, 'gpt-4.1')
    // Saved profile untouched.
    const view = await worker.request('models.get')
    assert.equal(view.profiles[0].model, 'gpt-4.1-mini')
    await worker.deactivate()
  } finally {
    globalThis.fetch = realFetch
  }
})
