import { assert, test } from 'orca/testing'
import { buildSystemPrompt, buildUserMessage, cleanOutput, formatForTerminal } from './prompts'

test('cleanOutput strips fences and preambles', () => {
  assert.equal(cleanOutput('```markdown\nDo X.\n```'), 'Do X.')
  assert.equal(cleanOutput("Here's the improved prompt:\nDo Y."), 'Do Y.')
  assert.equal(cleanOutput('  Plain.  '), 'Plain.')
})

test('system prompt follows language and custom instructions', () => {
  const vi = buildSystemPrompt({ style: 'bugfix', language: 'vi', customInstructions: 'Use pnpm.' })
  assert.match(vi, /in Vietnamese/)
  assert.match(vi, /regression test/)
  assert.match(vi, /Use pnpm\./)
  assert.match(buildSystemPrompt({ style: 'balanced', language: 'auto' }), /same language/)
})

test('user message includes context only when present', () => {
  assert.equal(buildUserMessage(' fix it '), '<request>\nfix it\n</request>\n\nRewrite the request above into the final prompt.')
  const withContext = buildUserMessage('fix it', [{ kind: 'rules', label: 'AGENTS.md', content: 'Use bun.' }])
  assert.match(withContext, /<project_context>/)
  assert.match(withContext, /<item kind="rules" label="AGENTS.md">\nUse bun\.\n<\/item>/)
})

test('formatForTerminal modes', () => {
  assert.equal(formatForTerminal('one line', 'paste'), 'one line')
  assert.equal(formatForTerminal('a\r\nb', 'paste'), '\x1b[200~a\nb\x1b[201~')
  assert.equal(formatForTerminal('a\n\n  b', 'single-line'), 'a b')
  assert.equal(formatForTerminal('a\nb', 'raw'), 'a\nb')
})
