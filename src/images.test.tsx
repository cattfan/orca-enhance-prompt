// Attached images: checked by path, sent to models that can see them, always listed for the agent.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { after } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, assert, mockHost, mount, mountWorker, test } from 'orca/testing'
import { cliArgs } from './cli.ts'
import { cleanImagePath, imageSupport, inspectImage, loadImages, MAX_IMAGE_BYTES, sniffImage, withImagePaths } from './images.ts'
import * as panel from './panel.tsx'
import { PRESETS, type ProfileView } from './presets.ts'
import * as main from './worker.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
const dir = mkdtempSync(join(tmpdir(), 'images-'))
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))

// A real 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const png = join(dir, 'login bug.png')
writeFileSync(png, PNG)
const text = join(dir, 'notes.png')
writeFileSync(text, 'not an image')
const big = join(dir, 'huge.png')
writeFileSync(big, Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]))

test('images are recognised by their bytes, and paths are taken as people paste them', () => {
  assert.equal(sniffImage(PNG), 'image/png')
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(sniffImage(Buffer.from('GIF89a')), 'image/gif')
  assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp')
  assert.equal(sniffImage(Buffer.from('%PDF-1.7')), null)
  assert.equal(cleanImagePath(`  "${png}"  `), png)
  assert.equal(cleanImagePath(pathToFileURL(png).href), png)
})

test('a missing, relative, too large, wrong-type file or too many images is refused with a clear reason', async () => {
  assert.equal((await inspectImage(`"${png}"`)).type, 'image/png')
  assert.equal((await inspectImage(png)).name, 'login bug.png')
  await assert.rejects(inspectImage('shot.png'), /full path of an image file/)
  await assert.rejects(inspectImage(join(dir, 'nope.png')), /No image file at/)
  await assert.rejects(inspectImage(text), /notes\.png is not a PNG, JPEG, GIF or WebP image/)
  // Just over the limit: the size has enough digits to show it is over (not "5.0 MB of 5.0 MB").
  await assert.rejects(inspectImage(big), /huge\.png is 5,242,948 bytes; an image can be at most 5\.0 MB/)
  await assert.rejects(loadImages([png, png, png, png, png]), /At most 4 images per prompt/)
  const [loaded] = await loadImages([png])
  assert.equal(loaded.base64, PNG.toString('base64'))
})

test('which models see the pictures: Anthropic and the OpenAI, OpenRouter and Gemini presets by data, Codex by file, others paths only', () => {
  assert.equal(imageSupport({ provider: 'anthropic', preset: 'anthropic' }), 'data')
  for (const preset of ['openai', 'openrouter', 'gemini']) assert.equal(imageSupport({ provider: 'openai', preset }), 'data')
  for (const preset of ['groq', 'deepseek', 'mistral', 'ollama', 'lmstudio', 'custom']) assert.equal(imageSupport({ provider: 'openai', preset }), 'none')
  assert.equal(imageSupport({ provider: 'cli', preset: 'codex' }), 'file')
  assert.equal(imageSupport({ provider: 'cli', preset: 'claude-code' }), 'none')
  assert.deepEqual(cliArgs('codex', '', '/tmp/o', '', ['/a.png', '/b.png']).slice(-5), ['-i', '/a.png', '-i', '/b.png', '-'])
  // The enhanced prompt names every image the rewriter left out.
  const image = { path: png, name: 'login bug.png', bytes: 70, type: 'image/png' as const }
  assert.equal(withImagePaths(`Fix it, see ${png}.`, [image]), `Fix it, see ${png}.`)
  assert.match(withImagePaths('Fix it.', [image]), new RegExp(`Attached images \\(open them\\):\\n- ${png.replace(/[\\.()]/g, '\\$&')}$`))
})

const profile = (id: string, preset: string, provider = 'openai') => ({ id, name: id, preset, provider, baseUrl: '', model: '', temperature: 0.3, maxTokens: 2000, enabled: true })

test('the worker sends the picture to a model that reads images, and lists its path in the prompt', async () => {
  const bodies: { url: string; body: Record<string, unknown> }[] = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    const answer = String(url).includes('anthropic') ? { content: [{ type: 'text', text: 'Fix the login button.' }] } : { choices: [{ message: { content: 'Fix the login button.' } }] }
    return new Response(JSON.stringify(answer), { status: 200 })
  }) as typeof fetch

  for (const [preset, provider] of [['anthropic', 'anthropic'], ['openai', 'openai']] as const) {
    const worker = await mountWorker(main, { host: mockHost({ storage: { models: { profiles: [profile('m', preset, provider)] } }, secrets: { 'apiKey.m': 'k' } }) })
    const answer = await worker.request('prompt.enhance', { prompt: 'the button is cut off', level: 'off', images: [png] })
    assert.ok(answer.enhanced.includes(png), answer.enhanced)
    assert.ok(!answer.notes.some((note) => note.code === 'note.images_paths_only'))
    await worker.deactivate()
  }
  const anthropic = bodies[0].body.messages as { content: { type: string; source?: { media_type: string; data: string }; text?: string }[] }[]
  assert.equal(anthropic[0].content[0].type, 'image')
  assert.equal(anthropic[0].content[0].source?.media_type, 'image/png')
  assert.equal(anthropic[0].content[0].source?.data, PNG.toString('base64'))
  assert.match(anthropic[0].content[1].text ?? '', /<attached_images>\n1\. .*login bug\.png/)
  const openai = bodies[1].body.messages as { content: { type: string; image_url?: { url: string } }[] }[]
  assert.equal(openai[1].content[1].image_url?.url, `data:image/png;base64,${PNG.toString('base64')}`)
})

test('a model that cannot read images gets the paths only, with a note; a bad image stops the run before any model call', async () => {
  const bodies: Record<string, unknown>[] = []
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Fix the login button.' } }] }), { status: 200 })
  }) as typeof fetch
  const worker = await mountWorker(main, { host: mockHost({ storage: { models: { profiles: [profile('g', 'groq')] } }, secrets: { 'apiKey.g': 'k' } }) })
  const answer = await worker.request('prompt.enhance', { prompt: 'the button is cut off', level: 'off', images: [png] })
  const messages = bodies[0].messages as { content: unknown }[]
  assert.equal(typeof messages[1].content, 'string')
  assert.match(String(messages[1].content), /<attached_images>/)
  assert.ok(answer.notes.some((note) => note.code === 'note.images_paths_only'))
  assert.match(answer.enhanced, /Attached images \(open them\):/)
  await assert.rejects(worker.request('prompt.enhance', { prompt: 'x', level: 'off', images: [text] }), /not a PNG, JPEG, GIF or WebP/)
  assert.equal(bodies.length, 1)
  await assert.rejects(worker.request('images.inspect', { path: big }), /at most 5\.0 MB/)
  assert.equal((await worker.request('images.inspect', { path: `"${png}"` })).name, 'login bug.png')
  await worker.deactivate()
})

test('the panel attaches an image by path, shows it, refuses a bad one, and sends its path with Enhance', async () => {
  const sent: Record<string, unknown>[] = []
  const gpt: ProfileView = { ...profile('gpt', 'openai'), provider: 'openai', command: '', args: '', effectiveBaseUrl: 'https://api.openai.com/v1', effectiveModel: 'gpt-4.1-mini', keySource: 'secret', envName: '' }
  const host = mockHost({
    requests: {
      'models.get': { profiles: [gpt], hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS },
      'targets.list': { targets: [] },
      'models.detect': { found: [] },
      'models.catalog': { models: [], source: '', fetchedAt: 1 },
      'rules.get': { rules: [], structures: [] },
      'images.inspect': ({ path }) => {
        if (path.endsWith('.txt')) throw Object.assign(new Error('notes.txt is not a PNG, JPEG, GIF or WebP image.'), { code: 'invalid_params' })
        return { path, name: 'login bug.png', bytes: 1_572_864, type: 'image/png' }
      },
      'prompt.enhance': (input) => {
        sent.push(input as Record<string, unknown>)
        return { enhanced: 'ok', model: 'm', profileName: 'gpt', ms: 5, attempts: [], context: [], notes: [] }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ role: 'button', text: 'Images' })
  await view.type({ label: 'Image file path' }, 'C:\\shots\\notes.txt')
  await view.press({ role: 'button', text: 'Attach' })
  assert.ok(view.find({ text: /notes\.txt is not a PNG/ }))
  await view.type({ label: 'Image file path' }, 'C:\\shots\\login bug.png', { replace: true })
  await view.press({ role: 'button', text: 'Attach' })
  assert.ok(view.find({ text: 'login bug.png · 1.5 MB' }), JSON.stringify(view.summary()))
  assert.ok(view.find({ role: 'button', text: 'Images · 1' }))
  await view.type({ label: 'Your prompt' }, 'the button is cut off')
  await view.press({ role: 'button', text: 'Enhance' })
  assert.deepEqual(sent[0].images, ['C:\\shots\\login bug.png'])
  await view.press({ role: 'button', label: 'Remove login bug.png' })
  assert.equal(view.find({ text: 'login bug.png · 1.5 MB' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
