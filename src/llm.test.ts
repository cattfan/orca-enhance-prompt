// What a model is sent, and what happens to an answer that stopped at the token limit.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { parseHistory } from './history.ts'
import { complete, LlmError, tokenLimitField, type LlmConfig } from './llm.ts'
import { DEFAULT_MAX_TOKENS, normalizeProfile } from './presets.ts'
import * as main from './worker.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Answers every request with `answer(url)` and keeps what was sent. */
function answering(answer: (url: string) => unknown): { url: string; body: Record<string, unknown> }[] {
  const sent: { url: string; body: Record<string, unknown> }[] = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return new Response(JSON.stringify(answer(String(url))), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return sent
}

const claude: LlmConfig = { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5', apiKey: 'k', maxTokens: 8000 }
const openai: LlmConfig = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini', apiKey: 'k', maxTokens: 8000 }
const groq: LlmConfig = { provider: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', apiKey: 'k', maxTokens: 8000 }
const ollama: LlmConfig = { provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder', apiKey: null, maxTokens: 8000 }

test('no sampling parameter is sent to any model: current ones refuse a request that sets temperature', async () => {
  const sent = answering((url) => (url.includes('anthropic') ? { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' } : { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }))
  for (const config of [claude, openai, groq, ollama]) assert.equal(await complete(config, 'system', 'user'), 'ok')
  for (const { url, body } of sent) {
    for (const field of ['temperature', 'top_p', 'top_k']) assert.ok(!(field in body), `${field} was sent to ${url}`)
  }
  // The token limit by the name each server knows: OpenAI itself has deprecated max_tokens (its
  // o-series models refuse it) for max_completion_tokens; Anthropic and the other servers take max_tokens.
  assert.deepEqual(
    sent.map(({ body }) => ({ max_tokens: body.max_tokens, max_completion_tokens: body.max_completion_tokens })),
    [
      { max_tokens: 8000, max_completion_tokens: undefined },
      { max_tokens: undefined, max_completion_tokens: 8000 },
      { max_tokens: 8000, max_completion_tokens: undefined },
      { max_tokens: 8000, max_completion_tokens: undefined }
    ]
  )
  assert.equal(tokenLimitField('https://api.openai.com/v1'), 'max_completion_tokens')
  assert.equal(tokenLimitField('https://openrouter.ai/api/v1'), 'max_tokens')
  assert.equal(tokenLimitField('not a url'), 'max_tokens')
})

test('an answer cut off at the token limit is an error naming the model and the limit, never a half-written prompt', async () => {
  // A model that thinks first can use the whole limit before it writes a word.
  answering(() => ({ content: [{ type: 'thinking', thinking: '' }], stop_reason: 'max_tokens' }))
  const thinking = await complete({ ...claude, model: 'claude-opus-5-5', maxTokens: 2000 }, 's', 'u').catch((error: unknown) => error)
  assert.ok(thinking instanceof LlmError)
  assert.equal(thinking.message, 'claude-opus-5-5 reached its limit of 2000 tokens before it finished. Raise Max tokens for this model in the Models tab.')
  assert.deepEqual(thinking.text, { code: 'error.cut_off', params: { model: 'claude-opus-5-5', max: 2000 } })

  // ...or stop in the middle of the prompt.
  answering(() => ({ content: [{ type: 'text', text: 'Fix the login pa' }], stop_reason: 'max_tokens' }))
  await assert.rejects(complete({ ...claude, maxTokens: 500 }, 's', 'u'), /claude-haiku-5-5 reached its limit of 500 tokens/)
  answering(() => ({ choices: [{ finish_reason: 'length', message: { content: 'Fix the login pa' } }] }))
  await assert.rejects(complete({ ...groq, maxTokens: 500 }, 's', 'u'), /llama-3\.3-70b-versatile reached its limit of 500 tokens/)

  // An answer that ended by itself is the prompt.
  answering(() => ({ choices: [{ finish_reason: 'stop', message: { content: 'Fix the login page.' } }] }))
  assert.equal(await complete(groq, 's', 'u'), 'Fix the login page.')
})

test('a cut-off answer falls back to the next model, and only the whole prompt is kept', async () => {
  answering((url) =>
    url.includes('groq') ? { choices: [{ finish_reason: 'stop', message: { content: 'Fix the login page.' } }] } : { choices: [{ finish_reason: 'length', message: { content: 'Fix the lo' } }] }
  )
  const profile = (id: string, baseUrl: string) => ({ id, name: id, preset: 'openai', provider: 'openai', baseUrl, model: 'm', maxTokens: 1000, enabled: true })
  const host = mockHost({
    storage: { models: { profiles: [profile('short', 'https://api.openai.com/v1'), profile('groq', 'https://api.groq.com/openai/v1')] } },
    secrets: { 'apiKey.short': 'k', 'apiKey.groq': 'k' }
  })
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('prompt.enhance', { prompt: 'fix the login page', level: 'off' })
  assert.equal(answer.enhanced, 'Fix the login page.')
  assert.equal(answer.attempts[0].ok, false)
  assert.equal(answer.attempts[0].errorText?.code, 'error.cut_off')
  assert.deepEqual(parseHistory(host.data().storage.history as never).map((entry) => entry.enhanced), ['Fix the login page.'])
  await worker.deactivate()
})

test('a profile saved by an older version loads without its temperature; a new one allows 8,000 tokens', () => {
  const old = normalizeProfile({ id: 'gpt', name: 'GPT', preset: 'openai', provider: 'openai', baseUrl: '', model: '', temperature: 0.3, maxTokens: 2000, enabled: true })
  assert.ok(old)
  assert.ok(!('temperature' in old))
  // What the person had set stays as it was.
  assert.equal(old.maxTokens, 2000)
  assert.equal(normalizeProfile({ id: 'new', preset: 'anthropic' })?.maxTokens, DEFAULT_MAX_TOKENS)
  assert.equal(DEFAULT_MAX_TOKENS, 8000)
})
