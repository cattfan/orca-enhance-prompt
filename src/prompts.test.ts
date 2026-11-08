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

test('terminalChunks: long prompts go in pieces under 4096, one paste overall', async () => {
  const { terminalChunks } = await import('./prompts')
  const line = 'x'.repeat(99) + '\n'
  const text = line.repeat(120) // 12,000 characters
  const pieces = terminalChunks(text, 'paste')
  assert.ok(pieces.length >= 3)
  for (const piece of pieces) assert.ok(piece.length <= 4000, `piece of ${piece.length}`)
  assert.ok(pieces[0].startsWith('\x1b[200~'))
  assert.ok(pieces.at(-1)!.endsWith('\x1b[201~'))
  assert.equal(pieces.filter((piece) => piece.includes('\x1b[200~')).length, 1)
  assert.equal(pieces.join(''), '\x1b[200~' + text.trim() + '\x1b[201~')
  // Cuts land on line breaks.
  for (const piece of pieces.slice(0, -1)) assert.ok(/\n$/.test(piece.replace('\x1b[200~', '')) || piece.endsWith('x'))
  // No surrogate pair is split.
  const emoji = '😀'.repeat(3000)
  for (const piece of terminalChunks(emoji, 'raw')) {
    const last = piece.charCodeAt(piece.length - 1)
    assert.ok(!(last >= 0xd800 && last <= 0xdbff))
  }
  assert.equal(terminalChunks('short', 'paste').length, 1)
})
