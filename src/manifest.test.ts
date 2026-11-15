// What the manifest asks Orca for. Orca lets an update in by itself only when it asks for nothing the
// person has not approved; otherwise it shows "Update needs review" and installs nothing until they
// approve, so they get none of the version's fixes either.
//
// What counts as "more" is in Orca's source (src/shared/plugins/approval/plugin-update-access-growth.ts):
// every entry of the new manifest must be one the installed manifest already had, where
// - a capability is compared whole;
// - a panel by its id (its title and icon may change);
// - a command by its id, action, scope and what it replaces (its title may change);
// - every other entry, a setting, a status bar item, a hook or an event, by its whole JSON.
//
// So it is not only a new setting that asks again (2.6.1 added one switch and Orca answered "asks
// for more access: new settings"): rewording a setting's description, changing its default, or
// giving the status bar item another text or icon is, to Orca, a new entry too. Those entries are
// frozen below, each by a fingerprint of exactly what Orca compares. What the status bar item shows
// is set at run time instead (statusBar.update in src/worker.ts), and a preference of the panel
// lives in the panel's own state (a `persist: 'plugin'` atom).
//
// When an entry has to change or the manifest has to grow, that is a decision: say in the changelog
// that Orca will ask to approve again (as 2.5.0 did), then bring the fingerprints up to date.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'

type Entry = Record<string, unknown>
type Manifest = { execution: string; capabilities: Entry[]; contributes: Record<string, Entry[]> }

/** The same in every release from 2.5.0 on (2.6.1 alone had one setting more). */
const APPROVED: Record<string, Record<string, string>> = {
  capabilities: {
    'storage:own': '87183943d062', 'settings:own': 'c603840cc04e', 'secrets:own': '7cf0ad208a06', 'workspace:read': '600a46242b91',
    'agent:read': '367587ef7cc7', 'terminal:send': 'ff99a24d243a', 'terminal:read': 'a89bfccb5896', 'agent:launch': 'dae10027d59a',
    'workspace:write': '8c66a26cd0de', 'notifications:show': '5a9dc937db35'
  },
  panels: { enhance: 'by id' },
  commands: {
    'panel.open': 'bbc03e98c0c8', 'auto-enhance.cycle': 'ee0dddaf04d5', 'auto-enhance.off': '6135908e6bbf', 'auto-enhance.rules': '7212ad87d2f3',
    'auto-enhance.ai': 'c90dd80814f8', 'status-bar.toggle': 'e61c196b1e59'
  },
  statusBarItems: { 'auto-enhance': '9937f30ecb45' },
  hooks: { 'agent.prompt.before': '9ae9367d7cbc', 'agent.tool.after': '72ad837d1088', 'editor.save.before': 'b5340a7b03fa' },
  events: { 'workspace.changed': '5630f913aa4e', 'agent.status.changed': '19cd2cd9f0f0' },
  settings: {
    uiLanguage: 'e295e4ea7487', statusBarItem: '571cdb383aa2', defaultStyle: '4369b1374e9f', outputLanguage: 'e81656cb1a85',
    customInstructions: 'fbb1f8727c66', contextLevel: 'f5a62b67c4d1', terminalLines: '477455e916de', extraContextFiles: '204c6516c5de',
    excludePatterns: '50a17aeb0ced', adaptToAgent: '6389029954f7', fallbackEnabled: '8eaaa9e05243', fallbackOn: '2febe871960d',
    timeoutSeconds: 'ae1cdf5f21ed', sendMode: 'd15bf2d2281a', sendPressEnter: '6d1a43715235', historyLimit: '57be090e4de9',
    notifyWhenDone: 'c3e2238cb683', autoEnhanceMode: 'eb1aaa2cb8f0', autoEnhanceAppend: 'eb267c00e498', autoEnhanceMinLength: '0ff71f03d06b',
    autoEnhanceContext: '30b9af1cf073', allowProjectFiles: '1c355d4c161c', allowGit: '78b95179ad8f', allowTerminalRead: 'c299ff41449f',
    allowOtherAgents: '27d3ae474b85', otherAgentsMax: '0d497af48ab7', otherAgentsLines: 'b8d2b32f6969', allowAgentActivity: 'cd0c7ea876f9',
    allowEditorSaves: 'a3cf5962ea3f', allowTerminalSend: 'bbd2e8cb7f74', allowAgentLaunch: '8ebc3a828750', allowOpenFiles: '846a9e3f2835',
    saveHistory: '70903e149c53', allowEnvKeys: 'a5d705df4400', allowOnlineModelLists: '8f4d7ae0e93c'
  }
}

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12)
const nameOf = (entry: Entry) => String(entry.id ?? entry.key ?? entry.event ?? entry.on ?? entry.kind)

/** Each entry by what Orca compares of it (see the top of this file). */
function identities(manifest: Manifest): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = { capabilities: {} }
  for (const capability of manifest.capabilities) out.capabilities[nameOf(capability)] = fingerprint(capability)
  for (const [point, entries] of Object.entries(manifest.contributes)) {
    out[point] = {}
    for (const entry of entries) {
      if (point === 'panels') out[point][nameOf(entry)] = 'by id'
      else if (point === 'commands') out[point][nameOf(entry)] = fingerprint([entry.id ?? null, entry.action ?? null, entry.when ?? 'global', ...(entry.replaces === undefined ? [] : [entry.replaces])])
      else out[point][nameOf(entry)] = fingerprint(entry)
    }
  }
  return out
}

test('the manifest asks Orca for nothing the released versions did not: no new entry, and no changed one (either makes every user approve the update again)', () => {
  const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8')) as Manifest
  assert.equal(manifest.execution, 'trusted-worker')
  const now = identities(manifest)
  // Nothing else is contributed that this test does not look at.
  assert.deepEqual(Object.keys(now).sort(), Object.keys(APPROVED).sort())
  for (const [point, approved] of Object.entries(APPROVED)) {
    const added = Object.keys(now[point]).filter((name) => !(name in approved))
    const changed = Object.keys(now[point]).filter((name) => name in approved && now[point][name] !== approved[name])
    assert.deepEqual(added, [], `${point}: new in the manifest, so Orca will ask every user to approve the update`)
    assert.deepEqual(changed, [], `${point}: changed in the manifest (Orca compares the whole entry: also its wording, its default, its icon), so Orca will ask every user to approve the update`)
    // Taking an entry away asks for nothing, but it is a change for the people who use it.
    assert.deepEqual(Object.keys(approved).filter((name) => !(name in now[point])), [], `${point}: gone from the manifest`)
  }
})

test('what Orca compares is told apart the way Orca does: a reworded setting or another status bar text is a new entry, a new command title is not', () => {
  const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8')) as Manifest
  const edited = (change: (copy: Manifest) => void) => {
    const copy = JSON.parse(JSON.stringify(manifest)) as Manifest
    change(copy)
    const before = identities(manifest)
    const after = identities(copy)
    return Object.keys(after).flatMap((point) => Object.keys(after[point]).filter((name) => after[point][name] !== before[point]?.[name]).map((name) => `${point}.${name}`))
  }
  // The status bar item's text or icon (what "Enhance: On" was tempting to change here).
  assert.deepEqual(edited((copy) => (copy.contributes.statusBarItems[0].text = 'Enhance: Off')), ['statusBarItems.auto-enhance'])
  assert.deepEqual(edited((copy) => (copy.contributes.statusBarItems[0].icon = 'zap')), ['statusBarItems.auto-enhance'])
  // A setting's wording or default.
  assert.deepEqual(edited((copy) => (copy.contributes.settings.find((entry) => entry.key === 'timeoutSeconds')!.title = 'Timeout per model')), ['settings.timeoutSeconds'])
  assert.deepEqual(edited((copy) => (copy.contributes.settings.find((entry) => entry.key === 'timeoutSeconds')!.default = 90)), ['settings.timeoutSeconds'])
  // A command's or a panel's title: the same entry to Orca.
  assert.deepEqual(edited((copy) => (copy.contributes.commands[0].title = 'Another title')), [])
  assert.deepEqual(edited((copy) => (copy.contributes.panels[0].title = 'Another title')), [])
})
