// A worker's error reaches the panel as a code and a text, nothing else: that is what Orca passes on
// when a handler throws. The message the panel translates therefore travels inside the text.
import { assert, test } from 'orca/testing'
import { english, messageIn, msg, plainText, raw, withMessage } from './messages.ts'

test('a message travels inside an error\'s text and is read back whole; a log reads the sentence', () => {
  const message = msg('error.all_failed', {
    list: [msg('error.attempt', { name: 'Claude Code', reason: msg('error.model_timeout', { model: 'claude-fable-5-2', seconds: 60 }) }), msg('error.attempt', { name: 'Groq', reason: raw('429: quá tải, thử lại sau') })]
  })
  const text = withMessage(message)
  assert.ok(text.startsWith('All models failed. Claude Code: claude-fable-5-2 did not answer within 60 s. · Groq: 429: quá tải, thử lại sau [[message:'), text)
  assert.deepEqual(messageIn(text), message)
  assert.equal(plainText(text), english(message))
  // What is carried holds no bracket and no space, so it cannot be mistaken for the marks.
  const carried = text.slice(text.lastIndexOf('[[message:') + '[[message:'.length, -2)
  assert.ok(!/[\s[\]]/.test(carried), carried)
})

test('a provider\'s own text cannot break it, and a text that carries nothing is shown as it is', () => {
  // Text from outside that happens to hold the marks themselves.
  const odd = raw('weird ]] text [[message: not json ]]')
  assert.deepEqual(messageIn(withMessage(odd)), odd)
  assert.equal(plainText(withMessage(odd)), 'weird ]] text [[message: not json ]]')
  // Nothing carried: an error of Orca itself, or of an older worker.
  assert.equal(messageIn('The worker could not start.'), null)
  assert.equal(plainText('The worker could not start.'), 'The worker could not start.')
  // Cut short on the way: no message, and the sentence alone is still what is shown.
  const cut = withMessage(msg('error.no_prompt')).slice(0, -4)
  assert.equal(messageIn(cut), null)
  assert.equal(plainText(cut), 'Write a prompt first.')
  // Not one of the plugin's messages.
  assert.equal(messageIn(` [[message:${encodeURIComponent('{"code":"nope"}')}]]`), null)
  assert.equal(messageIn(' [[message:%E0%A4%A]]'), null)
})
