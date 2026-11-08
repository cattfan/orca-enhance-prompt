// Model catalogs that keep themselves current:
//   Claude Code  aliases from `claude --help` and the Claude Code settings schema (schemastore.org),
//                which always point at the newest model; restricted by your `availableModels`.
//   Codex CLI    `codex debug models`: the catalog Codex itself shows (visibility "list").
//   Gemini CLI   known models plus the one in ~/.gemini/settings.json.
//   APIs         GET /models (OpenAI-compatible) or /v1/models (Anthropic) with the profile's key.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLI_BINARIES, readCommand, resolveBinary } from './cli'
import { endpointUrl } from './llm'
import type { Provider } from './presets'

export type CatalogModel = { id: string; label: string; description?: string; isDefault?: boolean }
export type Catalog = { models: CatalogModel[]; source: string; fetchedAt: number; error?: string }

/** A cached catalog from storage, or null when it is missing or malformed. */
export function parseCatalog(value: unknown): Catalog | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.fetchedAt !== 'number' || !Array.isArray(raw.models)) return null
  const models: CatalogModel[] = []
  for (const item of raw.models) {
    if (!item || typeof item !== 'object') continue
    const model = item as Record<string, unknown>
    if (typeof model.id !== 'string') continue
    models.push({
      id: model.id,
      label: typeof model.label === 'string' ? model.label : model.id,
      ...(typeof model.description === 'string' ? { description: model.description } : {}),
      ...(model.isDefault === true ? { isDefault: true } : {})
    })
  }
  return { models, source: typeof raw.source === 'string' ? raw.source : 'cache', fetchedAt: raw.fetchedAt }
}

const CLAUDE_SCHEMA_URL = 'https://www.schemastore.org/claude-code-settings.json'

/** What each Claude Code alias means; unknown aliases still show up, with a generic label. */
const CLAUDE_ALIAS_INFO: Record<string, string> = {
  default: 'Account default',
  opus: 'Opus, newest',
  sonnet: 'Sonnet, newest',
  haiku: 'Haiku, newest (fastest)',
  fable: 'Fable, newest',
  opusplan: 'Opus plans, Sonnet writes'
}
const NOT_ALIASES = new Set(['model', 'models', 'alias', 'none', 'null', 'true', 'false', 'auto', 'string'])

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Single-word quoted aliases near the word "alias", e.g. `'fable', 'opus', or 'sonnet'`. */
export function aliasesFromText(text: string): string[] {
  const found = new Set<string>()
  // Look just after each "alias": "e.g." and version numbers make sentence splitting unreliable.
  for (const hit of text.matchAll(/alias/gi)) {
    const window = text.slice(hit.index, hit.index + 160)
    for (const match of window.matchAll(/["'\u2018\u201c]([a-z][a-z0-9-]{2,20})["'\u2019\u201d]/g)) {
      if (!NOT_ALIASES.has(match[1])) found.add(match[1])
    }
  }
  return [...found]
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 8000): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function claudeCatalog(command: string): Promise<Catalog> {
  const aliases = new Set<string>(['default', 'opus', 'sonnet', 'haiku'])
  const sources: string[] = ['built-in']
  const binary = resolveBinary(command || CLI_BINARIES['claude-code'])
  if (binary) {
    const help = await readCommand(binary, ['--help'], 10_000)
    if (help) {
      const modelHelp = help.slice(help.indexOf('--model'), help.indexOf('--model') + 400).replace(/\s+/g, ' ')
      aliasesFromText(modelHelp).forEach((alias) => aliases.add(alias))
      sources.push('claude --help')
    }
  }
  try {
    const schema = (await fetchJson(CLAUDE_SCHEMA_URL, {})) as { properties?: Record<string, { description?: string }> }
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      if (/model/i.test(key) && property.description) aliasesFromText(property.description).forEach((alias) => aliases.add(alias))
    }
    sources.push('schemastore')
  } catch {
    // offline: the CLI's own help and the built-in aliases still apply
  }
  const settings = await readJson(join(homedir(), '.claude', 'settings.json'))
  const current = typeof settings?.model === 'string' ? settings.model : null
  if (current) aliases.add(current)
  const env = (settings?.env ?? {}) as Record<string, unknown>
  for (const key of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL']) {
    if (typeof env[key] === 'string') aliases.add(env[key])
  }
  let list = [...aliases]
  const allowed = Array.isArray(settings?.availableModels) ? settings.availableModels.filter((m): m is string => typeof m === 'string') : []
  if (allowed.length > 0) list = list.filter((alias) => alias === 'default' || allowed.includes(alias))
  const order = ['haiku', 'sonnet', 'opus', 'fable', 'opusplan', 'default']
  list.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b))
  return {
    models: list.map((id) => ({
      id,
      label: CLAUDE_ALIAS_INFO[id] ? `${id}: ${CLAUDE_ALIAS_INFO[id]}` : id,
      ...(id === current ? { isDefault: true, description: 'Your Claude Code default' } : {})
    })),
    source: sources.join(' + '),
    fetchedAt: Date.now()
  }
}

export async function codexCatalog(command: string): Promise<Catalog> {
  const binary = resolveBinary(command || CLI_BINARIES.codex)
  if (!binary) return { models: [], source: 'codex', fetchedAt: Date.now(), error: 'codex not found' }
  const out = await readCommand(binary, ['debug', 'models'], 20_000)
  const config = await readFile(join(homedir(), '.codex', 'config.toml'), 'utf8').catch(() => '')
  const current = /^\s*model\s*=\s*"([^"]+)"/m.exec(config)?.[1] ?? null
  let models: CatalogModel[] = []
  try {
    const parsed = JSON.parse(out ?? '') as {
      models?: { slug?: string; display_name?: string; description?: string; visibility?: string; priority?: number }[]
    }
    models = (parsed.models ?? [])
      .filter((model) => model.slug && model.visibility === 'list')
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      .map((model) => ({
        id: model.slug!,
        label: model.display_name ?? model.slug!,
        description: model.description,
        ...(model.slug === current ? { isDefault: true } : {})
      }))
  } catch {
    return { models: [], source: 'codex debug models', fetchedAt: Date.now(), error: 'could not read the Codex model catalog' }
  }
  if (current && !models.some((model) => model.id === current)) models.unshift({ id: current, label: current, isDefault: true })
  return { models, source: 'codex debug models', fetchedAt: Date.now() }
}

export async function geminiCatalog(): Promise<Catalog> {
  const settings = await readJson(join(homedir(), '.gemini', 'settings.json'))
  const configured = (settings?.model as { name?: string } | undefined)?.name
  const ids = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite']
  if (configured && !ids.includes(configured)) ids.unshift(configured)
  return {
    models: ids.map((id) => ({ id, label: id, ...(id === configured ? { isDefault: true } : {}) })),
    source: 'built-in + ~/.gemini/settings.json',
    fetchedAt: Date.now()
  }
}

/** Models an API endpoint lists, newest-looking first. */
export async function apiCatalog(provider: Provider, baseUrl: string, apiKey: string | null): Promise<Catalog> {
  try {
    if (provider === 'anthropic') {
      const data = (await fetchJson(endpointUrl(baseUrl, '/v1/messages').href.replace(/\/v1\/messages$/, '/v1/models?limit=100'), {
        headers: { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' }
      })) as { data?: { id: string; display_name?: string }[] }
      return {
        models: (data.data ?? []).map((model) => ({ id: model.id, label: model.display_name ? `${model.display_name} (${model.id})` : model.id })),
        source: 'GET /v1/models',
        fetchedAt: Date.now()
      }
    }
    const url = endpointUrl(baseUrl, '/chat/completions').href.replace(/\/chat\/completions$/, '/models')
    const data = (await fetchJson(url, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} })) as {
      data?: { id: string; name?: string; created?: number }[]
    }
    const models = (data.data ?? [])
      .filter((model) => typeof model.id === 'string')
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id))
      .slice(0, 400)
      .map((model) => ({ id: model.id, label: model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id }))
    return { models, source: 'GET /models', fetchedAt: Date.now() }
  } catch (error) {
    return { models: [], source: 'GET /models', fetchedAt: Date.now(), error: (error as Error).message }
  }
}
