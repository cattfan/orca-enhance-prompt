// System prompts for each style, and the user message the rewriter sees. Pure functions, no I/O.

export const STYLES = [
  'balanced',
  'concise',
  'detailed',
  'bugfix',
  'feature',
  'refactor',
  'review',
  'plan',
  'custom'
] as const
export type Style = (typeof STYLES)[number]

export const STYLE_LABELS: Record<Style, string> = {
  balanced: 'Balanced',
  concise: 'Concise',
  detailed: 'Detailed spec',
  bugfix: 'Bug fix',
  feature: 'New feature',
  refactor: 'Refactor',
  review: 'Code review',
  plan: 'Plan first',
  custom: 'Custom only'
}

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  vi: 'Vietnamese',
  zh: 'Chinese (Simplified)',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  ru: 'Russian'
}

export function isStyle(value: unknown): value is Style {
  return typeof value === 'string' && (STYLES as readonly string[]).includes(value)
}

const BASE = `You are a prompt engineer for AI coding agents (Claude Code, Codex, Gemini CLI, OpenCode and similar).
Rewrite the user's rough request into a clear, specific, actionable prompt that the agent can execute well.

Rules:
- Preserve the user's intent exactly. Never add features, scope or requirements they did not ask for.
- Ground the prompt in the project context: name the real files, functions, commands and conventions that appear there when they are relevant (e.g. "start in src/auth/session.ts", "verify with pnpm test").
- Never invent facts about the codebase. Mention a file, symbol, API or command ONLY if it appears in the project context or in the request; otherwise tell the agent to locate it. List genuine unknowns under "Assumptions / questions".
- Relevant files in the context are candidates found by search; present them as "likely relevant", not as certain.
- Keep every concrete detail the user gave: names, paths, error messages, code, URLs, numbers.
- Write as instructions addressed to the agent ("Add...", "Investigate..."), not as a conversation.
- Use the project context only to make the prompt more precise; do not summarize it back.
- Output ONLY the final prompt text. No preamble, no explanation, no surrounding code fence.`

const STYLE_RULES: Record<Style, string> = {
  balanced: `Shape: a one-line goal, then short sections only where useful: Context, Requirements, Constraints, Done when. Keep it compact; small requests stay small.`,
  concise: `Shape: a tight, unambiguous prompt of a few sentences or bullet points. Fix grammar and vagueness; remove filler. Do not add sections.`,
  detailed: `Shape: a full spec with sections: Goal, Background, Requirements (numbered), Constraints / non-goals, Edge cases, Acceptance criteria, Deliverables. Be thorough but do not pad.`,
  bugfix: `Shape: a bug-fix brief: Symptom (actual vs expected), Reproduction steps (if known), Suspected area (only if given), Investigation steps (find the root cause before changing code), Fix requirements (minimal change, no unrelated refactors), Verification (add or update a regression test, run the relevant tests).`,
  feature: `Shape: a feature brief: Goal and user value, Behaviour / requirements, UI or API surface (if relevant), Constraints (match existing patterns, no new dependencies unless needed), Tests to add, Done when.`,
  refactor: `Shape: a refactor brief: Target code, Motivation, Desired structure, Hard constraint that behaviour must not change, Steps in small safe increments, Verification (existing tests pass; add tests first if coverage is missing).`,
  review: `Shape: a code-review request: What to review (diff, branch or files), Focus areas (correctness, edge cases, security, performance, readability, tests), Output format (findings grouped by severity with file:line and a suggested fix). Tell the agent not to modify code unless asked.`,
  plan: `Shape: ask the agent to plan before coding: first explore the relevant code and write a short step-by-step plan with risks and open questions, then wait for confirmation (or proceed if the plan is low-risk, say which). Include the goal and requirements.`,
  custom: `Follow the custom instructions below for the shape and content of the prompt.`
}

/** How each agent CLI likes its prompts. Keys match `agents.list`'s `agent`, loosely. */
const AGENT_HINTS: { match: RegExp; hint: string }[] = [
  {
    match: /claude/i,
    hint: 'Target is Claude Code: Markdown headings or XML tags (<context>, <requirements>) both work well; for multi-step work it may be told to plan first and use a todo list; state the exact verification command.'
  },
  {
    match: /codex/i,
    hint: 'Target is OpenAI Codex CLI: prefer short imperative bullet points, explicit file paths and the exact test/lint command to run; avoid long prose.'
  },
  {
    match: /gemini/i,
    hint: 'Target is Gemini CLI: clear numbered steps, explicit file paths, and what to verify at the end.'
  },
  {
    match: /aider/i,
    hint: 'Target is Aider: name the files to add to the chat first, then the change; keep it concise.'
  },
  {
    match: /opencode|amp|cursor|droid|pi\b|qwen|kimi|goose|cline/i,
    hint: 'Target is a terminal coding agent: explicit file paths, clear steps, exact verification command.'
  }
]

export function agentHint(agent: string | null | undefined): string | null {
  if (!agent) return null
  return AGENT_HINTS.find((entry) => entry.match.test(agent))?.hint ?? null
}

export type ContextBlock = { kind: string; label: string; content: string; note?: string }

export function buildSystemPrompt(options: {
  style: Style
  language: string
  customInstructions?: string
  agent?: string | null
}): string {
  const parts = [BASE, STYLE_RULES[options.style]]
  const hint = agentHint(options.agent)
  if (hint) {
    parts.push(hint)
  }
  const lang = LANGUAGE_NAMES[options.language]
  parts.push(
    lang
      ? `Write the final prompt in ${lang}, but keep code, identifiers, paths and error messages verbatim.`
      : `Write the final prompt in the same language as the user's request; keep code, identifiers, paths and error messages verbatim.`
  )
  const custom = options.customInstructions?.trim()
  if (custom) {
    parts.push(`Custom instructions from the user (follow them):\n${custom}`)
  }
  return parts.join('\n\n')
}

const escapeAttr = (value: string) => value.replace(/["<>&]/g, (c) => ({ '"': '&quot;', '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c)

export function buildUserMessage(prompt: string, context: ContextBlock[] = []): string {
  const sections = context.map((block) => {
    const note = block.note ? ` note="${escapeAttr(block.note)}"` : ''
    return `<item kind="${block.kind}" label="${escapeAttr(block.label)}"${note}>\n${block.content}\n</item>`
  })
  const contextBlock =
    sections.length > 0 ? `<project_context>\n${sections.join('\n\n')}\n</project_context>\n\n` : ''
  return `${contextBlock}<request>\n${prompt.trim()}\n</request>\n\nRewrite the request above into the final prompt.`
}

/** Removes a wrapping code fence or a "Here is the prompt:" line some models add anyway. */
export function cleanOutput(text: string): string {
  let out = text.trim()
  out = out.replace(/^(here(?:'s| is)[^\n]*?(?:prompt|version)[^\n]*:)\s*\n/i, '')
  const fence = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(out.trim())
  if (fence) {
    out = fence[1]
  }
  out = out.replace(/^<\/?(?:request|prompt|final_prompt)>\s*/i, '').replace(/\s*<\/(?:request|prompt|final_prompt)>$/i, '')
  return out.trim()
}

/** Orca's `terminal.sendText` takes at most 4096 characters per call; stay safely below it. */
export const SEND_CHUNK = 4000

/**
 * The text for a terminal, split into pieces of at most `max` characters, sent one after another.
 * Bracketed-paste markers wrap the whole text (first and last piece), so the agent still sees one
 * paste. Cuts fall on a line break when there is one near the end, and never inside a surrogate pair.
 */
export function terminalChunks(text: string, mode: string, max = SEND_CHUNK): string[] {
  const formatted = formatForTerminal(text, mode)
  if (formatted.length <= max) return formatted ? [formatted] : []
  const start = '\x1b[200~'
  const end = '\x1b[201~'
  const pasted = formatted.startsWith(start) && formatted.endsWith(end)
  const body = pasted ? formatted.slice(start.length, -end.length) : formatted
  const room = max - (pasted ? end.length : 0)
  const pieces: string[] = []
  let rest = body
  while (rest.length > 0) {
    const limit = pieces.length === 0 && pasted ? room - start.length : room
    if (rest.length <= limit) {
      pieces.push(rest)
      break
    }
    let cut = rest.lastIndexOf('\n', limit - 1) + 1
    if (cut < limit * 0.6) cut = limit
    // Do not split a surrogate pair (emoji, rare CJK).
    const code = rest.charCodeAt(cut - 1)
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1
    pieces.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (pasted) {
    pieces[0] = start + pieces[0]
    pieces[pieces.length - 1] = pieces[pieces.length - 1] + end
  }
  return pieces
}

/** Formats text for a terminal according to the `sendMode` setting. */
export function formatForTerminal(text: string, mode: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (mode === 'single-line') {
    return normalized.split('\n').map((line) => line.trim()).filter(Boolean).join(' ')
  }
  if (mode === 'raw' || !normalized.includes('\n')) {
    return normalized
  }
  // Bracketed paste: agent TUIs keep the newlines instead of submitting at the first one.
  const safe = normalized.replace(/\x1b\[20[01]~/g, '')
  return `\x1b[200~${safe}\x1b[201~`
}
