// What the manifest asks Orca for. Orca lets an update in by itself only when it asks for nothing the
// person has not approved; otherwise it shows "Update needs review" and installs nothing until they
// approve, so they get none of the version's fixes either. That happens for a new capability,
// command, panel, hook, event or status bar item, and for a new setting too: 2.6.1 added one switch
// to the settings and Orca answered "asks for more access: new settings".
//
// So a change to these lists is a decision, not a detail. A preference of the panel belongs in the
// panel's own state (a `persist: 'plugin'` atom) whenever it can live there. When the manifest has
// to grow, say in the changelog that Orca will ask to approve again (as 2.5.0 did), and then bring
// the list below up to date.
import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'

type Manifest = {
  execution: string
  capabilities: { kind: string }[]
  contributes: {
    panels: { id: string }[]
    commands: { id: string }[]
    statusBarItems: { id: string }[]
    hooks: { event: string }[]
    events: { on: string }[]
    settings: { key: string }[]
  }
}

const APPROVED = {
  execution: 'trusted-worker',
  capabilities: ['storage:own', 'settings:own', 'secrets:own', 'workspace:read', 'agent:read', 'terminal:send', 'terminal:read', 'agent:launch', 'workspace:write', 'notifications:show'],
  panels: ['enhance'],
  commands: ['panel.open', 'auto-enhance.cycle', 'auto-enhance.off', 'auto-enhance.rules', 'auto-enhance.ai', 'status-bar.toggle'],
  statusBarItems: ['auto-enhance'],
  hooks: ['agent.prompt.before', 'agent.tool.after', 'editor.save.before'],
  events: ['workspace.changed', 'agent.status.changed'],
  settings: [
    'uiLanguage',
    'statusBarItem',
    'defaultStyle',
    'outputLanguage',
    'customInstructions',
    'contextLevel',
    'terminalLines',
    'extraContextFiles',
    'excludePatterns',
    'adaptToAgent',
    'fallbackEnabled',
    'fallbackOn',
    'timeoutSeconds',
    'sendMode',
    'sendPressEnter',
    'historyLimit',
    'notifyWhenDone',
    'autoEnhanceMode',
    'autoEnhanceAppend',
    'autoEnhanceMinLength',
    'autoEnhanceContext',
    'allowProjectFiles',
    'allowGit',
    'allowTerminalRead',
    'allowOtherAgents',
    'otherAgentsMax',
    'otherAgentsLines',
    'allowAgentActivity',
    'allowEditorSaves',
    'allowTerminalSend',
    'allowAgentLaunch',
    'allowOpenFiles',
    'saveHistory',
    'allowEnvKeys',
    'allowOnlineModelLists'
  ]
}

test('the manifest asks Orca for nothing more than the released versions did (more makes every user approve the update again)', () => {
  const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8')) as Manifest
  const asked = {
    execution: manifest.execution,
    capabilities: manifest.capabilities.map((entry) => entry.kind),
    panels: manifest.contributes.panels.map((entry) => entry.id),
    commands: manifest.contributes.commands.map((entry) => entry.id),
    statusBarItems: manifest.contributes.statusBarItems.map((entry) => entry.id),
    hooks: manifest.contributes.hooks.map((entry) => entry.event),
    events: manifest.contributes.events.map((entry) => entry.on),
    settings: manifest.contributes.settings.map((entry) => entry.key)
  }
  assert.deepEqual(asked, APPROVED)
  // Nothing else is contributed that this test does not look at.
  assert.deepEqual(Object.keys(manifest.contributes).sort(), ['commands', 'events', 'hooks', 'panels', 'settings', 'statusBarItems'])
})
