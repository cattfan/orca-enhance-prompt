// The composer's model menu: every model of every enabled profile, like the menu in ChatGPT or Claude.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { enhanceNow } from './panel/actions.ts'
import { draft, put } from './panel/state.ts'
import { mountPanel } from './panel/testing.ts'
import { currentModelValue, modelMenu, pickModel } from './panel/view.ts'
import { PRESETS, type ProfileView } from './presets.ts'
import * as main from './worker.ts'

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
  envName: '',
  effectiveBaseUrl: '',
  effectiveModel: 'haiku'
}
const codex: ProfileView = { ...claude, id: 'codex', name: 'Codex', preset: 'codex', model: '', effectiveModel: '' }

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
                { id: 'claude-opus-5-5', label: 'Opus 5.5', description: 'For complex work and everyday tasks' },
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
  const view = await mountPanel(host)
  assert.deepEqual(
    modelMenu().map((option) => option.label),
    [
      'Auto (fallback)',
      'Claude Code · Opus 5.5',
      'Claude Code · haiku (latest) · default',
      'Claude Code · sonnet (latest)',
      'Claude Code · opus (latest)',
      'Codex · CLI default',
      'Codex · GPT-6.1-Sol'
    ]
  )
  // Nothing picked yet: Auto, and no profile or model is named in the request.
  assert.equal(currentModelValue(), 'auto')

  pickModel('claude|claude-opus-5-5')
  assert.equal(currentModelValue(), 'claude|claude-opus-5-5')
  put(draft, 'fix it')
  await enhanceNow()
  assert.equal(sent.at(-1)?.model, 'claude-opus-5-5')

  pickModel('claude|opus')
  await enhanceNow()
  assert.equal(sent.at(-1)?.profileId, 'claude')
  assert.equal(sent.at(-1)?.model, 'opus')

  // The profile's own model is sent as no override, so editing the profile later still applies.
  pickModel('claude|haiku')
  assert.equal(currentModelValue(), 'claude|haiku')
  await enhanceNow()
  assert.equal(sent.at(-1)?.profileId, 'claude')
  assert.equal(sent.at(-1)?.model, undefined)

  // Back to Auto: the chain decides, no profile is forced.
  pickModel('auto')
  await enhanceNow()
  assert.equal(sent.at(-1)?.profileId, null)
  assert.equal(sent.at(-1)?.model, undefined)
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
