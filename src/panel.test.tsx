// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel.tsx'
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
  const view = await mount(panel, { host })
  await view.type({ label: 'Your prompt' }, 'add tests')
  await view.press({ role: 'button', text: 'Enhance' })
  assert.equal(view.valueOf(view.find({ label: 'Enhanced prompt' })!), 'Better: add tests')
  assert.equal(enhanceInputs[0].level, 'standard')
  assert.ok(view.find({ text: /Fell back after: Down \(503: overloaded\)/ }))

  // Exclude the tree, enhance again: the worker is told.
  await view.toggle({ label: /^Context ·/ })
  await view.toggle({ label: 'Repository tree' })

  // The options button names the current choice.
  assert.equal(view.find({ role: 'button', text: 'Options' })!.props.tooltip, 'Options: Balanced · Standard')
  await view.press({ role: 'button', text: 'Enhance' })
  assert.deepEqual(enhanceInputs[1].exclude, ['tree'])

  await view.press({ role: 'button', text: 'Send' })
  assert.deepEqual(sent, [{ terminalId: 't1', text: 'Better: add tests', enter: false }])
  assert.ok(view.find({ text: /Sent to Claude/ }))
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
  const view = await mount(panel, { host })
  assert.ok(view.find({ label: 'No model yet' }) ?? view.find({ text: /No model yet/ }))
  await view.press({ role: 'button', label: 'Models' })
  await view.press({ role: 'button', text: 'Add model' })
  await view.select({ label: 'Preset' }, 'groq')
  await view.type({ label: 'API key' }, 'gsk-1')
  await view.press({ role: 'button', text: 'Save' })
  assert.equal(saved[0].preset, 'groq')
  assert.equal(saved[0].baseUrl, 'https://api.groq.com/openai/v1')
  assert.equal(saved[0].apiKey, 'gsk-1')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
