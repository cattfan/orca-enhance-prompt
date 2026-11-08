// Model profiles in storage, their keys in secrets, and the fallback chain.
import type { OrcaWorkerApi } from 'orca/worker'
import { complete, isLocalUrl, isTransient, LlmError } from './llm'
import {
  MODELS_KEY,
  modelsToJson,
  parseModelsConfig,
  presetById,
  PRESETS,
  type ModelProfile,
  type ModelsConfig,
  type ProfileView
} from './presets'

export const secretName = (profileId: string) => `apiKey.${profileId}`

/** Profiles synthesized from environment keys when the person has not added any. */
function envProfiles(): ModelProfile[] {
  const out: ModelProfile[] = []
  for (const preset of PRESETS) {
    if (preset.env && process.env[preset.env]) {
      out.push({
        id: `env-${preset.id}`,
        name: `${preset.label} (env)`,
        preset: preset.id,
        provider: preset.provider,
        baseUrl: preset.baseUrl,
        model: preset.model,
        temperature: 0.3,
        maxTokens: 2000,
        enabled: true
      })
    }
  }
  return out
}

export async function loadModels(orca: OrcaWorkerApi): Promise<ModelsConfig & { fromEnv: boolean }> {
  const config = parseModelsConfig(await orca.storage.get(MODELS_KEY))
  if (config.profiles.length > 0) {
    return { ...config, fromEnv: false }
  }
  return { profiles: envProfiles(), hookProfileId: null, selectorProfileId: null, fromEnv: true }
}

export async function saveModels(orca: OrcaWorkerApi, config: ModelsConfig): Promise<void> {
  await orca.storage.set(MODELS_KEY, modelsToJson(config))
}

export function needsKey(profile: ModelProfile): boolean {
  return !(profile.provider === 'openai' && isLocalUrl(effectiveBaseUrl(profile)))
}

export function effectiveBaseUrl(profile: ModelProfile): string {
  return profile.baseUrl || presetById(profile.preset).baseUrl
}

export function effectiveModel(profile: ModelProfile): string {
  return profile.model || presetById(profile.preset).model
}

export async function resolveKey(
  orca: OrcaWorkerApi,
  profile: ModelProfile
): Promise<{ key: string | null; source: ProfileView['keySource'] }> {
  if (!needsKey(profile)) {
    const stored = await orca.secrets.get(secretName(profile.id)).catch(() => null)
    return { key: stored, source: stored ? 'secret' : 'not-needed' }
  }
  const stored = await orca.secrets.get(secretName(profile.id)).catch(() => null)
  if (stored) {
    return { key: stored, source: 'secret' }
  }
  const env = presetById(profile.preset).env
  if (env && process.env[env]) {
    return { key: process.env[env] ?? null, source: 'env' }
  }
  return { key: null, source: 'none' }
}

export async function viewProfiles(orca: OrcaWorkerApi, profiles: ModelProfile[]): Promise<ProfileView[]> {
  return Promise.all(
    profiles.map(async (profile) => ({
      ...profile,
      baseUrl: effectiveBaseUrl(profile),
      model: effectiveModel(profile),
      keySource: (await resolveKey(orca, profile)).source,
      envName: presetById(profile.preset).env
    }))
  )
}

export type Attempt = { profileId: string; name: string; model: string; ok: boolean; error?: string; ms: number }

export type ChainOptions = {
  /** The person's cancel. */
  signal?: AbortSignal
  /** Per-model timeout. */
  timeoutMs: number
  /** Whole chain budget (the hook's 2 s); defaults to unlimited. */
  totalMs?: number
  fallback: boolean
  fallbackOn: 'any' | 'transient'
}

export class ChainError extends Error {
  code: string
  attempts: Attempt[]
  constructor(message: string, code: string, attempts: Attempt[]) {
    super(message)
    this.code = code
    this.attempts = attempts
  }
}

/**
 * Orders the candidates: a chosen profile first, then (with fallback) the other enabled
 * profiles in their saved order.
 */
export function candidates(profiles: ModelProfile[], preferredId: string | null, fallback: boolean): ModelProfile[] {
  const enabled = profiles.filter((profile) => profile.enabled)
  const preferred = preferredId ? profiles.find((profile) => profile.id === preferredId) : undefined
  const ordered = preferred ? [preferred, ...enabled.filter((p) => p.id !== preferred.id)] : enabled
  return fallback ? ordered : ordered.slice(0, 1)
}

export async function runChain(
  orca: OrcaWorkerApi,
  list: ModelProfile[],
  system: string,
  user: string,
  options: ChainOptions
): Promise<{ text: string; profile: ModelProfile; attempts: Attempt[] }> {
  const attempts: Attempt[] = []
  if (list.length === 0) {
    throw new ChainError('No model configured. Add one in the Models tab.', 'invalid_params', attempts)
  }
  const started = Date.now()
  let lastError: unknown = null
  for (const profile of list) {
    if (options.signal?.aborted) {
      break
    }
    const remaining = options.totalMs === undefined ? options.timeoutMs : options.totalMs - (Date.now() - started)
    if (remaining <= 50) {
      break
    }
    const attemptStart = Date.now()
    const model = effectiveModel(profile)
    const { key } = await resolveKey(orca, profile)
    if (!key && needsKey(profile)) {
      attempts.push({ profileId: profile.id, name: profile.name, model, ok: false, error: 'no API key', ms: 0 })
      lastError = new LlmError(`${profile.name}: no API key`, 'invalid_params')
      continue
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(options.timeoutMs, remaining))
    const onAbort = () => controller.abort()
    options.signal?.addEventListener('abort', onAbort)
    try {
      const text = await complete(
        {
          provider: profile.provider,
          baseUrl: effectiveBaseUrl(profile),
          model,
          apiKey: key,
          envName: presetById(profile.preset).env,
          temperature: profile.temperature,
          maxTokens: profile.maxTokens
        },
        system,
        user,
        controller.signal
      )
      attempts.push({ profileId: profile.id, name: profile.name, model, ok: true, ms: Date.now() - attemptStart })
      return { text, profile, attempts }
    } catch (error) {
      lastError = error
      attempts.push({
        profileId: profile.id,
        name: profile.name,
        model,
        ok: false,
        error: (error as Error).message,
        ms: Date.now() - attemptStart
      })
      if (options.signal?.aborted) {
        break
      }
      if (options.fallbackOn === 'transient' && !isTransient(error)) {
        break
      }
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }
  if (options.signal?.aborted) {
    throw new ChainError('Cancelled.', 'cancelled', attempts)
  }
  const tried = attempts.map((a) => `${a.name}: ${a.error ?? 'skipped'}`).join(' · ')
  const code = lastError instanceof LlmError ? lastError.code : 'action_failed'
  throw new ChainError(
    attempts.length > 1 ? `All models failed. ${tried}` : ((lastError as Error | null)?.message ?? 'Out of time.'),
    code,
    attempts
  )
}
