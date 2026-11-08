// What the plugin may actually do. Orca approves a plugin's capabilities as a whole; these switches
// (Settings and the panel's Privacy tab) narrow what the worker uses, and the worker checks them
// before every read, send, save or download.
import type { JsonValue } from 'orca'

export const PRIVACY_KEYS = [
  'allowProjectFiles',
  'allowGit',
  'allowTerminalRead',
  'allowTerminalSend',
  'saveHistory',
  'allowEnvKeys',
  'allowOnlineModelLists'
] as const
export type PrivacyKey = (typeof PRIVACY_KEYS)[number]
export type Privacy = Record<PrivacyKey, boolean>

/** Everything on by default, so the plugin works as documented; each switch turns one thing off. */
export function parsePrivacy(settings: Record<string, JsonValue | undefined>): Privacy {
  const out = {} as Privacy
  for (const key of PRIVACY_KEYS) out[key] = settings[key] !== false
  return out
}
