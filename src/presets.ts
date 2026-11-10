// Model presets and profile parsing, shared by the panel and the worker (no Node imports).
import type { Message } from './messages.ts'
import type { JsonValue } from 'orca'

/** `cli` runs an installed agent CLI (Claude Code, Codex, Gemini CLI) on the person's subscription. */
export type Provider = 'openai' | 'anthropic' | 'cli'

export type Preset = {
  id: string
  label: string
  provider: Provider
  baseUrl: string
  model: string
  /** Environment variable read when the profile has no saved key; '' when none is needed. */
  env: string
}

export const PRESETS: Preset[] = [
  { id: 'openai', label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', env: 'OPENAI_API_KEY' },
  { id: 'anthropic', label: 'Anthropic', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-4-5', env: 'ANTHROPIC_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini', env: 'OPENROUTER_API_KEY' },
  { id: 'gemini', label: 'Google Gemini', provider: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', env: 'GEMINI_API_KEY' },
  { id: 'groq', label: 'Groq', provider: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', env: 'GROQ_API_KEY' },
  { id: 'deepseek', label: 'DeepSeek', provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', env: 'DEEPSEEK_API_KEY' },
  { id: 'mistral', label: 'Mistral', provider: 'openai', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', env: 'MISTRAL_API_KEY' },
  { id: 'ollama', label: 'Ollama (local)', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder', env: '' },
  { id: 'lmstudio', label: 'LM Studio (local)', provider: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'local-model', env: '' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', provider: 'openai', baseUrl: '', model: '', env: '' },
  // Subscription CLIs: `baseUrl` is unused, `model` is optional (the CLI's default otherwise).
  { id: 'claude-code', label: 'Claude Code (subscription)', provider: 'cli', baseUrl: '', model: 'haiku', env: '' },
  { id: 'codex', label: 'Codex CLI (ChatGPT subscription)', provider: 'cli', baseUrl: '', model: '', env: '' },
  { id: 'gemini-cli', label: 'Gemini CLI (Google account)', provider: 'cli', baseUrl: '', model: '', env: '' },
  { id: 'custom-cli', label: 'Custom CLI (prompt on stdin)', provider: 'cli', baseUrl: '', model: '', env: '' }
]

export const isCliPreset = (id: string) => presetById(id).provider === 'cli'

/** The preset used for an unknown id: OpenAI-compatible, everything typed by the person. */
const CUSTOM_PRESET: Preset = PRESETS.find((preset) => preset.id === 'custom') ?? {
  id: 'custom',
  label: 'Custom (OpenAI-compatible)',
  provider: 'openai',
  baseUrl: '',
  model: '',
  env: ''
}

export function presetById(id: string): Preset {
  return PRESETS.find((preset) => preset.id === id) ?? CUSTOM_PRESET
}

export type ModelProfile = {
  id: string
  name: string
  preset: string
  provider: Provider
  baseUrl: string
  model: string
  /** The most tokens one answer may take. For a model that thinks first, its thinking counts too. */
  maxTokens: number
  enabled: boolean
  /** CLI profiles: executable name or full path ('' = the preset's default binary). */
  command: string
  /** Custom CLI only: arguments (plain tokens, no quotes). */
  args: string
}

export type ModelsConfig = {
  /** In fallback order: the first enabled profile is tried first. */
  profiles: ModelProfile[]
  /** Profile for the auto-enhance hook (2 s budget); null = the chain. */
  hookProfileId: string | null
  /** Profile that picks relevant files at the Max context level; null = the chain. */
  selectorProfileId: string | null
}

/** What the panel sees: never the key itself. */
/**
 * A profile for the panel. `baseUrl` and `model` are what the person saved ('' = follow the preset, or
 * the CLI's own default); `effectiveBaseUrl` and `effectiveModel` are what a run actually uses. Edits
 * send the saved values back, so a preset default is never written into the profile by accident.
 */
export type ProfileView = ModelProfile & {
  effectiveBaseUrl: string
  effectiveModel: string
  keySource: 'secret' | 'env' | 'none' | 'not-needed' | 'subscription'
  envName: string
}

export const MODELS_KEY = 'models'

/**
 * Max tokens of a new profile. An enhanced prompt is rarely over 2,000 tokens, but current models
 * think before they answer and that thinking counts against the same limit: with too low a limit
 * the answer is cut off, or never starts.
 */
export const DEFAULT_MAX_TOKENS = 8000

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)
const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export function normalizeProfile(value: unknown): ModelProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const raw = value as Record<string, unknown>
  const id = str(raw.id)
  if (!/^[a-z0-9-]{1,40}$/.test(id)) {
    return null
  }
  const preset = presetById(str(raw.preset, 'custom'))
  return {
    id,
    name: str(raw.name).trim().slice(0, 60) || preset.label,
    preset: preset.id,
    provider: preset.provider === 'cli' ? 'cli' : raw.provider === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: str(raw.baseUrl).trim().slice(0, 500),
    model: str(raw.model).trim().slice(0, 200),
    // A profile saved before 2.5.4 also carries `temperature`: it is dropped here, and never sent.
    maxTokens: Math.round(Math.min(32000, Math.max(128, num(raw.maxTokens, DEFAULT_MAX_TOKENS)))),
    enabled: raw.enabled !== false,
    command: str(raw.command).trim().slice(0, 500),
    args: str(raw.args).trim().slice(0, 500)
  }
}

export function parseModelsConfig(value: JsonValue | null): ModelsConfig {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const list = Array.isArray(raw.profiles) ? raw.profiles : []
  const profiles: ModelProfile[] = []
  for (const item of list) {
    const profile = normalizeProfile(item)
    if (profile && !profiles.some((existing) => existing.id === profile.id)) {
      profiles.push(profile)
    }
  }
  const ref = (id: unknown) => (typeof id === 'string' && profiles.some((p) => p.id === id) ? id : null)
  return { profiles, hookProfileId: ref(raw.hookProfileId), selectorProfileId: ref(raw.selectorProfileId) }
}

export function modelsToJson(config: ModelsConfig): JsonValue {
  return {
    profiles: config.profiles.map((profile) => ({ ...profile })),
    hookProfileId: config.hookProfileId,
    selectorProfileId: config.selectorProfileId
  }
}

export function newProfileId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'model'
  return `${slug}-${Math.random().toString(36).slice(2, 6)}`
}

export const CONTEXT_LEVELS = ['off', 'basic', 'standard', 'deep', 'max'] as const
export type ContextLevel = (typeof CONTEXT_LEVELS)[number]
export const CONTEXT_LEVEL_LABELS: Record<ContextLevel, string> = {
  off: 'Off: prompt only',
  basic: 'Basic: workspace + agent',
  standard: 'Standard: + rules, stack, tree',
  deep: 'Deep: + git + relevant code',
  max: 'Max: + AI-picked files + terminal'
}
export function isContextLevel(value: unknown): value is ContextLevel {
  return typeof value === 'string' && (CONTEXT_LEVELS as readonly string[]).includes(value)
}

/** One piece of context the rewriter saw; `id` is stable so the person can exclude it. */
/**
 * A context item as the panel lists it. `label` and `note` are English (the model reads them);
 * `title` and `why` are the same as Messages, for the panel's language.
 */
export type ContextItemView = { id: string; kind: string; label: string; chars: number; note?: string; title?: Message; why?: Message }
