// Orca names one workspace two ways (workspace.list: "identity:…"; events and hooks:
// "<repository id>::<path>"), and writes the same folder with either kind of slash. The ids below
// are the shapes the real Orca answered on Windows.
import { assert, test } from 'orca/testing'
import { namesWorkspace, pathInWorkspaceId, pathKey, projectLabel, workspaceKey, workspaceKeys, workspaceTitle } from './workspaces.ts'

const LISTED = { id: 'identity:wt2:local:342c5fcf-f984-4f8b-9611-72159ac97370', path: 'C:/Users/me/Desktop/Tools/Reup' }
const EVENT = 'fd0d6141-e929-4208-8cb8-5e2fe2c7d156::C:\\Users\\me\\Desktop\\Tools\\Reup'

test('an id from an event carries the workspace\'s path; an id from the list does not', () => {
  assert.equal(pathInWorkspaceId(EVENT), 'C:\\Users\\me\\Desktop\\Tools\\Reup')
  assert.equal(pathInWorkspaceId('82ddd056::/home/me/app'), '/home/me/app')
  assert.equal(pathInWorkspaceId(LISTED.id), null)
  // Not ids of that form: nothing before or after the separator.
  assert.equal(pathInWorkspaceId('::/home/me/app'), null)
  assert.equal(pathInWorkspaceId('82ddd056::'), null)
})

test('the same folder is the same key whichever way it is written', () => {
  assert.equal(pathKey('C:\\Users\\me\\Desktop\\Tools\\Reup'), pathKey('C:/Users/me/Desktop/Tools/Reup'))
  assert.equal(pathKey('c:/users/ME/desktop/tools/reup/'), pathKey('C:/Users/me/Desktop/Tools/Reup'))
  assert.notEqual(pathKey('C:/Users/me/Desktop/Tools/Reup2'), pathKey('C:/Users/me/Desktop/Tools/Reup'))
  assert.notEqual(pathKey('C:/Users/me/Desktop/Tools'), pathKey('C:/Users/me/Desktop/Tools/Reup'))
})

test('an id names a listed workspace by being its id, or by carrying its path', () => {
  assert.ok(namesWorkspace(LISTED.id, LISTED))
  assert.ok(namesWorkspace(EVENT, LISTED))
  // Another worktree of the same repository, another repository, another identity: not this one.
  assert.ok(!namesWorkspace('fd0d6141-e929-4208-8cb8-5e2fe2c7d156::C:\\Users\\me\\orca\\workspaces\\Reup\\feature', LISTED))
  assert.ok(!namesWorkspace('fd0d6141-e929-4208-8cb8-5e2fe2c7d156::C:\\Users\\me\\Desktop\\Tools', LISTED))
  assert.ok(!namesWorkspace('identity:wt2:local:2a1c69a0-77a0-469b-9a9e-88f7c4c3cec8', LISTED))
  // A folder workspace has the same id in the list and in events.
  const folder = { id: '82ddd056::C:\\Users\\me\\Downloads\\Notes', path: 'C:\\Users\\me\\Downloads\\Notes' }
  assert.ok(namesWorkspace(folder.id, folder))
})

test('what is kept per workspace is found again under either name', () => {
  assert.equal(workspaceKey(EVENT), 'path:c:/users/me/desktop/tools/reup')
  assert.equal(workspaceKey(LISTED.id), `id:${LISTED.id}`)
  // Kept under the event's id, looked up for the listed workspace: one of its keys.
  assert.ok(workspaceKeys(LISTED).includes(workspaceKey(EVENT)))
  assert.ok(workspaceKeys(LISTED).includes(workspaceKey(LISTED.id)))
  assert.ok(!workspaceKeys({ id: 'identity:wt2:local:other', path: 'C:/Users/me/Desktop/GPT' }).includes(workspaceKey(EVENT)))
})

test('a project is shown by its own name where Orca\'s name for it says nothing', () => {
  // The list of folders to pick from: the project first, then where it is.
  assert.equal(projectLabel({ path: 'C:/Users/me/Desktop/Tools/Reup', project: 'Reup' }), 'Reup · C:/Users/me/Desktop/Tools/Reup')
  assert.equal(projectLabel({ path: 'C:/Users/me/Desktop/Tools/Reup' }), 'C:/Users/me/Desktop/Tools/Reup')
  assert.equal(projectLabel({ path: '/srv/app', project: '  ' }), '/srv/app')
  // What the rewriter and the run card read: "main" alone names no project.
  assert.equal(workspaceTitle('main', 'Reup'), 'Reup: main')
  assert.equal(workspaceTitle('w34-places', 'Data_App'), 'Data_App: w34-places')
  assert.equal(workspaceTitle('AutoBing', 'AutoBing'), 'AutoBing')
  assert.equal(workspaceTitle('autobing', 'AutoBing'), 'autobing')
  assert.equal(workspaceTitle('main', null), 'main')
  assert.equal(workspaceTitle('main'), 'main')
})
