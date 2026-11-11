// What the plugin may actually do. Orca approves a plugin's capabilities as a whole; these switches
// (Orca's Settings and the panel's own Settings tab) narrow what the worker uses, and the worker checks them
// before every read, send, save or download.
import type { JsonValue } from 'orca'

export const PRIVACY_KEYS = [
  'allowProjectFiles',
  'allowGit',
  'allowTerminalRead',
  'allowOtherAgents',
  'allowAgentActivity',
  'allowEditorSaves',
  'allowTerminalSend',
  'allowAgentLaunch',
  'allowOpenFiles',
  'saveHistory',
  'allowEnvKeys',
  'allowOnlineModelLists'
] as const
export type PrivacyKey = (typeof PRIVACY_KEYS)[number]
export type Privacy = Record<PrivacyKey, boolean>

/**
 * Switches that start off: they came after 2.4.5, and turning them on by themselves would read or do
 * more than people agreed to.
 */
export const OFF_BY_DEFAULT: ReadonlySet<PrivacyKey> = new Set<PrivacyKey>(['allowOtherAgents', 'allowAgentActivity', 'allowEditorSaves', 'allowAgentLaunch'])

/**
 * Switches that also need the person's confirmation in the panel, after reading what they allow:
 * they send other sessions' output or every agent action to the model, or start programs. Turned on
 * in Orca's Settings alone, they stay off until confirmed.
 */
export const NEEDS_CONSENT: ReadonlySet<PrivacyKey> = new Set<PrivacyKey>(['allowOtherAgents', 'allowAgentActivity', 'allowAgentLaunch'])

/** Where the worker keeps the confirmations: `{ [key]: true }`. */
export const CONSENTS_KEY = 'consents'
export type Consents = Partial<Record<PrivacyKey, boolean>>

export function parseConsents(value: JsonValue | null | undefined): Consents {
  const out: Consents = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const key of NEEDS_CONSENT) if ((value as Record<string, JsonValue>)[key] === true) out[key] = true
  return out
}

/**
 * The switches as set (on by default, except OFF_BY_DEFAULT). With `consents`, what the worker may
 * actually do: a switch that needs confirmation counts only once it is confirmed.
 */
export function parsePrivacy(settings: Record<string, JsonValue | undefined>, consents?: Consents): Privacy {
  const out = {} as Privacy
  for (const key of PRIVACY_KEYS) {
    const on = OFF_BY_DEFAULT.has(key) ? settings[key] === true : settings[key] !== false
    out[key] = consents && NEEDS_CONSENT.has(key) ? on && consents[key] === true : on
  }
  return out
}

/**
 * How much "Read other agents' sessions" reads: how many agents and how many lines of each terminal.
 * The defaults are what 2.4.x read. The bounds keep the context budget sane: at most 8 agents of at
 * most 300 lines (each session then keeps at most 8,000 characters, and the whole Max context is
 * still cut to its budget, other agents last).
 */
export const OTHER_AGENTS_LIMITS = {
  agents: { key: 'otherAgentsMax', min: 1, max: 8, default: 4 },
  lines: { key: 'otherAgentsLines', min: 10, max: 300, default: 80 }
} as const
export type OtherAgentsLimits = { agents: number; lines: number }

/** A whole number within [min, max]; anything else (not a number, empty) is the default. */
export function clampSetting(value: JsonValue | undefined, spec: { min: number; max: number; default: number }): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  if (!Number.isFinite(number)) return spec.default
  return Math.min(spec.max, Math.max(spec.min, Math.round(number)))
}

export function parseOtherAgentsLimits(settings: Record<string, JsonValue | undefined>): OtherAgentsLimits {
  return {
    agents: clampSetting(settings[OTHER_AGENTS_LIMITS.agents.key], OTHER_AGENTS_LIMITS.agents),
    lines: clampSetting(settings[OTHER_AGENTS_LIMITS.lines.key], OTHER_AGENTS_LIMITS.lines)
  }
}
