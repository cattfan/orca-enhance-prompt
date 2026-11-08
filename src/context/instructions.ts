// Agent rule files and a README digest (the useful sections, not just the first N chars).
import { readText } from './files.ts'

/** Rule files agents themselves read, most specific first. */
const RULE_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.github/copilot-instructions.md',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
  'CONTRIBUTING.md'
]

const README_SECTIONS = /install|setup|getting started|usage|develop|test|build|run|contribut|architecture|structure|overview|stack|scripts|commands/i

export type TextItem = { name: string; content: string }

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text
}

/** Intro paragraph plus sections whose heading looks like setup/dev/test/architecture. */
export function readmeDigest(text: string, max: number): string {
  const lines = text.split(/\r?\n/)
  const sections: { heading: string; body: string[] }[] = [{ heading: '', body: [] }]
  let inFence = false
  for (const line of lines) {
    if (/^```/.test(line.trim())) inFence = !inFence
    const heading = !inFence && /^#{1,4}\s+/.test(line)
    if (heading) {
      sections.push({ heading: line, body: [] })
    } else {
      sections[sections.length - 1].body.push(line)
    }
  }
  // The intro is the text before the first heading, or under a leading H1 title.
  const introLines = [...sections[0].body]
  if (sections[1] && /^#\s/.test(sections[1].heading)) {
    introLines.push(...sections.splice(1, 1)[0].body)
  }
  const intro = introLines.join('\n').replace(/<[^>]+>/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim()
  const picked = sections.slice(1).filter((section) => README_SECTIONS.test(section.heading))
  const parts = [cap(intro, Math.floor(max / 4))]
  for (const section of picked) {
    parts.push(`${section.heading}\n${section.body.join('\n').trim()}`)
  }
  return cap(parts.filter(Boolean).join('\n\n'), max)
}

export async function readRuleFiles(
  root: string,
  fileList: string[],
  extra: string[],
  budget: number
): Promise<TextItem[]> {
  const present = new Set(fileList)
  const cursorRules = fileList.filter((f) => f.startsWith('.cursor/rules/') && /\.mdc?$/.test(f)).slice(0, 4)
  const names = [...new Set([...extra, ...RULE_FILES, ...cursorRules])]
  const out: TextItem[] = []
  let used = 0
  for (const name of names) {
    if (used >= budget) break
    if (!present.has(name) && !extra.includes(name)) continue
    const text = await readText(root, name)
    if (!text?.trim()) continue
    const content = cap(text.trim(), Math.min(4000, budget - used))
    used += content.length
    out.push({ name, content })
  }
  const readme = fileList.find((f) => /^readme(\.md|\.rst|\.txt)?$/i.test(f))
  if (readme && used < budget) {
    const text = await readText(root, readme)
    if (text?.trim()) {
      out.push({ name: readme, content: readmeDigest(text, Math.min(3500, budget - used)) })
    }
  }
  return out
}
