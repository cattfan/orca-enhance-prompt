// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses. The panel's
// state and actions run here without anything drawn (src/panel/testing.ts): what the web panel's
// buttons call is called directly, and what it shows is read from the state.
import { read } from 'orca'
import { assert, mockHost, test } from 'orca/testing'
import { applyPreset, enhanceNow, openForm, patchForm, saveForm, send, toggleItem } from './panel/actions.ts'
import { contextShown, draft, enabledProfiles, form, lastRun, notice, put, result } from './panel/state.ts'
import { mountPanel } from './panel/testing.ts'
import { modelWarning, optionsSummary } from './panel/view.ts'
import { PRESETS, type ProfileView } from './presets.ts'
import type { ModelsView, ProfileInput } from './protocol.ts'

const gpt: ProfileView = {
  id: 'gpt',
  name: 'OpenAI',
  preset: 'openai',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
  temperature: 0.3,
  maxTokens: 2000,
  enabled: true,
  command: '',
  args: '',
  keySource: 'secret',
  envName: 'OPENAI_API_KEY',
  effectiveBaseUrl: 'https://api.openai.com/v1',
  effectiveModel: 'gpt-4.1-mini'
}
const modelsView = (profiles: ProfileView[]): ModelsView => ({ profiles, hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS })

test('enhances with context, then sends to the chosen agent', async () => {
  const sent: { terminalId: string; text: string }[] = []
  const enhanceInputs: { level?: string; exclude?: string[] }[] = []
  const host = mockHost({
    requests: {
      'models.get': modelsView([gpt]),
      'targets.list': { targets: [{ terminalId: 't1', label: 'Claude · waiting', agent: 'claude' }] },
      'prompt.enhance': (input) => {
        enhanceInputs.push(input)
        return {
          enhanced: `Better: ${input.prompt}`,
          model: 'gpt-4.1-mini',
          profileName: 'OpenAI',
          ms: 1200,
          attempts: [
            { profileId: 'x', name: 'Down', model: 'm', ok: false, error: '503: overloaded', ms: 10 },
            { profileId: 'gpt', name: 'OpenAI', model: 'gpt-4.1-mini', ok: true, ms: 1100 }
          ],
          context: [
            { id: 'rules:AGENTS.md', kind: 'rules', label: 'AGENTS.md', chars: 120 },
            { id: 'tree', kind: 'tree', label: 'Repository tree', chars: 800 }
          ],
          notes: []
        }
      },
      'prompt.send': (input) => {
        sent.push(input)
        return { accepted: true }
      }
    }
  })
  const view = await mountPanel(host)
  assert.equal(modelWarning(), null)
  put(draft, 'add tests')
  await enhanceNow()
  assert.equal(read(result), 'Better: add tests')
  assert.equal(enhanceInputs[0].level, 'standard')
  // The model that failed first stays with the result (the card says "Fell back after: …").
  assert.deepEqual(
    read(lastRun)?.attempts.filter((attempt) => !attempt.ok).map((attempt) => `${attempt.name} (${attempt.error})`),
    ['Down (503: overloaded)']
  )
  assert.deepEqual(read(contextShown).map((item) => item.id), ['rules:AGENTS.md', 'tree'])

  // Untick the tree, enhance again: the worker is told, and the item stays listed (unticked).
  toggleItem('tree', false)
  // The options button names the current choice.
  assert.equal(optionsSummary(), 'Balanced · Standard')
  await enhanceNow()
  assert.deepEqual(enhanceInputs[1].exclude, ['tree'])
  assert.deepEqual(read(contextShown).map((item) => item.id), ['rules:AGENTS.md', 'tree'])

  await send(read(result))
  assert.deepEqual(sent, [{ terminalId: 't1', text: 'Better: add tests', enter: false }])
  assert.deepEqual(read(notice), { tone: 'success', text: 'Sent to Claude · waiting.' })
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('warns when no model is configured, and adds one from the Models tab', async () => {
  const saved: ProfileInput[] = []
  const host = mockHost({
    requests: {
      'models.get': modelsView([]),
      'targets.list': { targets: [] },
      'models.save': (input) => {
        saved.push(input)
        return modelsView([{ ...gpt, ...input, id: 'new', keySource: 'secret', envName: 'GROQ_API_KEY' }])
      }
    }
  })
  const view = await mountPanel(host)
  assert.equal(modelWarning(), 'no-model')
  // Add model: pick the Groq preset, type its key, Save.
  openForm()
  applyPreset('groq')
  patchForm({ apiKey: 'gsk-1' })
  await saveForm()
  assert.equal(saved[0].preset, 'groq')
  assert.equal(saved[0].baseUrl, 'https://api.groq.com/openai/v1')
  assert.equal(saved[0].apiKey, 'gsk-1')
  // The form closes, the model is there and the warning is gone.
  assert.equal(read(form), null)
  assert.deepEqual(read(enabledProfiles).map((profile) => profile.id), ['new'])
  assert.equal(modelWarning(), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('an enabled model without a key warns about the key, not about a missing model', async () => {
  const host = mockHost({ requests: { 'models.get': modelsView([{ ...gpt, keySource: 'none' }]), 'targets.list': { targets: [] } } })
  const view = await mountPanel(host)
  assert.equal(modelWarning(), 'no-key')
  await view.unmount()
})
