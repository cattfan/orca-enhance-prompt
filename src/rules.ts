// Your own rules for the rewriter (for every workspace or one), and prompt structures: the sections a
// prompt is written in. Kept in the plugin's storage under RULES_KEY; the panel edits them, the worker
// reads them for every run and for auto-enhance. No Node imports: both sides load this file.
import type { JsonValue } from 'orca'

export const RULES_KEY = 'rules'
export const MAX_RULES = 50
export const MAX_RULE_CHARS = 500
export const MAX_STRUCTURES = 20
export const MAX_SECTIONS = 12

/** `scope` is '' for every workspace, or a workspace's name. */
export type Rule = { id: string; text: string; enabled: boolean; scope: string }
export type Structure = { id: string; name: string; sections: string[] }
export type RulesConfig = { rules: Rule[]; structures: Structure[] }

/** Always available; section names are translated into the output language by the rewriter. */
export const BUILT_IN_STRUCTURES: Structure[] = [
  {
    id: 'brief',
    name: 'Task brief',
    sections: ['Goal', 'Background', 'Requirements', 'Constraints / out of scope', 'Edge cases', 'Acceptance criteria', 'Assumptions / questions']
  },
  { id: 'steps', name: 'Steps', sections: ['Goal', 'Steps', 'Verify'] }
]

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const id = (value: unknown) => {
  const text = str(value, 40)
  return /^[a-z0-9-]{1,40}$/.test(text) ? text : ''
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Keeps only well-formed rules and structures from whatever storage holds. */
export function parseRulesConfig(value: JsonValue | null | undefined): RulesConfig {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const rules: Rule[] = []
  for (const item of Array.isArray(raw.rules) ? raw.rules : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const rule = { id: id(item.id), text: str(item.text, MAX_RULE_CHARS), enabled: item.enabled !== false, scope: str(item.scope, 200) }
    if (rule.id && rule.text && rules.length < MAX_RULES) rules.push(rule)
  }
  const structures: Structure[] = []
  for (const item of Array.isArray(raw.structures) ? raw.structures : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const sections = (Array.isArray(item.sections) ? item.sections : []).map((section) => str(section, 80)).filter(Boolean).slice(0, MAX_SECTIONS)
    const structure = { id: id(item.id), name: str(item.name, 40), sections }
    if (structure.id && structure.name && sections.length > 0 && structures.length < MAX_STRUCTURES) structures.push(structure)
  }
  return { rules, structures }
}

export function rulesToJson(config: RulesConfig): JsonValue {
  return {
    rules: config.rules.map((rule) => ({ ...rule })),
    structures: config.structures.map((structure) => ({ ...structure, sections: [...structure.sections] }))
  }
}

/** The enabled rules that apply in a workspace (by its name), in their saved order. */
export function rulesFor(config: RulesConfig, workspace: string | null): string[] {
  return config.rules.filter((rule) => rule.enabled && (!rule.scope || rule.scope === workspace)).map((rule) => rule.text)
}

/** A built-in or saved structure by id; null for none or an unknown id. */
export function structureById(config: RulesConfig, structureId: string | null | undefined): Structure | null {
  if (!structureId) return null
  return [...BUILT_IN_STRUCTURES, ...config.structures].find((structure) => structure.id === structureId) ?? null
}
