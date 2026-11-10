// Attached images: recognised by their bytes, sent to models that can see them, always listed for the agent.
import { rmSync } from 'node:fs'
import { after } from 'node:test'
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { ATTACHMENTS_DIR, putChunk } from './attachments.ts'
import { cliArgs } from './cli.ts'
import { imageSupport, sniffImage, withImagePaths } from './images.ts'
import * as main from './worker.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
// The tests' own attachments folder goes when they are done.
after(() => rmSync(ATTACHMENTS_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))

// A real 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

/** Attaches the picture as the panel does (attachments.put) and answers with the path of its copy. */
async function attach(id: string, name = 'login bug.png'): Promise<string> {
  const done = await putChunk({ id, name, index: 0, total: 1, data: PNG.toString('base64') })
  assert.ok('path' in done)
  return done.path
}

test('images are recognised by their bytes, not by their name', () => {
  assert.equal(sniffImage(PNG), 'image/png')
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(sniffImage(Buffer.from('GIF89a')), 'image/gif')
  assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp')
  assert.equal(sniffImage(Buffer.from('%PDF-1.7')), null)
  assert.equal(sniffImage(Buffer.from('not an image')), null)
})

test('which models see the pictures: Anthropic and the OpenAI, OpenRouter and Gemini presets by data, Codex by file, others paths only', () => {
  assert.equal(imageSupport({ provider: 'anthropic', preset: 'anthropic' }), 'data')
  for (const preset of ['openai', 'openrouter', 'gemini']) assert.equal(imageSupport({ provider: 'openai', preset }), 'data')
  for (const preset of ['groq', 'deepseek', 'mistral', 'ollama', 'lmstudio', 'custom']) assert.equal(imageSupport({ provider: 'openai', preset }), 'none')
  assert.equal(imageSupport({ provider: 'cli', preset: 'codex' }), 'file')
  assert.equal(imageSupport({ provider: 'cli', preset: 'claude-code' }), 'none')
  assert.deepEqual(cliArgs('codex', '', '/tmp/o', '', ['/a.png', '/b.png']).slice(-5), ['-i', '/a.png', '-i', '/b.png', '-'])
  // The enhanced prompt names every image the rewriter left out.
  const path = '/tmp/attachments/att-1/login bug.png'
  const image = { path, name: 'login bug.png', bytes: 70, type: 'image/png' as const }
  assert.equal(withImagePaths(`Fix it, see ${path}.`, [image]), `Fix it, see ${path}.`)
  assert.equal(withImagePaths('Fix it.', [image]), `Fix it.\n\nAttached images (open them):\n- ${path}`)
})

const profile = (id: string, preset: string, provider = 'openai') => ({ id, name: id, preset, provider, baseUrl: '', model: '', maxTokens: 2000, enabled: true })

test('the worker sends the picture to a model that reads images, and lists its path in the prompt', async () => {
  const png = await attach('att-image-data')
  const bodies: { url: string; body: Record<string, unknown> }[] = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    const answer = String(url).includes('anthropic') ? { content: [{ type: 'text', text: 'Fix the login button.' }] } : { choices: [{ message: { content: 'Fix the login button.' } }] }
    return new Response(JSON.stringify(answer), { status: 200 })
  }) as typeof fetch

  for (const [preset, provider] of [['anthropic', 'anthropic'], ['openai', 'openai']] as const) {
    const worker = await mountWorker(main, { host: mockHost({ storage: { models: { profiles: [profile('m', preset, provider)] } }, secrets: { 'apiKey.m': 'k' } }) })
    const answer = await worker.request('prompt.enhance', { prompt: 'the button is cut off', level: 'off', files: [png] })
    assert.ok(answer.enhanced.includes(png), answer.enhanced)
    assert.ok(!answer.notes.some((note) => note.code === 'note.images_paths_only'))
    await worker.deactivate()
  }
  const anthropic = bodies[0].body.messages as { content: { type: string; source?: { media_type: string; data: string }; text?: string }[] }[]
  assert.equal(anthropic[0].content[0].type, 'image')
  assert.equal(anthropic[0].content[0].source?.media_type, 'image/png')
  assert.equal(anthropic[0].content[0].source?.data, PNG.toString('base64'))
  assert.match(anthropic[0].content[1].text ?? '', /<attached_images>\n1\. .*login bug\.png/)
  // An image is listed once, as an image: not again among the other attached files.
  assert.ok(!(anthropic[0].content[1].text ?? '').includes('<attached_files>'))
  const openai = bodies[1].body.messages as { content: { type: string; image_url?: { url: string } }[] }[]
  assert.equal(openai[1].content[1].image_url?.url, `data:image/png;base64,${PNG.toString('base64')}`)
})

test('a model that cannot read images gets the paths only, with a note, and the prompt still lists them', async () => {
  const png = await attach('att-image-paths')
  const bodies: Record<string, unknown>[] = []
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Fix the login button.' } }] }), { status: 200 })
  }) as typeof fetch
  const worker = await mountWorker(main, { host: mockHost({ storage: { models: { profiles: [profile('g', 'groq')] } }, secrets: { 'apiKey.g': 'k' } }) })
  const answer = await worker.request('prompt.enhance', { prompt: 'the button is cut off', level: 'off', files: [png] })
  const messages = bodies[0].messages as { content: unknown }[]
  assert.equal(typeof messages[1].content, 'string')
  assert.match(String(messages[1].content), /<attached_images>/)
  assert.ok(answer.notes.some((note) => note.code === 'note.images_paths_only'))
  assert.equal(answer.enhanced, `Fix the login button.\n\nAttached images (open them):\n- ${png}`)
  await worker.deactivate()
})
