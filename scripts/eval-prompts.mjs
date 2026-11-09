// Quality check of the rewriter on a few fixed cases, with a real model through an installed CLI.
//   node scripts/eval-prompts.mjs                 # Claude Code, model haiku (your subscription)
//   node scripts/eval-prompts.mjs --model sonnet  # another model
//   node scripts/eval-prompts.mjs --show          # also print every prompt it wrote
// It checks what can be checked mechanically: no preamble or fence, the right language, no file
// paths that are not in the context or the request, the user's details kept, sane length.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const load = (file) => import(pathToFileURL(join(root, file)).href)
const { buildSystemPrompt, buildUserMessage, cleanOutput } = await load('src/prompts.ts')
const { runCli } = await load('src/cli.ts')

const modelAt = process.argv.indexOf('--model')
const model = modelAt > 0 ? process.argv[modelAt + 1] : 'haiku'
const show = process.argv.includes('--show')

const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8').slice(0, 2500)
const tree = ['src/', '  src/panel/ (8)', '  src/context/ (7)', 'src/worker.ts', 'src/prompts.ts', 'src/llm.ts', 'src/cli.ts', 'scripts/ (9)', 'AGENTS.md', 'orca-plugin.json'].join('\n')
const context = [
  { kind: 'workspace', label: 'Workspace', content: 'orca-plugin-enchatprompt (branch main)' },
  { kind: 'rules', label: 'AGENTS.md', content: agents },
  { kind: 'stack', label: 'Stack & commands', content: 'TypeScript, Orca plugin (no build step). Test: orca plugin test . Typecheck: npx tsc -p .' },
  { kind: 'tree', label: 'Repository tree', content: tree },
  { kind: 'file', label: 'src/panel/history-tab.tsx', note: 'keyword match', content: '1: // history-tab.tsx: part of the Enhance Prompt panel\n12: export function HistoryTab() {' }
]
/** Paths the model may name: those in the context (the request's are checked per case). */
const PATH = /\b(?:src|scripts|docs)\/[\w./-]+\.\w+/g
const known = new Set(context.flatMap((block) => [block.label, ...(block.content.match(PATH) ?? [])]))

const CASES = [
  { name: 'vague bug, Vietnamese', style: 'bugfix', prompt: 'panel mở chậm quá, sửa đi', language: 'vi', keep: [], noise: ['zz-'] },
  { name: 'feature, nothing in context about it', style: 'feature', prompt: 'add a dark mode toggle to the settings', language: 'en', keep: ['dark mode'], noise: ['zz-'] },
  { name: 'concise rename', style: 'concise', prompt: 'rename the History tab to Log everywhere, also in the vi and zh translations', language: 'en', keep: ['History', 'Log'], maxChars: 700, noise: ['zz-', 'PANEL_REQUEST_LIMIT_MS'] },
  { name: 'details kept, Vietnamese', style: 'balanced', prompt: 'khi gửi prompt dài hơn 4096 ký tự vào terminal thì bị lỗi "text: Too big", xử lý giúp', language: 'vi', keep: ['4096', 'Too big'] },
  { name: 'structure', style: 'balanced', prompt: 'thêm nút xuất lịch sử ra file CSV', language: 'vi', keep: ['CSV'], structure: { name: 'Mine', sections: ['Mục tiêu', 'Yêu cầu', 'Tiêu chí hoàn thành'] } }
]

const VIETNAMESE = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i
let failures = 0
for (const item of CASES) {
  const system = buildSystemPrompt({ style: item.style, language: 'auto', agent: 'claude', structure: item.structure ?? null })
  const user = buildUserMessage(item.prompt, context)
  const started = Date.now()
  let text
  try {
    text = cleanOutput(await runCli({ kind: 'claude-code', command: '', model, customArgs: '' }, system, user, AbortSignal.timeout(120_000)))
  } catch (error) {
    console.log(`FAIL ${item.name}: ${error.message}`)
    failures++
    continue
  }
  const problems = []
  if (/^(here|sure|below|dưới đây|đây là)\b/i.test(text)) problems.push('starts with a preamble')
  if (/^```/.test(text)) problems.push('wrapped in a code fence')
  // Vietnamese if a fair share of its letters carry Vietnamese marks (a quoted word or two does not count).
  const marked = (text.match(new RegExp(VIETNAMESE.source, 'gi')) ?? []).length
  const isVi = marked / Math.max(1, (text.match(/\p{L}/gu) ?? []).length) > 0.03
  if (item.language === 'vi' && !isVi) problems.push('not in Vietnamese')
  if (item.language === 'en' && isVi) problems.push('not in English')
  for (const word of item.keep) if (!text.includes(word)) problems.push(`lost "${word}"`)
  for (const path of text.match(PATH) ?? []) {
    if (!known.has(path) && !item.prompt.includes(path)) problems.push(`invented path ${path}`)
  }
  if (item.maxChars && text.length > item.maxChars) problems.push(`too long (${text.length} chars)`)
  // The agent reads AGENTS.md itself: a prompt that copies its unrelated rules is padding.
  for (const noise of item.noise ?? []) if (text.includes(noise)) problems.push(`repeats an unrelated project rule (${noise})`)
  const checks = ['orca plugin types', 'npx tsc', 'orca plugin test', 'orca plugin check', 'orca plugin validate'].filter((command) => text.includes(command)).length
  if (checks > 3) problems.push(`lists ${checks} check commands`)
  if (/<(context|requirements|constraints|done_when)>/.test(text) && /^#{1,3} /m.test(text)) problems.push('mixes XML tags and Markdown headings')
  if (/<(context|requirements|constraints|done_when)>/.test(text)) problems.push('uses XML tags instead of headings')
  if (item.structure) {
    const missing = item.structure.sections.filter((section) => !text.includes(section))
    if (missing.length) problems.push(`missing headings: ${missing.join(', ')}`)
  }
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${item.name} (${((Date.now() - started) / 1000).toFixed(1)} s, ${text.length} chars)${problems.length ? ` — ${problems.join('; ')}` : ''}`)
  if (problems.length) failures++
  if (show || problems.length) console.log(`${'-'.repeat(60)}\n${text}\n${'-'.repeat(60)}`)
}
console.log(failures ? `\n${failures} case(s) need work` : '\nAll cases look right')
process.exit(failures ? 1 : 0)
