// The web panel's state runtime (web/src/orca-runtime.ts): a change reaches React within the same
// event. A later notification made React put the old text back in the prompt box, so the caret
// jumped to the end of the line whenever you typed anywhere but the end.
import { assert, test } from 'orca/testing'
import { atom, read, set, subscribe } from '../web/src/store.ts'

test('a set() notifies subscribers at once, so a typed character is in the value before React checks it', () => {
  let calls = 0
  const stop = subscribe(() => calls++)
  const draft = atom('abc')
  set(draft, 'Xabc')
  assert.equal(calls, 1, 'notified synchronously')
  assert.equal(read(draft), 'Xabc')
  // The same value does not notify again.
  set(draft, 'Xabc')
  assert.equal(calls, 1)
  stop()
  set(draft, 'Yabc')
  assert.equal(calls, 1, 'no call after unsubscribing')
})
