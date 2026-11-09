// Your own rules and prompt structures: stored once, used by every run and by auto-enhance.
import { afterEach, assert, mockHost, mount, mountWorker, test, type MockRequests } from 'orca/testing'
import * as panel from './panel.tsx'
import { PRESETS } from './presets.ts'
import { buildSystemPrompt } from './prompts.ts'
import { parseRulesConfig, rulesFor, structureById, type RulesConfig } from './rules.ts'
import * as main from './worker.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const stored = {
  rules: [
    { id: 'r1', text: 'Always run pnpm test.', enabled: true, scope: '' },
    { id: 'r2', text: 'Use the design tokens in src/theme.', enabled: true, scope: 'web-app' },
    { id: 'r3', text: 'Disabled rule.', enabled: false, scope: '' },
    { id: 'BAD ID', text: 'dropped', enabled: true, scope: '' }
  ],
  structures: [{ id: 'mine', name: 'Mine', sections: ['Mục tiêu', '', 'Tiêu chí hoàn thành'] }]
}

test('rules apply by workspace and switch; structures are cleaned; unknown ids give none', () => {
  const config = parseRulesConfig(stored)
  assert.deepEqual(config.rules.map((rule) => rule.id), ['r1', 'r2', 'r3'])
  assert.deepEqual(rulesFor(config, 'web-app'), ['Always run pnpm test.', 'Use the design tokens in src/theme.'])
  assert.deepEqual(rulesFor(config, 'other'), ['Always run pnpm test.'])
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
    storage: { models: { profiles: [{ id: 'gpt', name: 'gpt', preset: 'openai', provider: 'openai', baseUrl: '', model: '', temperature: 0.3, maxTokens: 2000, enabled: true }] }, rules: stored },
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

let savedConfig: RulesConfig = { rules: [], structures: [] }
const requests: MockRequests = {
  'models.get': { profiles: [], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
  'targets.list': { targets: [], workspace: 'web-app' },
  'models.detect': { found: [] },
  'rules.get': () => savedConfig,
  // Slow on purpose: quick edits in a row must still all land.
  'rules.save': async ({ config }: { config: RulesConfig }) => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    savedConfig = parseRulesConfig(config)
    return savedConfig
  }
}


test('the Rules tab adds rules (for all or this workspace) and structures; the composer offers them', async () => {
  const host = mockHost({ requests })
  const view = await mount(panel, { host })
  await view.press({ role: 'button', label: 'Rules' })
  await view.type({ label: 'New rule' }, 'Always run pnpm test.')
  await view.press({ role: 'button', text: 'Add rule' })
  await view.type({ label: 'New rule' }, 'Use the design tokens.')
  await view.select({ label: 'Applies to' }, 'workspace')
  await view.press({ role: 'button', text: 'Add rule' })
  await view.type({ label: 'Structure name' }, 'Mine')
  await view.type({ label: 'Headings, one per line' }, '1. Mục tiêu\n- Tiêu chí hoàn thành\n')
  await view.press({ role: 'button', text: 'Add structure' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  const saved = savedConfig
  assert.deepEqual(saved.rules.map((rule) => [rule.text, rule.scope]), [['Always run pnpm test.', ''], ['Use the design tokens.', 'web-app']])
  assert.deepEqual(saved.structures[0].sections, ['Mục tiêu', 'Tiêu chí hoàn thành'])
  // Turning a rule off keeps it.
  await view.toggle({ label: 'Always run pnpm test.' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(savedConfig.rules[0].enabled, false)
  assert.equal(view.valueOf({ label: 'Always run pnpm test.' }), false)
  // The composer's options list the structures.
  await view.press({ role: 'button', label: 'Enhance' })
  if (!view.find({ label: 'Structure' })) await view.press({ role: 'button', label: /^Options/ })
  const select = view.find({ label: 'Structure' })
  assert.ok(select)
  const values = (select.props.options as { value: string }[]).map((option) => option.value)
  assert.deepEqual(values.slice(0, 3), ['style', 'brief', 'steps'])
  assert.ok(values.includes(saved.structures[0].id))
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
