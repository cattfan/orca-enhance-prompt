// What the panel does around sending and the history, with nothing drawn (src/panel/testing.ts):
// a notice that carries a button (Undo, send anyway), Ctrl+Enter, an agent that is waiting for an
// answer, and the history by project.
import { read, set } from 'orca'
import { assert, mockHost, test } from 'orca/testing'
import { changeUiLanguage, enhanceNow, enhanceOrSend, refreshTargets, removeEntry, reuse, runNoticeAction, send } from './panel/actions.ts'
import { busy, contextShown, draft, filteredHistory, history, historyByProject, historyOpen, historyScope, lastRun, notice, put, result, resultFor, tab, targets } from './panel/state.ts'
import { mountPanel } from './panel/testing.ts'
import { targetLabel } from './panel/view.ts'
import { msg, withMessage } from './messages.ts'
import { PRESETS } from './presets.ts'
import type { HistoryEntry } from './history.ts'

const models = { profiles: [], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS }
const answer = (enhanced: string) => ({ enhanced, model: 'm', profileName: 'P', ms: 900, attempts: [], context: [], notes: [] })
const entry = (id: string, original: string, project?: string): HistoryEntry => ({
  id,
  at: Date.now() - Number(id.slice(1)) * 60_000,
  original,
  enhanced: `Better: ${original}`,
  style: 'balanced',
  model: 'm',
  source: 'panel',
  ...(project ? { project } : {})
})

test('Ctrl+Enter sends the result while it is the one for what the composer holds, and enhances otherwise', async () => {
  const sent: { text: string; enter?: boolean }[] = []
  let runs = 0
  const host = mockHost({
    requests: {
      'models.get': models,
      'targets.list': { targets: [{ terminalId: 't1', label: 'Claude · waiting', agent: 'claude', title: 'Claude', state: 'waiting' }], workspace: 'main', project: 'Shop', workspaceId: 'w1' },
      'prompt.enhance': (input) => {
        runs += 1
        return answer(`Better ${runs}: ${input.prompt}`)
      },
      'prompt.send': (input) => {
        sent.push({ text: input.text, ...(input.enter === undefined ? {} : { enter: input.enter }) })
        return { accepted: true }
      }
    }
  })
  const view = await mountPanel(host)
  put(draft, 'fix the login page')
  // Nothing to send yet: it enhances.
  await enhanceOrSend()
  assert.equal(runs, 1)
  assert.equal(read(result), 'Better 1: fix the login page')
  assert.equal(sent.length, 0)
  // The result is in front of the person and belongs to this text: it is sent, as it reads now.
  put(result, 'Better 1: fix the login page (edited)')
  await enhanceOrSend()
  assert.deepEqual(sent.map((item) => item.text), ['Better 1: fix the login page (edited)'])
  assert.equal(runs, 1)
  // The request changed: the result on screen is not for it, so nothing old is sent.
  put(draft, 'fix the signup page')
  await enhanceOrSend()
  assert.equal(runs, 2)
  assert.equal(sent.length, 1)
  assert.equal(read(resultFor), 'fix the signup page')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('an agent waiting for an answer is not typed into unasked: the notice offers to type without Enter', async () => {
  const calls: { force?: boolean; enter?: boolean }[] = []
  const blocked = Object.assign(new Error('blocked'), { code: 'conflict', text: msg('error.agent_blocked', { name: 'Claude' }) })
  const host = mockHost({
    settings: { uiLanguage: 'vi' },
    requests: {
      'models.get': models,
      'targets.list': { targets: [{ terminalId: 't1', label: 'Claude · blocked', agent: 'claude', title: 'Claude', state: 'blocked' }], workspace: 'main', project: 'Shop', workspaceId: 'w1' },
      'prompt.send': (input) => {
        calls.push({ ...(input.force ? { force: true } : {}), ...(input.enter === undefined ? {} : { enter: input.enter }) })
        if (!input.force) throw blocked
        return { accepted: true }
      }
    }
  })
  const view = await mountPanel(host)
  // The picker words an agent's state in the panel's language.
  assert.equal(targetLabel(read(targets)[0]), 'Claude · cần bạn')
  await send('Do the thing')
  const asked = read(notice)
  assert.equal(asked?.tone, 'warning')
  assert.match(asked?.text ?? '', /Claude đang chờ bạn trả lời/)
  assert.deepEqual(asked?.action?.run, { kind: 'send.anyway', terminalId: 't1', text: 'Do the thing' })
  // The person presses the button: now it is typed, and the worker is told they were asked.
  await runNoticeAction(asked!.action!.run)
  assert.deepEqual(calls.map((call) => call.force ?? false), [false, true])
  assert.match(read(notice)?.text ?? '', /không nhấn Enter/)
  // A terminal that closed meanwhile gets nothing.
  set(targets, [])
  await runNoticeAction({ kind: 'send.anyway', terminalId: 't1', text: 'Do the thing' })
  assert.equal(calls.length, 2)
  assert.deepEqual(view.errors, [])
  await changeUiLanguage('en')
  await view.unmount()
})

test('a history entry removed by mistake comes back with Undo', async () => {
  const asked: string[] = []
  const host = mockHost({
    storage: { history: [entry('h1', 'one'), entry('h2', 'two')] },
    requests: {
      'models.get': models,
      'targets.list': { targets: [] },
      'history.remove': (input) => {
        asked.push(`remove ${input.id}`)
        return { ok: true as const }
      },
      'history.restore': (input) => {
        asked.push(`restore ${input.id}`)
        return { restored: input.id === 'h1' }
      }
    }
  })
  const view = await mountPanel(host)
  set(historyOpen, 'h1')
  await removeEntry('h1')
  assert.equal(read(historyOpen), null)
  const undo = read(notice)?.action
  assert.deepEqual(undo?.run, { kind: 'history.restore', id: 'h1' })
  await runNoticeAction(undo!.run)
  assert.deepEqual(asked, ['remove h1', 'restore h1'])
  assert.equal(read(notice)?.tone, 'success')
  // Too late (the worker keeps a removed entry for a minute only): it says so.
  await runNoticeAction({ kind: 'history.restore', id: 'h9' })
  assert.equal(read(notice)?.tone, 'warning')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('opening a history entry replaces the composer, says so, and Undo brings the composer back', async () => {
  const host = mockHost({
    requests: {
      'models.get': models,
      'targets.list': { targets: [], workspace: 'main', project: 'Shop', workspaceId: 'w1' },
      'prompt.enhance': (input) => answer(`Better: ${input.prompt}`)
    }
  })
  const view = await mountPanel(host)
  // An empty composer: nothing is lost, so nothing is said.
  reuse(entry('h3', 'older request', 'Shop'))
  assert.equal(read(notice), null)
  assert.equal(read(tab), 'enhance')
  // What the composer said about its last run was about another prompt.
  assert.equal(read(lastRun), null)
  assert.deepEqual(read(contextShown), [])

  put(draft, 'my unsent draft')
  await enhanceNow()
  assert.equal(read(result), 'Better: my unsent draft')
  set(notice, null)
  reuse(entry('h4', 'from the history', 'Shop'))
  assert.equal(read(draft), 'from the history')
  const replaced = read(notice)
  assert.equal(replaced?.tone, 'neutral')
  assert.deepEqual(replaced?.action?.run, { kind: 'composer.restore' })
  await runNoticeAction(replaced!.action!.run)
  assert.equal(read(draft), 'my unsent draft')
  assert.equal(read(result), 'Better: my unsent draft')

  // Written in another project: it is about to be sent in this one, so it says where it is from.
  set(notice, null)
  reuse(entry('h5', 'deploy the billing service', 'Billing'))
  assert.equal(read(notice)?.tone, 'warning')
  assert.match(read(notice)?.text ?? '', /written in Billing: read it before you send it here/)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the history shows every project, or only the one in focus', async () => {
  const stored = [entry('h1', 'shop one', 'Shop'), entry('h2', 'billing one', 'Billing'), entry('h3', 'shop two', 'Shop'), entry('h4', 'before projects were kept')]
  const host = mockHost({
    storage: { history: stored },
    requests: { 'models.get': models, 'targets.list': { targets: [], workspace: 'main', project: 'Shop', workspaceId: 'w1' } }
  })
  const view = await mountPanel(host)
  assert.equal(read(history).length, 4)
  assert.equal(read(historyByProject), true)
  assert.equal(read(filteredHistory).length, 4)
  set(historyScope, 'project')
  assert.deepEqual(read(filteredHistory).map((item) => item.id), ['h1', 'h3'])
  set(historyScope, 'all')
  await view.unmount()

  // Where Orca cannot tell which project is open, there is nothing to narrow to: everything shows.
  const unknown = mockHost({ storage: { history: stored }, requests: { 'models.get': models, 'targets.list': { targets: [], workspace: 'main', project: null } } })
  const second = await mountPanel(unknown)
  set(historyScope, 'project')
  assert.equal(read(historyByProject), false)
  assert.equal(read(filteredHistory).length, 4)
  set(historyScope, 'all')
  await second.unmount()
})

test('in the real Orca a refusal comes as a code and a text only: the blocked agent is still recognised', async () => {
  // Orca passes on no other field of a thrown error (AGENTS.md): the message travels inside the text.
  const wire = Object.assign(new Error(withMessage(msg('error.agent_blocked', { name: 'Claude' }))), { code: 'conflict' })
  const host = mockHost({
    requests: {
      'models.get': models,
      'targets.list': { targets: [{ terminalId: 't1', label: 'Claude · blocked', agent: 'claude', title: 'Claude', state: 'blocked' }] },
      'prompt.send': () => {
        throw wire
      }
    }
  })
  const view = await mountPanel(host)
  await send('Do the thing')
  assert.equal(read(notice)?.action?.run.kind, 'send.anyway')
  assert.equal(read(notice)?.text, 'Claude is waiting for an answer from you, and what is typed now could be taken as that answer.')
  // Pressed while a run is going: it says so, and types nothing.
  set(busy, 'enhance')
  await runNoticeAction({ kind: 'send.anyway', terminalId: 't1', text: 'Do the thing' })
  assert.match(read(notice)?.text ?? '', /still running/)
  set(busy, null)
  await view.unmount()
})

test('Ctrl+Enter never sends what belongs to another project or was opened from one', async () => {
  const sent: string[] = []
  let focus = { workspace: 'main', project: 'Shop', workspaceId: 'w-shop' }
  const host = mockHost({
    requests: {
      'models.get': models,
      'targets.list': () => ({ targets: [{ terminalId: 't1', label: 'Claude · waiting', agent: 'claude', title: 'Claude', state: 'waiting' }], ...focus }),
      'prompt.enhance': (input) => answer(`Better: ${input.prompt}`),
      'prompt.send': (input) => {
        sent.push(input.text)
        return { accepted: true }
      }
    }
  })
  const view = await mountPanel(host)
  // In Shop: a result for "fix tests", then the request is retyped, so that result is not for it.
  put(draft, 'fix tests')
  await enhanceNow()
  put(draft, 'fix the failing tests')
  // In Reup the same words are enhanced.
  focus = { workspace: 'main', project: 'Reup', workspaceId: 'w-reup' }
  await refreshTargets()
  put(draft, 'fix the failing tests')
  await enhanceNow()
  assert.equal(read(resultFor), 'fix the failing tests')
  // Back in Shop: its composer holds the old result, and what Reup's result was made from says
  // nothing here. Ctrl+Enter enhances; the old prompt is not sent.
  focus = { workspace: 'main', project: 'Shop', workspaceId: 'w-shop' }
  await refreshTargets()
  assert.equal(read(draft), 'fix the failing tests')
  assert.equal(read(result), 'Better: fix tests')
  assert.equal(read(resultFor), null)
  await enhanceOrSend()
  assert.deepEqual(sent, [])
  assert.equal(read(result), 'Better: fix the failing tests')

  // An entry written in another project is opened here: one Ctrl+Enter must not send it unread.
  reuse(entry('h7', 'deploy the billing service', 'Billing'))
  assert.equal(read(resultFor), null)
  await enhanceOrSend()
  assert.deepEqual(sent, [])
  // An entry of this project is the person's own choice, in front of them: Ctrl+Enter sends it.
  reuse(entry('h8', 'add a coupon field', 'Shop'))
  await enhanceOrSend()
  assert.deepEqual(sent, ['Better: add a coupon field'])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
