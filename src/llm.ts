// Minimal clients for OpenAI-compatible /chat/completions and Anthropic /v1/messages.
// Uses the worker's global fetch; the prompt goes only to the endpoint the person configured.

import { english, msg, raw, type Message } from './messages.ts'
import type { Provider } from './presets.ts'

export type { Provider }

export type LlmConfig = {
  provider: Provider
  baseUrl: string
  model: string
  apiKey: string | null
  /** Environment variable named in the missing-key message. */
  envName?: string
  temperature: number
  maxTokens: number
}

export class LlmError extends Error {
  code: string
  /** HTTP status when the endpoint answered with an error. */
  status?: number
  /** The message as a code and parameters, for the panel to show in its language. */
  text: Message
  constructor(message: Message | string, code = 'action_failed', status?: number) {
    const text = typeof message === 'string' ? raw(message) : message
    super(english(text))
    this.text = text
    this.code = code
    this.status = status
  }
}

/** An error's message as a Message: its own when it has one, else its text as is. */
export function messageOf(error: unknown): Message {
  if (error && typeof error === 'object' && 'text' in error && (error as { text: unknown }).text) {
    const text = (error as { text: Message }).text
    if (typeof text === 'object' && typeof text.code === 'string') return text
  }
  return raw(error instanceof Error ? error.message : String(error))
}

/** Errors worth retrying on another model: network, timeout, rate limit, server side. */
export function isTransient(error: unknown): boolean {
  if (!(error instanceof LlmError)) {
    return false
  }
  if (error.code === 'timeout' || error.code === 'unavailable' || error.code === 'rate_limited') {
    return true
  }
  return error.status !== undefined && (error.status >= 500 || error.status === 408)
}

/** Whether a base URL points at this machine, where a key is usually not needed (Ollama, LM Studio). */
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

/**
 * Validates the person's configured base URL and returns the endpoint URL. Only https is allowed,
 * or plain http to this machine (Ollama, LM Studio); credentials in the URL are refused.
 */
export function endpointUrl(base: string, path: '/chat/completions' | '/v1/messages'): URL {
  let url: URL
  try {
    url = new URL(base)
  } catch {
    throw new LlmError(msg('error.bad_url', { url: base }), 'invalid_params')
  }
  const local = isLocalUrl(base)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new LlmError(msg('error.https_only'), 'invalid_params')
  }
  if (url.username || url.password) {
    throw new LlmError(msg('error.key_in_url'), 'invalid_params')
  }
  url.search = ''
  url.hash = ''
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`
  return url
}

async function readError(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    const message =
      typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? parsed.message)
    if (message) {
      return message
    }
  } catch {
    // not JSON
  }
  return body.slice(0, 300) || response.statusText
}

/**
 * The answer's JSON. A proxy, captive portal or broken gateway can answer 200 with an HTML page or
 * nothing at all: that is reported as the endpoint being unavailable (so fallback moves on, also
 * with "transient only"), naming what came back instead of a bare "Unexpected token <".
 */
async function readJson(response: Response, baseUrl: string, signal?: AbortSignal): Promise<unknown> {
  let body: string
  try {
    body = await response.text()
  } catch (error) {
    if (signal?.aborted) throw new LlmError(msg('error.timeout'), 'timeout')
    throw new LlmError(msg('error.stopped', { url: baseUrl, detail: (error as Error).message }), 'unavailable')
  }
  try {
    return JSON.parse(body) as unknown
  } catch {
    const type = response.headers.get('content-type')?.split(';')[0] || 'no content type'
    const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
    const what = body.trim() ? raw(`${type}: "${text}"`) : msg('error.empty_body')
    throw new LlmError(msg('error.not_json', { url: baseUrl, what }), 'unavailable')
  }
}

/** A picture for a model that reads images: its type and bytes in base64. */
export type LlmImage = { type: string; base64: string }

export async function complete(
  config: LlmConfig,
  system: string,
  user: string,
  signal?: AbortSignal,
  images: readonly LlmImage[] = []
): Promise<string> {
  if (!config.apiKey && !(config.provider === 'openai' && isLocalUrl(config.baseUrl))) {
    throw new LlmError(
      config.envName ? msg('error.no_key_env', { env: config.envName }) : msg('error.no_key'),
      'invalid_params'
    )
  }
  let response: Response
  try {
    // endpointUrl throws LlmError for a bad URL; let it through unchanged below.
    response =
      config.provider === 'anthropic'
        ? await fetch(endpointUrl(config.baseUrl, '/v1/messages'), {
            method: 'POST',
            signal,
            headers: {
              'content-type': 'application/json',
              'x-api-key': config.apiKey ?? '',
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: config.model,
              max_tokens: config.maxTokens,
              temperature: config.temperature,
              system,
              messages: [
                {
                  role: 'user',
                  content:
                    images.length === 0
                      ? user
                      : [
                          ...images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.type, data: image.base64 } })),
                          { type: 'text', text: user }
                        ]
                }
              ]
            })
          })
        : await fetch(endpointUrl(config.baseUrl, '/chat/completions'), {
            method: 'POST',
            signal,
            headers: {
              'content-type': 'application/json',
              ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
            },
            body: JSON.stringify({
              model: config.model,
              max_tokens: config.maxTokens,
              temperature: config.temperature,
              messages: [
                { role: 'system', content: system },
                {
                  role: 'user',
                  content:
                    images.length === 0
                      ? user
                      : [
                          { type: 'text', text: user },
                          ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.type};base64,${image.base64}` } }))
                        ]
                }
              ]
            })
          })
  } catch (error) {
    if (error instanceof LlmError) {
      throw error
    }
    if (signal?.aborted) {
      throw new LlmError(msg('error.timeout'), 'timeout')
    }
    throw new LlmError(msg('error.unreachable', { url: config.baseUrl, detail: (error as Error).message }), 'unavailable')
  }
  if (!response.ok) {
    const code = response.status === 429 ? 'rate_limited' : 'action_failed'
    throw new LlmError(msg('error.http', { status: response.status, detail: await readError(response) }), code, response.status)
  }
  const data = (await readJson(response, config.baseUrl, signal)) as {
    content?: { type: string; text?: string }[]
    choices?: { message?: { content?: string | { type: string; text?: string }[] } }[]
  }
  let text = ''
  if (config.provider === 'anthropic') {
    text = (data.content ?? []).map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('')
  } else {
    const content = data.choices?.[0]?.message?.content
    text = Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : (content ?? '')
  }
  // Reasoning models served through compatible APIs sometimes inline their thinking.
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  if (!text) {
    throw new LlmError(msg('error.empty_answer'))
  }
  return text
}
