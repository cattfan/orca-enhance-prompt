// Minimal clients for OpenAI-compatible /chat/completions and Anthropic /v1/messages.
// Uses the worker's global fetch; the prompt goes only to the endpoint the person configured.

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
  constructor(message: string, code = 'action_failed', status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
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
    throw new LlmError(`Invalid API base URL: ${base}`, 'invalid_params')
  }
  const local = isLocalUrl(base)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new LlmError('The API base URL must use https (http is allowed only for localhost).', 'invalid_params')
  }
  if (url.username || url.password) {
    throw new LlmError('Put the API key in the Setup tab, not in the URL.', 'invalid_params')
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
    if (signal?.aborted) throw new LlmError('The request was cancelled or timed out.', 'timeout')
    throw new LlmError(`${baseUrl} stopped answering: ${(error as Error).message}`, 'unavailable')
  }
  try {
    return JSON.parse(body) as unknown
  } catch {
    const type = response.headers.get('content-type')?.split(';')[0] || 'no content type'
    const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
    const what = body.trim() ? `${type}: "${text}"` : 'an empty answer'
    throw new LlmError(`${baseUrl} did not answer with JSON (${what}). A proxy or sign-in page may be in the way.`, 'unavailable')
  }
}

export async function complete(
  config: LlmConfig,
  system: string,
  user: string,
  signal?: AbortSignal
): Promise<string> {
  if (!config.apiKey && !(config.provider === 'openai' && isLocalUrl(config.baseUrl))) {
    throw new LlmError(
      `No API key. Add one in the Enhance Prompt panel (Models tab)${config.envName ? ` or set ${config.envName}` : ''}.`,
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
              messages: [{ role: 'user', content: user }]
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
                { role: 'user', content: user }
              ]
            })
          })
  } catch (error) {
    if (error instanceof LlmError) {
      throw error
    }
    if (signal?.aborted) {
      throw new LlmError('The request was cancelled or timed out.', 'timeout')
    }
    throw new LlmError(`Could not reach ${config.baseUrl}: ${(error as Error).message}`, 'unavailable')
  }
  if (!response.ok) {
    const code = response.status === 429 ? 'rate_limited' : 'action_failed'
    throw new LlmError(`${response.status}: ${await readError(response)}`, code, response.status)
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
    throw new LlmError('The model returned an empty answer.')
  }
  return text
}
