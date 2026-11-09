// Built-in prompt structures can be edited: a saved structure with a built-in's id replaces it.
import { assert, test } from 'orca/testing'
import { allStructures, BUILT_IN_STRUCTURES, structureById } from './rules.ts'
import { progressOf } from './worker.ts'

test('an edited built-in replaces the built-in everywhere, and deleting it brings the default back', () => {
  const builtIn = BUILT_IN_STRUCTURES[0]
  const edited = { id: builtIn.id, name: 'Mine', sections: ['A', 'B'] }
  const own = { id: 'structure-1', name: 'Own', sections: ['X'] }
  const config = { rules: [], structures: [edited, own] }
  assert.deepEqual(structureById(config, builtIn.id), edited)
  const listed = allStructures(config)
  assert.equal(listed.length, BUILT_IN_STRUCTURES.length + 1)
  assert.deepEqual(listed[0], { structure: edited, builtIn: true, edited: true })
  assert.deepEqual(listed.at(-1), { structure: own, builtIn: false, edited: false })
  assert.deepEqual(structureById({ rules: [], structures: [own] }, builtIn.id), builtIn)
})

test('the progress of an unknown run is null', () => {
  assert.equal(progressOf('no-such-run'), null)
})
