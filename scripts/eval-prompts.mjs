// Quality check of the rewriter on a few fixed cases, with a real model through an installed CLI.
//   node scripts/eval-prompts.mjs                 # Claude Code, model haiku (your subscription)
//   node scripts/eval-prompts.mjs --model sonnet  # another model
//   node scripts/eval-prompts.mjs --show          # also print every prompt it wrote
//   node scripts/eval-prompts.mjs --only concise --runs 20 --parallel 4
//                                                 # one case (by a part of its name) many times: counts, not one verdict
//   node scripts/eval-prompts.mjs --root ../v2.6.8 --only concise --runs 20
//                                                 # the same against another tree's src/ (an exported release)
// A model answers differently each time: one failing run is not a regression and one clean run is
// no proof. Compare counts over 20 runs or more before keeping or dropping a wording.
// It checks what can be checked mechanically: no preamble or fence, the right language, no file
// paths that are not in the context or the request, the user's details kept, sane length, and
// nothing about what the rewriter itself was or was not given.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'

const root = join(import.meta.dirname, '..')
/** The value after a flag, or the fallback. */
const flag = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback
}
// The rewriter's instructions come from this tree, or from another one (--root: a release exported
// with `git archive`), so two wordings are measured by the same checks.
const source = resolve(flag('--root', root))
const load = (file) => import(pathToFileURL(join(source, file)).href)
const { buildSystemPrompt, buildUserMessage, cleanOutput } = await load('src/prompts.ts')
const { runCli } = await load('src/cli.ts')

const model = flag('--model', 'haiku')
const show = process.argv.includes('--show')
const only = flag('--only', '').toLowerCase()
const runs = Math.max(1, Number(flag('--runs', '1')) || 1)
const parallel = Math.max(1, Math.min(8, Number(flag('--parallel', '1')) || 1))

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
  { name: 'vague bug, Vietnamese', style: 'bugfix', prompt: 'panel mở chậm quá, sửa đi', language: 'vi', keep: [] },
  { name: 'feature, nothing in context about it', style: 'feature', prompt: 'add a dark mode toggle to the settings', language: 'en', keep: ['dark mode'], noise: ['zz-'] },
  { name: 'concise rename', style: 'concise', prompt: 'rename the History tab to Log everywhere, also in the vi and zh translations', language: 'en', keep: ['History', 'Log'], maxChars: 800, noise: ['zz-', 'PANEL_REQUEST_LIMIT_MS'] },
  { name: 'details kept, Vietnamese', style: 'balanced', prompt: 'khi gửi prompt dài hơn 4096 ký tự vào terminal thì bị lỗi "text: Too big", xử lý giúp', language: 'vi', keep: ['4096', 'Too big'] },
  { name: 'reason kept, Vietnamese', style: 'balanced', prompt: 'tăng độ trễ trước khi nhấn Enter sau khi gửi lên 300 ms, vì Codex hay nhận thiếu đoạn cuối của prompt dài', language: 'vi', keep: ['300', 'Codex'], reason: true },
  { name: 'structure', style: 'balanced', prompt: 'thêm nút xuất lịch sử ra file CSV', language: 'vi', keep: ['CSV'], structure: { name: 'Mine', sections: ['Mục tiêu', 'Yêu cầu', 'Tiêu chí hoàn thành'] } },
  // Prompting Claude Fable 5.2: a task with several steps is finished in one go and ends with a summary that stands on its own.
  { name: 'several steps: finish it, recap', style: 'detailed', prompt: 'move every scripts/*.test.mjs to TypeScript, update scripts/release.mjs to match, and get the whole test suite passing again', language: 'en', keep: ['scripts/release.mjs'], finish: true },
  // ...while a small change gets none of that.
  { name: 'small change stays small', style: 'balanced', prompt: 'fix the typo "recieve" in README.md', language: 'en', keep: ['recieve', 'README.md'], maxChars: 1100, small: true },
  // The Off level, a remote workspace, project files switched off: the rewriter gets the request alone.
  // The agent has the whole project, so the prompt says what to find, not what the rewriter lacked.
  { name: 'no project context', style: 'balanced', prompt: 'add dark mode to the settings page', language: 'en', keep: ['dark mode'], bare: true },
  // An action the person already approved is written as approved, not asked about again.
  { name: 'approved action', style: 'balanced', prompt: 'delete the unused scripts/shots.sh and commit it. I confirm the deletion, no need to ask me', language: 'en', keep: ['scripts/shots.sh'], approved: /(ask|confirm|check with)[^.\n]{0,40}before[^.\n]{0,30}delet|wait for (my |the user'?s? )?(confirmation|approval)/i }
]

/**
 * The rewriter speaking about its own input ("no project context was provided", "I can't see the
 * files"): to the agent, which has the whole project, that reads as a statement about its project.
 */
const GIVEN = new RegExp(
  [
    /\b(no|without)\b[^.\n]{0,30}\b(project |repo(sitory)? |code(base)? )?(context|files?)\b[^.\n]{0,40}\b(provided|given|supplied|attached|shared|included)\b/,
    /\bcontext\b[^.\n]{0,40}\b(was|were|is|are) not (provided|given|supplied|shared|included)\b/,
    /\b(not|nothing) in the (provided|given|supplied) (project )?context\b/,
    /\bI (can't|cannot|do not|don't) (see|have access to)\b/,
    /(không|chưa)[^.\n]{0,25}(ngữ cảnh|bối cảnh)[^.\n]{0,25}(cung cấp|đưa|gửi)/,
    /(ngữ cảnh|bối cảnh)[^.\n]{0,30}(không|chưa) được (cung cấp|đưa|gửi)/
  ]
    .map((pattern) => pattern.source)
    .join('|'),
  'i'
)
const VIETNAMESE = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i
/** One case through the model once: what is wrong with the prompt it wrote (nothing, when it is right). */
async function runCase(item) {
  const system =buildSystemPrompt({ style: item.style, language: 'auto', agent: 'claude', structure: item.structure ?? null })
  const user = buildUserMessage(item.prompt, item.bare ? [] : context)
  const started = Date.now()
  let text
  try {
    text = cleanOutput(await runCli({ kind: 'claude-code', command: '', model, customArgs: '' }, system, user, AbortSignal.timeout(120_000)))
  } catch (error) {
    return { problems: [`model call failed: ${error.message}`], text: '', ms: Date.now() - started }
  }
  const problems = []
  if (/^(here|sure|below|dưới đây|đây là)\b/i.test(text)) problems.push('starts with a preamble')
  if (/^```/.test(text)) problems.push('wrapped in a code fence')
  const given = GIVEN.exec(text)
  if (given) problems.push(`talks about what the rewriter was given ("${given[0].trim().slice(0, 80)}")`)
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
  // Anthropic and OpenAI: plain tone, no shouting.
  const shouting = text.match(/\b(MUST|IMPORTANT|CRITICAL|NEVER|ALWAYS|PHẢI|KHÔNG ĐƯỢC)\b|!!/g) ?? []
  if (shouting.length > 0) problems.push(`shouts (${[...new Set(shouting)].join(', ')})`)
  // Say what to do rather than what not to do: most bullets should not be prohibitions.
  const bullets = text.split('\n').filter((line) => /^\s*(?:[-*]|\d+[.)])\s/.test(line))
  const negative = bullets.filter((line) => /^\s*(?:[-*]|\d+[.)])\s+(?:\*\*)?(do not|don't|never|avoid|không|đừng|tránh)\b/i.test(line))
  if (negative.length > 2 && negative.length / Math.max(1, bullets.length) > 0.3) problems.push(`${negative.length} of ${bullets.length} bullets are prohibitions`)
  // Claude Code: ask for evidence, not a claim.
  if (item.style !== 'concise' && !/(report|evidence|output|printed|báo cáo|báo lại|kết quả|in ra|đầu ra)/i.test(text)) problems.push('asks for no evidence')
  if (item.reason && !/(because|since|vì|do |bởi)/i.test(text)) problems.push('lost the reason the user gave')
  // Prompting Claude Fable 5.2: how the agent thinks, and whether it delegates, is its own business.
  const meddling = text.match(/step[- ]by[- ]step reasoning|think (hard|step[- ]by[- ]step)|chain of thought|(show|explain|write out) your (reasoning|thinking)|suy nghĩ từng bước|trình bày (quá trình )?suy luận|sub-?agents?|token budget/gi) ?? []
  if (meddling.length > 0) problems.push(`tells the agent how to think or delegate (${[...new Set(meddling)].join(', ')})`)
  if (item.finish) {
    if (!/(retry|retries|another (way|approach)|work through|obstacle|carry on|keep going|rather than stopping|do not stop|before (you|it) (stops?|ends?)|every part)/i.test(text)) problems.push('does not ask to finish the whole task through ordinary obstacles')
    if (!/(summary|recap|report)/i.test(text)) problems.push('asks for no closing summary')
  }
  if (item.small && /(obstacle|timeout|deliberate blocker|closing summary|nearby (problem|typo|issue))/i.test(text)) problems.push('pads a small change with long-task instructions')
  if (item.approved?.test(text)) problems.push('asks again for an approval the request already gave')
  if (item.structure) {
    const missing = item.structure.sections.filter((section) => !text.includes(section))
    if (missing.length) problems.push(`missing headings: ${missing.join(', ')}`)
  }
  return { problems, text, ms: Date.now() - started }
}

/** Runs the jobs a few at a time; the results keep the jobs' order. */
async function pooled(jobs, size) {
  const results = []
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const at = next++
      results[at] = await jobs[at]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker))
  return results
}

const chosen = CASES.filter((item) => item.name.toLowerCase().includes(only))
if (chosen.length === 0) {
  console.log(`No case has "${only}" in its name. Cases: ${CASES.map((item) => item.name).join(' | ')}`)
  process.exit(2)
}
const rule = '-'.repeat(60)
let failures = 0
for (const item of chosen) {
  const results = await pooled(Array.from({ length: runs }, () => () => runCase(item)), parallel)
  if (runs === 1) {
    const [{ problems, text, ms }] = results
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${item.name} (${(ms / 1000).toFixed(1)} s, ${text.length} chars)${problems.length ? ` — ${problems.join('; ')}` : ''}`)
    if (problems.length) failures++
    if (show || problems.length) console.log(`${rule}\n${text}\n${rule}`)
    continue
  }
  // Many runs: how often it was right, how often each problem came (what a problem says in brackets
  // is left out, so that "too long (812 chars)" and "too long (955 chars)" count as one), and the
  // lengths, which say more than a pass mark does.
  const clean = results.filter((entry) => entry.problems.length === 0).length
  const counts = new Map()
  for (const entry of results) {
    for (const problem of new Set(entry.problems.map((said) => said.replace(/\s*\(.*\)$/, '')))) counts.set(problem, (counts.get(problem) ?? 0) + 1)
  }
  const lengths = results.map((entry) => entry.text.length).filter(Boolean).sort((a, b) => a - b)
  const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0
  console.log(`${clean === runs ? 'ok  ' : 'FAIL'} ${item.name}: right in ${clean} of ${runs} · chars min ${lengths[0] ?? 0}, median ${median}, max ${lengths.at(-1) ?? 0}`)
  for (const [problem, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`       ${count}× ${problem}`)
  if (clean !== runs) failures++
  if (show) for (const entry of results) console.log(`${rule}\n${entry.text}\n${rule}`)
}
console.log(failures ? `\n${failures} case(s) need work` : '\nAll cases look right')
process.exit(failures ? 1 : 0)
