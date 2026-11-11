import { assert, test } from 'orca/testing'
import { buildSystemPrompt, buildUserMessage, cleanOutput, formatForTerminal } from './prompts.ts'

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
  const { terminalChunks } = await import('./prompts.ts')
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
  for (const piece of pieces.slice(0, -1)) assert.ok(piece.endsWith('\n'), 'piece should end on a line break')
  // No surrogate pair is split.
  const emoji = '😀'.repeat(3000)
  for (const piece of terminalChunks(emoji, 'raw')) {
    const last = piece.charCodeAt(piece.length - 1)
    assert.ok(!(last >= 0xd800 && last <= 0xdbff))
  }
  assert.equal(terminalChunks('short', 'paste').length, 1)
})

test('terminalChunks: edge cases (empty, at the limit, Vietnamese, tiny max)', async () => {
  const { terminalChunks } = await import('./prompts.ts')
  assert.deepEqual(terminalChunks('', 'paste'), [])
  assert.deepEqual(terminalChunks('   \n  ', 'paste'), [])
  // Exactly the piece size: one write; one more character: two.
  assert.equal(terminalChunks('a'.repeat(4000), 'raw').length, 1)
  assert.equal(terminalChunks('a'.repeat(4001), 'raw').length, 2)
  // 4096 characters (Orca's own limit) still goes in pieces of at most 4000.
  for (const piece of terminalChunks('b'.repeat(4096), 'raw')) assert.ok(piece.length <= 4000)
  // Vietnamese text, precomposed and with combining marks, survives the cuts unchanged.
  const vi = 'Sửa lỗi đăng nhập trên điện thoại.\n'.repeat(400) + 'Tie\u0302\u0301ng Vie\u0323\u0302t'
  const pieces = terminalChunks(vi, 'paste')
  assert.ok(pieces.length > 1)
  assert.equal(pieces.join(''), '\x1b[200~' + vi.trim() + '\x1b[201~')
  // A tiny max never loops forever and never splits a surrogate pair.
  const tiny = terminalChunks('😀😀😀😀', 'raw', 3)
  assert.equal(tiny.join(''), '😀😀😀😀')
  for (const piece of tiny) assert.ok(piece.length > 0 && piece.length <= 3)
})

test('formatForTerminal drops control characters a model could slip into the prompt', async () => {
  const { formatForTerminal, terminalSafe } = await import('./prompts.ts')
  // ESC sequences, Ctrl-C, DEL and the C1 CSI never reach the terminal; tabs and line breaks stay.
  assert.equal(terminalSafe('a\u001b[2Jb\u0003c\u007fd\u009be\tf\r\ng'), 'a[2Jbcde\tf\ng')
  assert.equal(formatForTerminal('one\u001b[201~\ntwo', 'paste'), '\x1b[200~one[201~\ntwo\x1b[201~')
  assert.equal(formatForTerminal('x\u001b]0;title\u0007y', 'raw'), 'x]0;titley')
  assert.equal(formatForTerminal('a\u0003\nb', 'single-line'), 'a b')
  assert.equal(terminalSafe('plain'), 'plain')
})

test('the rewriter is told not to copy rule files, to keep checks and length in proportion, and not to decide open choices', async () => {
  const { buildSystemPrompt } = await import('./prompts.ts')
  const system = buildSystemPrompt({ style: 'concise', language: 'auto', agent: 'claude' })
  assert.match(system, /reads the project's own rule files \(AGENTS\.md, CLAUDE\.md, GEMINI\.md\) by itself/)
  assert.match(system, /only the one or two commands that check this change/)
  assert.match(system, /Do not decide things the user left open/)
  assert.match(system, /at most about five short lines/)
  assert.match(system, /Markdown headings \(do not mix in XML tags\)/)
})

test('the rewriter writes nothing about what it was or was not given: the agent has the whole project', async () => {
  const { buildSystemPrompt, buildUserMessage } = await import('./prompts.ts')
  // In every style, also the ones with no Context heading, and whatever the language.
  for (const style of ['balanced', 'concise', 'detailed', 'bugfix', 'custom'] as const) {
    const system = buildSystemPrompt({ style, language: 'vi' })
    assert.match(system, /The agent has the whole project in front of it; you see only what was gathered for you, which can be little or nothing/)
    assert.match(system, /Write nothing about what you were or were not given, not even as a reason/)
    assert.match(system, /just tell the agent what to find first/)
  }
  // With the context level Off the rewriter gets the request alone: no empty context block to remark on.
  const bare = buildUserMessage('add dark mode', [])
  assert.ok(!bare.includes('project_context'))
  assert.match(bare, /^<request>\nadd dark mode\n<\/request>/)
})

test('the rewriter follows the vendors\' prompting guidance: reasons kept, positive phrasing, plain tone, when to ask, evidence, no contradictions', async () => {
  const { buildSystemPrompt } = await import('./prompts.ts')
  const system = buildSystemPrompt({ style: 'balanced', language: 'auto' })
  assert.match(system, /Keep the reason the user gave/)
  assert.match(system, /rather than what not to do/)
  assert.match(system, /no MUST \/ IMPORTANT \/ CRITICAL/)
  assert.match(system, /stop and ask: only for a blocking unknown or an action that is hard to undo/)
  assert.match(system, /reports the commands it ran and what they printed/)
  assert.match(system, /never give two that pull against each other/)
  // The rewriter's own instructions follow the same tone.
  assert.ok(!/\b(ONLY|THIS)\b/.test(system), 'capitals for emphasis in the system prompt')
})

test('the rewriter follows the Fable 5.2 guidance: finish the task, named approvals, scope, reports, no reasoning requests', async () => {
  const { buildSystemPrompt } = await import('./prompts.ts')
  const system = buildSystemPrompt({ style: 'balanced', language: 'auto', agent: 'claude' })
  assert.match(system, /Complete every part of this task before you end your turn/)
  assert.match(system, /find the cause and retry or try another way rather than stopping/)
  assert.match(system, /works through ordinary obstacles/)
  assert.match(system, /stops early only for a deliberate blocker/)
  assert.match(system, /A small change \(one edit in one place, such as a typo or a rename in one file\) gets none of these three/)
  // Concise prompts stay concise.
  assert.match(buildSystemPrompt({ style: 'concise', language: 'auto' }), /and the "Larger tasks" additions/)
  assert.match(system, /Name the actions that apply to this task/)
  assert.match(system, /write it as approved/)
  assert.match(system, /Avoid a bare "never" or "always"/)
  assert.match(system, /lists nearby problems it notices at the end instead of fixing them/)
  assert.match(system, /a closing summary that stands on its own/)
  assert.match(system, /no request to show or write out its reasoning/)
  assert.match(system, /no instruction to delegate to subagents/)
  // Restructuring is offered only where the person asked for it.
  assert.match(buildSystemPrompt({ style: 'refactor', language: 'auto' }), /inside the target code the agent may merge repeated code/)
  assert.ok(!/may merge repeated code and reshape/.test(buildSystemPrompt({ style: 'bugfix', language: 'auto' })))
})
