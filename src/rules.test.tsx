// Your own rules and prompt structures: stored once, used by every run and by auto-enhance.
import { read, set } from 'orca'
import { afterEach, assert, mockHost, mountWorker, test, type MockRequests } from 'orca/testing'
import { addRule, addStructure, saveRules } from './panel/actions.ts'
import { ruleDraft, ruleScope, structureDraft } from './panel/state.ts'
import { mountPanel } from './panel/testing.ts'
import { newRuleLabel, rulesConfig, rulesHere, ruleScopeLabel, structureOptions } from './panel/view.ts'
import { PRESETS } from './presets.ts'
import { buildSystemPrompt } from './prompts.ts'
import { forgetTerminals } from './context/terminals.ts'
import { parseRulesConfig, projectScope, ruleApplies, rulesFor, scopeName, structureById, type RulesConfig } from './rules.ts'
import * as main from './worker.ts'

const realFetch = globalThis.fetch
afterEach(async () => {
  globalThis.fetch = realFetch
  await forgetTerminals()
})

const stored = {
  rules: [
    { id: 'r1', text: 'Always run pnpm test.', enabled: true, scope: '' },
    { id: 'r2', text: 'Use the design tokens in src/theme.', enabled: true, scope: 'web-app' },
    { id: 'r3', text: 'Disabled rule.', enabled: false, scope: '' },
    { id: 'r4', text: 'Keep the uploader idempotent.', enabled: true, scope: 'project:Reup' },
    { id: 'BAD ID', text: 'dropped', enabled: true, scope: '' }
  ],
  structures: [{ id: 'mine', name: 'Mine', sections: ['Mục tiêu', '', 'Tiêu chí hoàn thành'] }]
}

test('a rule is followed everywhere, in its own project, or (saved before 2.6.5) in workspaces of its name', () => {
  const config = parseRulesConfig(stored)
  assert.deepEqual(config.rules.map((rule) => rule.id), ['r1', 'r2', 'r3', 'r4'])
  // The project Reup, whatever Orca calls its workspace: its own rule, and the one for every project.
  assert.deepEqual(rulesFor(config, { workspace: 'main', project: 'Reup' }), ['Always run pnpm test.', 'Keep the uploader idempotent.'])
  assert.deepEqual(rulesFor(config, { workspace: 'feature-x', project: 'Reup' }), ['Always run pnpm test.', 'Keep the uploader idempotent.'])
  // Another project whose workspace is "main" as well: Reup's rule stays out of it.
  assert.deepEqual(rulesFor(config, { workspace: 'main', project: 'Shop' }), ['Always run pnpm test.'])
  // Not known which of the "main" projects this is: no project's own rule is followed.
  assert.deepEqual(rulesFor(config, { workspace: 'main', project: null }), ['Always run pnpm test.'])
  assert.deepEqual(rulesFor(config, { workspace: null, project: null }), ['Always run pnpm test.'])
  // A rule saved before 2.6.5 is kept under a workspace's name: followed there as it always was,
  // and not in a project that merely has that name.
  assert.deepEqual(rulesFor(config, { workspace: 'web-app', project: 'Web' }), ['Always run pnpm test.', 'Use the design tokens in src/theme.'])
  assert.deepEqual(rulesFor(config, { workspace: 'main', project: 'web-app' }), ['Always run pnpm test.'])
  assert.ok(!ruleApplies({ scope: 'project:Reup' }, { workspace: 'Reup', project: 'Shop' }))
  // How a scope is written and shown.
  assert.equal(projectScope(' Reup '), 'project:Reup')
  assert.equal(scopeName('project:Reup'), 'Reup')
  assert.equal(scopeName('web-app'), 'web-app')
  assert.equal(projectScope('x'.repeat(400)).length, 200)
  assert.deepEqual(structureById(config, 'mine')?.sections, ['Mục tiêu', 'Tiêu chí hoàn thành'])
  assert.equal(structureById(config, 'brief')?.name, 'Task brief')
  assert.equal(structureById(config, 'gone'), null)
  assert.deepEqual(parseRulesConfig(null), { rules: [], structures: [] })
})

test('the system prompt: a structure replaces the style shape, rules are listed last and win', () => {
  const system = buildSystemPrompt({ style: 'concise', language: 'vi', rules: ['Always run pnpm test.'], structure: { name: 'Mine', sections: ['Mục tiêu', 'Tiêu chí hoàn thành'] } })
  assert.match(system, /under exactly these headings, in this order:\n1\. Mục tiêu\n2\. Tiêu chí hoàn thành/)
  assert.ok(!/tight, unambiguous prompt/.test(system), 'the concise shape should be replaced')
  assert.match(system, /Rules from the user \(always follow them; they win over the shape above\):\n- Always run pnpm test\./)
  assert.match(buildSystemPrompt({ style: 'concise', language: 'auto' }), /tight, unambiguous prompt/)
})

function workerHost(workspace: string) {
  return mockHost({
    storage: { models: { profiles: [{ id: 'gpt', name: 'gpt', preset: 'openai', provider: 'openai', baseUrl: '', model: '', maxTokens: 2000, enabled: true }] }, rules: stored },
    secrets: { 'apiKey.gpt': 'k' },
    settings: { autoEnhanceMode: 'ai' },
    results: { 'workspace.readContext': { branch: 'main', displayName: workspace, terminals: [] }, 'agents.list': { agents: [] } }
  })
}

test('a run uses the rules of the focused workspace and the picked structure; auto-enhance uses the rules', async () => {
  const systems: string[] = []
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    systems.push(JSON.parse(String(init?.body)).messages[0].content)
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
  }) as typeof fetch
  const worker = await mountWorker(main, { host: workerHost('web-app') })
  await worker.request('prompt.enhance', { prompt: 'add a page', level: 'off', structureId: 'mine' })
  assert.match(systems[0], /Use the design tokens in src\/theme\./)
  assert.match(systems[0], /1\. Mục tiêu/)
  assert.ok(!systems[0].includes('Disabled rule.'))
  await worker.hooks.fire('agent.prompt.before', { agent: 'claude', terminalId: 't1', prompt: 'add a login page please', inputKind: 'launch' })
  assert.match(systems[1], /Always run pnpm test\./)
  await worker.deactivate()

  const other = await mountWorker(main, { host: workerHost('api') })
  await other.request('prompt.enhance', { prompt: 'add a page', level: 'off' })
  assert.ok(!systems[2].includes('design tokens'))
  await other.deactivate()
})

test('two projects whose workspaces are both "main": a run follows the rules of its own project only', async () => {
  const systems: string[] = []
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    systems.push(JSON.parse(String(init?.body)).messages[0].content)
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
  }) as typeof fetch
  const rules = {
    rules: [
      { id: 'all', text: 'Rule for every project.', enabled: true, scope: '' },
      { id: 'reup', text: 'Rule of Reup.', enabled: true, scope: 'project:Reup' },
      { id: 'shop', text: 'Rule of Shop.', enabled: true, scope: 'project:Shop' },
      // Saved before 2.6.5 in one of the "main" projects: kept under the workspace's name.
      { id: 'old', text: 'Older rule kept under main.', enabled: true, scope: 'main' }
    ],
    structures: []
  }
  // As the real Orca answers: the focus has a name and a branch only; the list names each worktree
  // "identity:…" with its project; an agent event names its workspace "<repository id>::<path>".
  const host = mockHost({
    storage: { models: { profiles: [{ id: 'gpt', name: 'gpt', preset: 'openai', provider: 'openai', baseUrl: '', model: '', maxTokens: 2000, enabled: true }] }, rules },
    secrets: { 'apiKey.gpt': 'k' },
    settings: { autoEnhanceMode: 'ai' },
    results: {
      'workspace.readContext': { branch: 'main', displayName: 'main', terminals: [{ id: 'term_a', title: 'Claude' }] },
      'workspace.list': {
        workspaces: [
          { id: 'identity:wt2:local:1111', kind: 'worktree', name: 'main', project: 'Shop', path: 'C:/work/shop', branch: 'main', hostId: 'local' },
          { id: 'identity:wt2:local:2222', kind: 'worktree', name: 'main', project: 'Reup', path: 'C:/work/reup', branch: 'main', hostId: 'local' }
        ],
        truncated: false
      },
      'agents.list': { agents: [] }
    }
  })
  const worker = await mountWorker(main, { host })
  const followed = (system: string) => rules.rules.map((rule) => rule.text).filter((text) => system.includes(text))
  const EVERY = 'Rule for every project.'
  const OLD = 'Older rule kept under main.'
  // Not known which "main" this is: no project's own rule is followed (the older one still is).
  assert.equal((await worker.request('targets.list', {})).project, null)
  await worker.request('prompt.enhance', { prompt: 'add a page', level: 'off' })
  assert.deepEqual(followed(systems[0]), [EVERY, OLD])
  // The panel knows it (the folder the person picked): that project's rule.
  await worker.request('prompt.enhance', { prompt: 'add a page', level: 'off', workspaceId: 'identity:wt2:local:1111' })
  assert.deepEqual(followed(systems[1]), [EVERY, 'Rule of Shop.', OLD])
  // Orca says the agent's terminal is in the other one: its rule, in a run and in auto-enhance.
  await worker.emit('agent.status.changed', { workspaceId: 'repo-reup::C:\\work\\reup', paneKey: 'p', terminalId: 'term_a', state: 'done', receivedAt: Date.now() })
  assert.equal((await worker.request('targets.list', {})).project, 'Reup')
  await worker.request('prompt.enhance', { prompt: 'add a page', level: 'off' })
  assert.deepEqual(followed(systems[2]), [EVERY, 'Rule of Reup.', OLD])
  await worker.hooks.fire('agent.prompt.before', { agent: 'claude', terminalId: 'term_a', prompt: 'add a login page please', inputKind: 'launch' })
  assert.deepEqual(followed(systems[3]), [EVERY, 'Rule of Reup.', OLD])
  await worker.deactivate()
})

let savedConfig: RulesConfig = { rules: [], structures: [] }
/** What the worker says about the focused workspace: its name, and its project's (null: not known which project). */
let focus: { workspace: string; project: string | null } = { workspace: 'main', project: 'Web' }
const requests: MockRequests = {
  'models.get': { profiles: [], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
  'targets.list': () => ({ targets: [], workspace: focus.workspace, project: focus.project }),
  'models.detect': { found: [] },
  'rules.get': () => savedConfig,
  // Slow on purpose: quick edits in a row must still all land.
  'rules.save': async ({ config }: { config: RulesConfig }) => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    savedConfig = parseRulesConfig(config)
    return savedConfig
  }
}


test('the Rules tab adds rules (for every project or this one) and structures; the composer offers them', async () => {
  savedConfig = { rules: [], structures: [] }
  focus = { workspace: 'main', project: 'Web' }
  const host = mockHost({ requests })
  const view = await mountPanel(host)
  // Three quick edits in a row: each is shown at once and all of them land.
  set(ruleDraft, 'Always run pnpm test.')
  addRule()
  set(ruleDraft, 'Use the design tokens.')
  set(ruleScope, 'workspace')
  addRule()
  set(structureDraft, { name: 'Mine', sections: '1. Mục tiêu\n- Tiêu chí hoàn thành\n' })
  addStructure()
  assert.equal(read(ruleDraft), '')
  await new Promise((resolve) => setTimeout(resolve, 100))
  const saved = savedConfig
  // The second one is kept under the project's name, not under the workspace's ("main" in every project).
  assert.deepEqual(saved.rules.map((rule) => [rule.text, rule.scope]), [['Always run pnpm test.', ''], ['Use the design tokens.', 'project:Web']])
  assert.deepEqual(saved.structures[0].sections, ['Mục tiêu', 'Tiêu chí hoàn thành'])
  // Turning a rule off keeps it.
  saveRules((current) => ({ ...current, rules: current.rules.map((rule) => (rule.text === 'Always run pnpm test.' ? { ...rule, enabled: false } : rule)) }))
  assert.equal(rulesConfig().rules[0].enabled, false)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(savedConfig.rules[0].enabled, false)
  assert.equal(savedConfig.rules.length, 2)
  // The composer's options list the structures: by style, the built-in ones, then yours.
  const values = structureOptions().map((option) => option.value)
  assert.deepEqual(values.slice(0, 3), ['style', 'brief', 'steps'])
  assert.ok(values.includes(saved.structures[0].id))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the Rules tab shows the rules followed in this project, and says where a new one goes', async () => {
  savedConfig = parseRulesConfig({
    rules: [
      { id: 'all', text: 'Rule for every project.', enabled: true, scope: '' },
      { id: 'reup', text: 'Rule of Reup.', enabled: true, scope: 'project:Reup' },
      { id: 'shop', text: 'Rule of Shop.', enabled: false, scope: 'project:Shop' },
      { id: 'old', text: 'Older rule kept under main.', enabled: true, scope: 'main' }
    ],
    structures: []
  })
  // Several projects are "main" and nothing says which one is open yet.
  focus = { workspace: 'main', project: null }
  const host = mockHost({ requests })
  const view = await mountPanel(host)
  const shown = () => rulesHere().map((rule) => [rule.id, ruleScopeLabel(rule)])
  // No project's own rule is listed; a rule added now is for every project, and the composer says so.
  assert.deepEqual(shown(), [['all', 'everywhere'], ['old', 'Only main']])
  assert.equal(newRuleLabel(), 'Every project')
  set(ruleDraft, 'Added before the project was known.')
  set(ruleScope, 'workspace')
  addRule()
  assert.equal(rulesConfig().rules.at(-1)?.scope, '')
  // Orca (or the person's pick) says it is Reup: its rules, a paused one of another project stays hidden.
  focus = { workspace: 'main', project: 'Reup' }
  await view.emit('workspace.changed', { context: { branch: 'main', displayName: 'main', terminals: [] } })
  await view.settled()
  assert.deepEqual(shown().map(([id]) => id), ['all', 'reup', 'old', rulesConfig().rules.at(-1)?.id])
  assert.equal(ruleScopeLabel({ scope: 'project:Reup' }), 'Only Reup')
  assert.equal(newRuleLabel(), 'Only Reup')
  set(ruleDraft, 'Added in Reup.')
  set(ruleScope, 'workspace')
  addRule()
  assert.equal(rulesConfig().rules.at(-1)?.scope, 'project:Reup')
  // The same panel in the other "main" project: Reup's rules are not listed there.
  focus = { workspace: 'main', project: 'Shop' }
  await view.emit('workspace.changed', { context: { branch: 'main', displayName: 'main', terminals: [] } })
  await view.settled()
  assert.ok(!shown().some(([id]) => id === 'reup') && !rulesHere().some((rule) => rule.text === 'Added in Reup.'))
  assert.ok(shown().some(([id]) => id === 'shop'))
  assert.equal(newRuleLabel(), 'Only Shop')
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('rules.save cleans what it stores and keeps saves in order', async () => {
  const host = workerHost('web-app')
  const worker = await mountWorker(main, { host })
  const one = { rules: [{ id: 'a', text: ' first ', enabled: true, scope: '' }], structures: [] }
  const two = { rules: [...one.rules, { id: 'b', text: 'second', enabled: false, scope: 'web-app' }], structures: [{ id: 's', name: 'S', sections: ['x', ''] }] }
  const [, last] = await Promise.all([worker.request('rules.save', { config: one }), worker.request('rules.save', { config: two })])
  assert.deepEqual(last.rules.map((rule) => rule.text), ['first', 'second'])
  assert.deepEqual(parseRulesConfig(host.data().storage.rules as never), last)
  assert.deepEqual(await worker.request('rules.get'), last)
  await worker.deactivate()
})

test('Delete everything also deletes your rules and structures', async () => {
  const host = workerHost('web-app')
  const worker = await mountWorker(main, { host })
  await worker.request('data.clear', { what: 'all' })
  assert.equal(host.data().storage.rules, undefined)
  await worker.deactivate()
})
