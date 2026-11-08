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
- Never invent facts about the codebase (file names, APIs, versions). If something important is unknown, tell the agent to find it out, or list it under "Assumptions / questions".
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

export type PromptContext = {
  workspace?: { name: string; branch: string } | null
  projectFiles?: { name: string; content: string }[]
  topLevel?: string[]
  terminal?: { label: string; lines: string[] } | null
  agent?: string | null
}

export function buildSystemPrompt(options: {
  style: Style
  language: string
  customInstructions?: string
}): string {
  const parts = [BASE, STYLE_RULES[options.style]]
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

export function buildUserMessage(prompt: string, context: PromptContext = {}): string {
  const sections: string[] = []
  if (context.agent) {
    sections.push(`Target agent: ${context.agent}`)
  }
  if (context.workspace) {
    sections.push(
      `Workspace: ${context.workspace.name}${context.workspace.branch ? ` (branch ${context.workspace.branch})` : ''}`
    )
  }
  if (context.topLevel && context.topLevel.length > 0) {
    sections.push(`Top-level files:\n${context.topLevel.join('\n')}`)
  }
  for (const file of context.projectFiles ?? []) {
    sections.push(`<file name="${file.name}">\n${file.content}\n</file>`)
  }
  if (context.terminal && context.terminal.lines.length > 0) {
    sections.push(
      `Recent output of the agent terminal "${context.terminal.label}":\n<terminal>\n${context.terminal.lines.join('\n')}\n</terminal>`
    )
  }
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
