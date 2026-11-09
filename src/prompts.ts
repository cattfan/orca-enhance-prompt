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
- The agent reads the project's own rule files (AGENTS.md, CLAUDE.md, GEMINI.md) by itself. Do not restate them; mention a rule from them only when it changes how THIS task must be done.
- Verification: name only the one or two commands that check this change (from the context), not every check the project has.
- Do not decide things the user left open (exact UI wording, translations, names, numbers, design choices): leave them to the agent or list them as questions.
- Match the length to the request: a small change gets a short prompt; never pad.
- Output ONLY the final prompt text. No preamble, no explanation, no surrounding code fence.`

const STYLE_RULES: Record<Style, string> = {
  balanced: `Shape: a one-line goal, then short sections only where useful: Context, Requirements, Constraints, Done when. Keep it compact; small requests stay small.`,
  concise: `Shape: a tight, unambiguous prompt of at most about five short lines (under ~600 characters): a few sentences or bullet points. Fix grammar and vagueness; remove filler. No sections or headings; add one open question only if it blocks the task.`,
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
    hint: 'Target is Claude Code: write sections as Markdown headings (do not mix in XML tags); for multi-step work it may be told to plan first and use a todo list; state the exact verification command.'
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
  /** The person's own rules (Rules tab), always followed. */
  rules?: string[]
  /** A prompt structure: these sections replace the style's shape. */
  structure?: { name: string; sections: string[] } | null
}): string {
  const sections = options.structure?.sections.filter((section) => section.trim()) ?? []
  const shape = sections.length > 0 ? structureShape(sections) : STYLE_RULES[options.style]
  const parts = [BASE, shape]
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
  const rules = (options.rules ?? []).map((rule) => rule.trim()).filter(Boolean)
  if (rules.length > 0) {
    parts.push(`Rules from the user (always follow them; they win over the shape above):\n${rules.map((rule) => `- ${rule}`).join('\n')}`)
  }
  return parts.join('\n\n')
}

/** The shape for a prompt structure: these headings, in this order. */
function structureShape(sections: string[]): string {
  return [
    'Shape: write the prompt under exactly these headings, in this order:',
    ...sections.map((section, index) => `${index + 1}. ${section}`),
    'Use the headings as given, translated into the output language when they are in another language. Add no other headings: put open questions or assumptions under the closest heading. Leave a heading out only when nothing in the request or the context belongs under it; never invent content to fill one.'
  ].join('\n')
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
  const pasted = formatted.startsWith(PASTE_START) && formatted.endsWith(PASTE_END)
  const body = pasted ? formatted.slice(PASTE_START.length, -PASTE_END.length) : formatted
  const room = max - (pasted ? PASTE_END.length : 0)
  const pieces: string[] = []
  let at = 0
  while (at < body.length) {
    const limit = pieces.length === 0 && pasted ? room - PASTE_START.length : room
    if (body.length - at <= limit) {
      pieces.push(body.slice(at))
      break
    }
    // Prefer a line break in the last 40% of the piece; else cut at the limit.
    let cut = body.lastIndexOf('\n', at + limit - 1) + 1 - at
    if (cut < limit * 0.6) cut = limit
    // Never end a piece on the first half of a surrogate pair (emoji, rare CJK): each write is
    // encoded on its own, and a lone half would arrive as U+FFFD.
    if (isHighSurrogate(body.charCodeAt(at + cut - 1)) && cut > 1) cut -= 1
    pieces.push(body.slice(at, at + cut))
    at += cut
  }
  if (pasted) {
    pieces[0] = PASTE_START + pieces[0]
    pieces[pieces.length - 1] = pieces[pieces.length - 1] + PASTE_END
  }
  return pieces
}

export const PASTE_START = '\u001b[200~'
export const PASTE_END = '\u001b[201~'

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff

/**
 * Text safe to type into a terminal: line breaks become \n, tabs stay, and every other control
 * character (ESC, Ctrl-C, DEL, C1 codes such as CSI) is dropped. The enhanced prompt comes from a
 * model, so it must not be able to send keystrokes or escape sequences to the agent's terminal.
 */
export function terminalSafe(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n')
  let out = ''
  let kept = 0
  for (let index = 0; index < normalized.length; index++) {
    const code = normalized.charCodeAt(index)
    const control = (code < 0x20 && code !== 0x0a && code !== 0x09) || (code >= 0x7f && code <= 0x9f)
    if (control) {
      out += normalized.slice(kept, index)
      kept = index + 1
    }
  }
  return kept === 0 ? normalized : out + normalized.slice(kept)
}

/** Formats text for a terminal according to the `sendMode` setting. */
export function formatForTerminal(text: string, mode: string): string {
  const normalized = terminalSafe(text).trim()
  if (mode === 'single-line') {
    return normalized.split('\n').map((line) => line.trim()).filter(Boolean).join(' ')
  }
  if (mode === 'raw' || !normalized.includes('\n')) {
    return normalized
  }
  // Bracketed paste: agent TUIs keep the newlines instead of submitting at the first one. ESC is
  // already gone, so the text cannot close the paste early.
  return `${PASTE_START}${normalized}${PASTE_END}`
}
