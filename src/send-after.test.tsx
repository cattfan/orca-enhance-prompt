// "Send right after enhancing" (a switch of the panel's own, off until confirmed) and saving as a
// file, with nothing drawn (src/panel/testing.ts). The one-step send types a prompt nobody has read
// into an agent, so what matters most here is every case in which it must not.
import { Button, read, set } from 'orca'
import { assert, mockHost, mount, test, type MockHost } from 'orca/testing'
import { clearData, enhanceAndSend, enhanceOrSend, exportHistory, savePrompt, sendsAfterEnhance, setSendAfterEnhance } from './panel/actions.ts'
import { draft, historyFilter, notice, put, result, sendAfterEnhance, target, type Target } from './panel/state.ts'
import { closePanel, wirePanel } from './panel/setup.ts'
import { mountPanel } from './panel/testing.ts'
import { DISCLOSURES, exportName, fenced, historyMarkdown, SEND_AFTER_ROW, stamp, switchRow } from './panel/view.ts'
import { PRESETS } from './presets.ts'
import type { HistoryEntry } from './history.ts'

const models = { profiles: [], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS }
const answer = (enhanced: string) => ({ enhanced, model: 'm', profileName: 'P', ms: 900, attempts: [], context: [], notes: [] })
const agent = (state: string, terminalId = 't1'): Target => ({ terminalId, label: `Claude · ${state}`, agent: 'claude', title: 'Claude', state })

/**
 * A panel in project Shop (workspace w1) with one idle agent. `place` is what `targets.list`
 * answers and `during` runs while the model writes: a test changes either to say what happened
 * meanwhile.
 */
async function panel(options: { settings?: Record<string, boolean>; fail?: boolean } = {}) {
  const sent: { terminalId: string; text: string }[] = []
  const world = {
    place: { targets: [agent('waiting')], workspace: 'main', project: 'Shop', workspaceId: 'w1' } as { targets: Target[]; workspace: string | null; project: string | null; workspaceId?: string },
    during: () => undefined as void,
    /** Runs each time the panel reads the terminals. */
    listed: () => undefined as void,
    runs: 0
  }
  const host = mockHost({
    settings: options.settings ?? {},
    requests: {
      'models.get': models,
      'targets.list': () => {
        world.listed()
        return world.place
      },
      'prompt.enhance': (input) => {
        world.runs += 1
        world.during()
        if (options.fail) throw new Error('the model failed')
        return answer(`Better: ${input.prompt}`)
      },
      'prompt.send': (input) => {
        sent.push({ terminalId: input.terminalId, text: input.text })
        return { accepted: true }
      },
      'data.clear': { ok: true },
      'data.summary': { history: 0, profiles: 0, keys: 0, catalogs: 0 }
    }
  })
  const view = await mountPanel(host)
  set(sendAfterEnhance, false)
  put(draft, 'fix the login page')
  put(result, '')
  return { view, host, sent, world }
}

test('the one-step send is off until it is turned on; on, Ctrl+Enter enhances and sends the run\'s answer to an idle agent', async () => {
  const { view, sent, world } = await panel()
  // Off (the default): Ctrl+Enter stops at the result, as it always did.
  assert.equal(read(sendAfterEnhance), false)
  assert.equal(sendsAfterEnhance(), false)
  await enhanceOrSend()
  assert.equal(world.runs, 1)
  assert.equal(read(result), 'Better: fix the login page')
  assert.deepEqual(sent, [])
  // The explicit action is a plain enhance too while the switch is off.
  put(result, '')
  await enhanceAndSend()
  assert.equal(world.runs, 2)
  assert.deepEqual(sent, [])

  // On: one press enhances and sends, to the terminal that was picked, the text the run answered.
  setSendAfterEnhance(true)
  put(draft, 'fix the signup page')
  await enhanceOrSend()
  assert.equal(world.runs, 3)
  assert.deepEqual(sent, [{ terminalId: 't1', text: 'Better: fix the signup page' }])
  assert.equal(read(notice)?.tone, 'success')
  // An agent that has finished its task is idle too.
  world.place = { ...world.place, targets: [agent('done')] }
  put(draft, 'fix the cart page')
  await enhanceAndSend()
  assert.equal(sent.length, 2)
  assert.deepEqual(view.errors, [])
  set(sendAfterEnhance, false)
  await view.unmount()
})

test('the one-step send holds back, and says why, whenever the agent is not idle', async () => {
  const { view, sent, world } = await panel()
  setSendAfterEnhance(true)
  const cases: [string, Target, RegExp][] = [
    ['working', agent('working'), /Claude is still working\./],
    ['waiting for an answer', agent('blocked'), /Claude is waiting for an answer from you\./],
    ['a state Orca did not give', { terminalId: 't1', label: 'Claude', agent: 'claude' }, /Orca does not say whether claude is idle\./],
    ['a plain terminal', { terminalId: 't1', label: 'pwsh', agent: null }, /plain terminal, not an agent/]
  ]
  for (const [name, item, why] of cases) {
    // Idle when the run starts, and this by the time it is over: the state is read after the run.
    world.place = { ...world.place, targets: [agent('waiting')] }
    put(draft, `fix it (${name})`)
    world.during = () => {
      world.place = { ...world.place, targets: [item] }
    }
    await enhanceAndSend()
    assert.deepEqual(sent, [], name)
    assert.equal(read(notice)?.tone, 'warning', name)
    assert.match(read(notice)?.text ?? '', why, name)
    assert.match(read(notice)?.text ?? '', /^Not sent by itself\..*Read the prompt and send it yourself\.$/, name)
    // The result is there to be read and sent by hand.
    assert.equal(read(result), `Better: fix it (${name})`, name)
  }
  assert.deepEqual(view.errors, [])
  set(sendAfterEnhance, false)
  await view.unmount()
})

test('the one-step send holds back when the terminal, the project or the text is not what it was at the start', async () => {
  const { view, sent, world } = await panel()
  setSendAfterEnhance(true)
  const start = { ...world.place }

  // The terminal closed while the model wrote.
  world.during = () => {
    world.place = { ...start, targets: [agent('waiting', 't2')] }
  }
  await enhanceAndSend()
  assert.deepEqual(sent, [])
  assert.match(read(notice)?.text ?? '', /closed or no longer the one picked/)

  // Another terminal was picked meanwhile: the prompt was written for the first one.
  world.place = { ...start, targets: [agent('waiting'), agent('waiting', 't2')] }
  set(target, 't1')
  world.during = () => set(target, 't2')
  put(draft, 'fix it (other terminal)')
  await enhanceAndSend()
  assert.deepEqual(sent, [])
  assert.match(read(notice)?.text ?? '', /closed or no longer the one picked/)

  // The person went on typing: the result is no longer for what the composer holds.
  world.place = start
  set(target, 't1')
  world.during = () => put(draft, 'fix it, and also the footer')
  put(draft, 'fix it (edited)')
  await enhanceAndSend()
  assert.deepEqual(sent, [])
  assert.match(read(notice)?.text ?? '', /text changed while it ran/)

  // The focus moved to another project: its terminals are not this prompt's.
  world.during = () => {
    world.place = { targets: [agent('waiting', 't9')], workspace: 'main', project: 'Blog', workspaceId: 'w2' }
  }
  put(draft, 'fix it (moved)')
  await enhanceAndSend()
  assert.deepEqual(sent, [])
  assert.match(read(notice)?.text ?? '', /project in focus changed/)
  assert.deepEqual(view.errors, [])
  set(sendAfterEnhance, false)
  await view.unmount()
})

test('the one-step send never sends while Orca cannot tell which project this is', async () => {
  const { view, sent, world } = await panel()
  // Several projects share this name and branch, so the panel knows this one by its name only.
  world.place = { targets: [agent('waiting')], workspace: 'main', project: null }
  const { refreshTargets } = await import('./panel/actions.ts')
  await refreshTargets()
  setSendAfterEnhance(true)
  put(draft, 'fix the login page')
  await enhanceAndSend()
  assert.deepEqual(sent, [])
  assert.match(read(notice)?.text ?? '', /could not tell which project/)
  // Orca learnt which project it is while the run went: still not sent, since the terminal was
  // picked before that was known.
  world.during = () => {
    world.place = { targets: [agent('waiting')], workspace: 'main', project: 'Shop', workspaceId: 'w1' }
  }
  put(draft, 'fix the signup page')
  await enhanceAndSend()
  assert.deepEqual(sent, [])
  assert.match(read(notice)?.text ?? '', /could not tell which project/)
  assert.deepEqual(view.errors, [])
  set(sendAfterEnhance, false)
  await view.unmount()
})

test('the one-step send needs "Send to terminals", sends nothing after a failed run, and goes with Delete everything', async () => {
  const off = await panel({ settings: { allowTerminalSend: false } })
  setSendAfterEnhance(true)
  assert.equal(read(sendAfterEnhance), true)
  // The switch it depends on is off: it is a plain enhance, and no send is even asked for.
  assert.equal(sendsAfterEnhance(), false)
  await enhanceAndSend()
  assert.equal(read(result), 'Better: fix the login page')
  assert.deepEqual(off.sent, [])
  assert.deepEqual(off.view.errors, [])
  set(sendAfterEnhance, false)
  await off.view.unmount()

  const failing = await panel({ fail: true })
  setSendAfterEnhance(true)
  await enhanceAndSend()
  assert.deepEqual(failing.sent, [])
  assert.equal(read(result), '')
  // Delete everything withdraws the confirmation with the others.
  await clearData('all')
  assert.equal(read(sendAfterEnhance), false)
  await failing.view.unmount()
})

test('the one-step send stops when the person stops it after the model has answered, and with no project at all', async () => {
  const { view, sent, world } = await panel()
  setSendAfterEnhance(true)
  const { cancel, refreshTargets } = await import('./panel/actions.ts')

  // The switch is turned off while the model writes: the run ends as a plain enhance, with no note.
  world.during = () => setSendAfterEnhance(false)
  await enhanceAndSend()
  assert.deepEqual(sent, [])
  assert.equal(read(result), 'Better: fix the login page')
  assert.notEqual(read(notice)?.tone, 'warning')

  // Cancel (or the panel closing) once the model has answered, while the terminals are read again:
  // there is no request left to stop, and still nothing goes out.
  setSendAfterEnhance(true)
  let answered = false
  world.during = () => {
    answered = true
  }
  // The read of the terminals that follows the model's answer is where the cancel falls.
  world.listed = () => {
    if (answered) cancel()
  }
  put(draft, 'fix the signup page')
  await enhanceAndSend()
  assert.deepEqual(sent, [])
  assert.equal(read(result), 'Better: fix the signup page')
  world.listed = () => undefined

  // A later run is not held back by that cancel.
  world.during = () => undefined
  put(draft, 'fix the cart page')
  await enhanceAndSend()
  assert.deepEqual(sent, [{ terminalId: 't1', text: 'Better: fix the cart page' }])
  sent.length = 0

  // Orca lists the terminals but names no workspace: there is no project to be sure of.
  world.place = { targets: [agent('waiting')], workspace: null, project: null }
  await refreshTargets()
  put(draft, 'fix the footer')
  await enhanceAndSend()
  assert.deepEqual(sent, [])
  assert.match(read(notice)?.text ?? '', /could not tell which project/)
  assert.deepEqual(view.errors, [])
  set(sendAfterEnhance, false)
  await view.unmount()
})

test('the one-step send goes to an idle agent Orca lists without its kind, and never to a row that is no agent', async () => {
  const { view, sent, world } = await panel()
  setSendAfterEnhance(true)
  const { refreshTargets } = await import('./panel/actions.ts')
  // Orca knows an agent runs there and that it waits, but not which CLI it is.
  world.place = { ...world.place, targets: [{ terminalId: 't1', label: 'Agent · waiting', agent: null, title: 'Agent', state: 'waiting' }] }
  await refreshTargets()
  await enhanceAndSend()
  assert.deepEqual(sent, [{ terminalId: 't1', text: 'Better: fix the login page' }])
  // No kind and no state: a terminal with no agent in it.
  world.place = { ...world.place, targets: [{ terminalId: 't1', label: 'pwsh', agent: null }] }
  await refreshTargets()
  put(draft, 'fix the signup page')
  await enhanceAndSend()
  assert.equal(sent.length, 1)
  assert.match(read(notice)?.text ?? '', /pwsh is a plain terminal, not an agent/)
  assert.deepEqual(view.errors, [])
  set(sendAfterEnhance, false)
  await view.unmount()
})

test('the switch is described like the others: what it does, what can go wrong, when to turn it on', () => {
  assert.equal(switchRow('sendAfterEnhance'), SEND_AFTER_ROW)
  assert.equal(switchRow('allowGit')?.key, 'allowGit')
  assert.equal(switchRow('nothing'), null)
  assert.equal(SEND_AFTER_ROW.group, 'acts')
  for (const text of [SEND_AFTER_ROW.hint, SEND_AFTER_ROW.risk, SEND_AFTER_ROW.when]) assert.ok(text.length > 60)
  // Its dialog names every condition under which it sends, and what happens otherwise.
  const points = (DISCLOSURES.sendAfterEnhance ?? []).join(' ')
  for (const word of ['still open', 'which project', 'idle', 'did not change the text', 'nothing is sent', 'Send to terminals']) assert.ok(points.includes(word), word)
})

// ---------------------------------------------------------------- saving as a file

const entry = (id: string, original: string, enhanced: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  at: new Date(2026, 10, 13, 9, 5).getTime(),
  original,
  enhanced,
  style: 'balanced',
  model: 'sonnet',
  source: 'panel',
  ...extra
})

test('a saved history is one Markdown document whose code blocks hold the texts as they are', () => {
  assert.equal(stamp(new Date(2026, 0, 2, 3, 4).getTime()), '2026-01-02 03:04')
  assert.equal(exportName('history', new Date(2026, 10, 13, 14, 5).getTime()), 'enhance-prompt-history-2026-11-13-1405.md')
  assert.equal(exportName('prompt', new Date(2026, 10, 13, 14, 5).getTime()), 'prompt-2026-11-13-1405.md')
  // A text with a code fence of its own gets a longer fence around it.
  assert.equal(fenced('plain'), '```text\nplain\n```')
  assert.equal(fenced('run:\n```sh\nnpm test\n```'), '````text\nrun:\n```sh\nnpm test\n```\n````')
  const text = historyMarkdown(
    [entry('h1', 'fix login', '## Goal\nFix the login page.', { project: 'Shop' }), entry('h2', 'tidy', 'Tidy up.', { source: 'hook', style: 'concise' })],
    new Date(2026, 10, 13, 14, 5).getTime()
  )
  assert.match(text, /^# Enhance Prompt: History\n\nSaved 2026-11-13 14:05 · 2 prompts\n/)
  assert.ok(text.includes('## 2026-11-13 09:05 · Shop · Balanced · sonnet\n\n### Your prompt\n\n```text\nfix login\n```\n\n### Enhanced prompt\n\n```text\n## Goal\nFix the login page.\n```'))
  // An entry of auto-enhance says so; one without a project has no empty place for it.
  assert.ok(text.includes('## 2026-11-13 09:05 · Concise · sonnet · auto\n'))
  assert.ok(text.endsWith('```\n'))
})

/**
 * The panel with the two Save buttons drawn, each calling its action at once: Orca opens its save
 * dialog only from a press, and the test host refuses the call the same way without one.
 */
async function panelWithSaveButtons(host: MockHost, prompt: () => string) {
  const view = await mount(
    {
      setup: () => {
        const stop = wirePanel()
        return () => {
          closePanel()
          stop()
        }
      },
      default: () => (
        <>
          <Button onPress={() => void savePrompt(prompt())}>Save prompt</Button>
          <Button onPress={() => void exportHistory()}>Save history</Button>
        </>
      )
    },
    { host }
  )
  await view.settled()
  return view
}

test('Save as a file offers the prompt, or the history the list shows, in Orca\'s save dialog', async () => {
  const host = mockHost({
    storage: { history: [entry('h1', 'fix login', 'Fix the login page.'), entry('h2', 'tidy the cart', 'Tidy the cart.')] },
    results: { 'files.saveAs': { status: 'saved' } },
    requests: { 'models.get': models, 'targets.list': { targets: [] } }
  })
  let prompt = 'Fix the login page.'
  const view = await panelWithSaveButtons(host, () => prompt)
  await view.press({ text: 'Save prompt' })
  let saved = host.callsOf('files.saveAs') as { suggestedName: string; mimeType: string; data: string }[]
  assert.equal(saved.length, 1)
  assert.match(saved[0].suggestedName, /^prompt-\d{4}-\d\d-\d\d-\d{4}\.md$/)
  assert.equal(saved[0].mimeType, 'text/markdown')
  assert.equal(saved[0].data, 'Fix the login page.\n')
  assert.deepEqual(read(notice), { tone: 'success', text: 'Saved as a file.' })
  // Nothing to save: no dialog.
  prompt = '   '
  await view.press({ text: 'Save prompt' })
  assert.equal(host.callsOf('files.saveAs').length, 1)

  // The search applies: what the list shows is what goes into the file.
  set(historyFilter, 'cart')
  await view.press({ text: 'Save history' })
  saved = host.callsOf('files.saveAs') as typeof saved
  assert.equal(saved.length, 2)
  assert.match(saved[1].suggestedName, /^enhance-prompt-history-/)
  assert.ok(saved[1].data.includes('tidy the cart'))
  assert.ok(!saved[1].data.includes('fix login'))
  assert.match(saved[1].data, / · 1 prompts\n/)
  // A search that finds nothing saves nothing.
  set(historyFilter, 'no such prompt')
  await view.press({ text: 'Save history' })
  assert.equal(host.callsOf('files.saveAs').length, 2)
  set(historyFilter, '')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a save the person cancels says nothing, and one Orca refuses says so', async () => {
  const cancelled = mockHost({ results: { 'files.saveAs': { status: 'cancelled' } }, requests: { 'models.get': models, 'targets.list': { targets: [] } } })
  const pressed = await panelWithSaveButtons(cancelled, () => 'Fix the login page.')
  set(notice, null)
  await pressed.press({ text: 'Save prompt' })
  assert.equal(cancelled.callsOf('files.saveAs').length, 1)
  assert.equal(read(notice), null)
  await pressed.unmount()

  // No press came first (as when Orca's dialog cannot open): the host refuses the call.
  const refused = mockHost({ requests: { 'models.get': models, 'targets.list': { targets: [] } } })
  const view = await mountPanel(refused)
  await savePrompt('Fix the login page.')
  assert.deepEqual(read(notice), { tone: 'danger', text: 'The file could not be saved.' })
  await view.unmount()
})
