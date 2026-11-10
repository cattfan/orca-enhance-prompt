// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses. The panel's
// state and actions run here without anything drawn (src/panel/testing.ts): what the web panel's
// buttons call is called directly, and what it shows is read from the state.
import { read, set } from 'orca'
import { assert, mockHost, test } from 'orca/testing'
import { attachmentItemId } from './image-limits.ts'
import { applyPreset, closeFeedback, enhanceNow, openForm, patchForm, removeFile, saveForm, send, sendFeedback, toggleItem } from './panel/actions.ts'
import { contextShown, draft, enabledProfiles, excluded, feedbackAsk, feedbackShown, files, form, lastRun, notice, put, result } from './panel/state.ts'
import { mountPanel } from './panel/testing.ts'
import { FEEDBACK_EVERY_DAYS, FEEDBACK_FIRST_RUNS, feedbackDue, ISSUES_URL, modelWarning, optionsSummary } from './panel/view.ts'
import { PRESETS, type ProfileView } from './presets.ts'
import type { ModelsView, ProfileInput } from './protocol.ts'

const gpt: ProfileView = {
  id: 'gpt',
  name: 'OpenAI',
  preset: 'openai',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
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

test('an attached text can be unticked like any context item, and leaves the list when its file is removed', async () => {
  const log = { path: '/tmp/enhance-prompt-attachments/att-abc123/build.log', name: 'build.log', bytes: 30, type: 'text/plain' }
  // A second file of the same name (another folder's build.log): its own item.
  const other = { path: 'C:\\Temp\\enhance-prompt-attachments\\att-def456\\build.log', name: 'build.log', bytes: 40, type: 'text/plain' }
  const inputs: { files?: string[]; exclude?: string[] }[] = []
  const host = mockHost({
    requests: {
      'models.get': modelsView([gpt]),
      'targets.list': { targets: [] },
      'prompt.enhance': (input) => {
        inputs.push(input)
        const attached = (input.files ?? []).map((path) => ({ id: attachmentItemId(path), kind: 'file', label: 'build.log', chars: 30 }))
        return {
          enhanced: 'Better',
          model: 'gpt-4.1-mini',
          profileName: 'OpenAI',
          ms: 10,
          attempts: [],
          // As the worker answers: an unticked item is not in the context of the run.
          context: [...attached, { id: 'tree', kind: 'tree', label: 'Repository tree', chars: 800 }].filter((item) => !(input.exclude ?? []).includes(item.id)),
          notes: []
        }
      }
    }
  })
  const view = await mountPanel(host)
  put(files, [log, other])
  put(draft, 'fix the build')
  await enhanceNow()
  assert.deepEqual(inputs[0].files, [log.path, other.path])
  assert.deepEqual(read(contextShown).map((item) => item.id), ['attach:att-abc123/build.log', 'attach:att-def456/build.log', 'tree'])

  // Unticked: the worker is told to leave its text out, and the item stays listed to tick again.
  toggleItem('attach:att-abc123/build.log', false)
  await enhanceNow()
  assert.deepEqual(inputs[1].exclude, ['attach:att-abc123/build.log'])
  assert.deepEqual(inputs[1].files, [log.path, other.path])
  assert.deepEqual(read(contextShown).map((item) => item.id).sort(), ['attach:att-abc123/build.log', 'attach:att-def456/build.log', 'tree'])

  // The file is removed: its item goes with it (nothing left to tick), the other build.log stays.
  removeFile(log.path)
  assert.deepEqual(read(files), [other])
  assert.deepEqual(read(contextShown).map((item) => item.id).sort(), ['attach:att-def456/build.log', 'tree'])
  assert.deepEqual(read(excluded), [])
  await enhanceNow()
  assert.deepEqual(inputs[2].files, [other.path])
  assert.deepEqual(inputs[2].exclude, [])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a note asks for ideas and feedback now and then: after the fifth enhanced prompt, then at most once in 14 days', async () => {
  const DAY = 24 * 3600_000
  let fail = false
  const host = mockHost({
    requests: {
      'models.get': modelsView([gpt]),
      'targets.list': { targets: [] },
      'prompt.enhance': (input) => {
        if (fail) throw Object.assign(new Error('All models failed.'), { code: 'action_failed' })
        return { enhanced: `Better: ${input.prompt}`, model: 'gpt-4.1-mini', profileName: 'OpenAI', ms: 10, attempts: [], context: [], notes: [] }
      }
    }
  })
  const view = await mountPanel(host)
  put(draft, 'add tests')
  assert.deepEqual(read(feedbackAsk), { runs: 0, shownAt: 0 })

  // The first four prompts are counted and nothing shows; a run that fails is not counted.
  for (let prompts = 1; prompts <= 4; prompts++) {
    await enhanceNow()
    assert.equal(read(feedbackShown), false, `shown after ${prompts} prompts`)
  }
  fail = true
  await enhanceNow()
  fail = false
  assert.deepEqual(read(feedbackAsk), { runs: 4, shownAt: 0 })

  // The fifth: the note shows, and when it did is kept across panel runs.
  const before = Date.now()
  await enhanceNow()
  assert.equal(read(feedbackShown), true)
  const first = read(feedbackAsk)
  assert.equal(first.runs, 5)
  assert.ok(first.shownAt >= before && first.shownAt <= Date.now())
  await view.settled()
  assert.deepEqual(view.persisted.plugin.feedbackAsk, first)

  // The next prompt takes the note away. It stays away, and prompts are no longer counted.
  await enhanceNow()
  assert.equal(read(feedbackShown), false)
  assert.deepEqual(read(feedbackAsk), first)

  // Thirteen days after it showed: still quiet. Fourteen: it shows again, from then on.
  set(feedbackAsk, { runs: 5, shownAt: Date.now() - 13 * DAY })
  await enhanceNow()
  assert.equal(read(feedbackShown), false)
  set(feedbackAsk, { runs: 5, shownAt: Date.now() - 14 * DAY - 1000 })
  await enhanceNow()
  assert.equal(read(feedbackShown), true)
  assert.ok(Date.now() - read(feedbackAsk).shownAt < 5000)
  // A run that fails takes it away too, and does not bring it back.
  fail = true
  await enhanceNow()
  fail = false
  assert.equal(read(feedbackShown), false)

  // Its close button hides it; its Send feedback button opens the plugin's issue page.
  set(feedbackShown, true)
  closeFeedback()
  assert.equal(read(feedbackShown), false)
  set(feedbackShown, true)
  await sendFeedback()
  assert.equal(read(feedbackShown), false)
  assert.deepEqual(host.callsOf('shell.openExternal'), [{ url: ISSUES_URL }])

  // The rule itself: a clock set back does not silence the note for good.
  const now = Date.now()
  assert.equal(feedbackDue({ runs: FEEDBACK_FIRST_RUNS - 1, shownAt: 0 }, now), false)
  assert.equal(feedbackDue({ runs: FEEDBACK_FIRST_RUNS, shownAt: 0 }, now), true)
  assert.equal(feedbackDue({ runs: 5, shownAt: now - FEEDBACK_EVERY_DAYS * DAY + 60_000 }, now), false)
  assert.equal(feedbackDue({ runs: 5, shownAt: now - FEEDBACK_EVERY_DAYS * DAY }, now), true)
  assert.equal(feedbackDue({ runs: 5, shownAt: now + DAY }, now), false)
  assert.equal(feedbackDue({ runs: 5, shownAt: now + 30 * DAY }, now), true)
  assert.deepEqual(view.errors, [])
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
