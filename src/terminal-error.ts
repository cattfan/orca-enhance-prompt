// Picks the error out of a terminal's recent output, for "Fix this error". Pure, no I/O.

/** Lines that usually start or belong to an error report (build, test, runtime, package managers). */
const ERROR_LINE =
  /\b(error|errors|failed|failure|failing|exception|traceback|panic|fatal|segmentation fault|uncaught|unhandled|cannot find|not found|undefined reference|assertion)\b|ERR!|✖|✗|×|\bFAIL\b|^\s*at\s+\S+.*:\d+/i

/** A bare shell prompt with nothing typed after it (`$`, `>`, `PS C:\x>`, `❯`, `user@host:~$`). */
const SHELL_PROMPT = /^\s*(?:\S*[$#>%❯➜]|PS [^>]*>)\s*$/

/** At most this many lines and characters of error output go to the model. */
export const ERROR_MAX_LINES = 150
export const ERROR_MAX_CHARS = 8000
/** Lines kept before the first error line, for the command and what led to it. */
const LEAD_LINES = 12

/**
 * The part of the output that shows the latest error: from a little before the first error line of
 * the last error block to the end. Without any error line, the last lines as they are. Blank runs
 * collapse; very long lines are cut.
 */
export function extractError(lines: string[]): { text: string; found: boolean } {
  const clean = lines.map((line) => line.trimEnd().slice(0, 400))
  // Drop trailing blank lines and the shell prompt that follows a failed command.
  while (clean.length > 0 && (!clean[clean.length - 1].trim() || SHELL_PROMPT.test(clean[clean.length - 1]))) clean.pop()
  const window = clean.slice(-ERROR_MAX_LINES * 2)
  let last = -1
  for (let index = window.length - 1; index >= 0; index--) {
    if (ERROR_LINE.test(window[index])) {
      last = index
      break
    }
  }
  let start = Math.max(0, window.length - 60)
  if (last >= 0) {
    // Walk back over the block the last error line belongs to (gaps of up to 3 non-error lines).
    let first = last
    let gap = 0
    for (let index = last - 1; index >= 0 && gap <= 3; index--) {
      if (ERROR_LINE.test(window[index])) {
        first = index
        gap = 0
      } else gap++
    }
    start = Math.max(0, first - LEAD_LINES, window.length - ERROR_MAX_LINES)
  }
  const kept: string[] = []
  for (const line of window.slice(start)) {
    if (!line.trim() && !kept[kept.length - 1]?.trim()) continue
    kept.push(line)
  }
  let text = kept.join('\n').trim()
  if (text.length > ERROR_MAX_CHARS) text = `…\n${text.slice(-ERROR_MAX_CHARS)}`
  return { text, found: last >= 0 }
}
