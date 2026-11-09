// Files pasted, dropped or picked in the web panel: received in chunks, kept on disk, used in the prompt.
import { readFileSync } from 'node:fs'
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { MAX_ATTACHMENT_BYTES, putChunk, safeName } from './attachments.ts'
import * as main from './worker.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

test('attachments arrive in chunks and are kept under a safe name; bad ids and huge files are refused', async () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd')
  assert.equal(safeName('ảnh chụp màn hình (1).png'), 'ảnh chụp màn hình _1_.png')
  const text = Buffer.from('line one\nline two\n')
  const first = await putChunk({ id: 'att-test-1', name: 'notes.txt', index: 0, total: 2, data: text.subarray(0, 5).toString('base64') })
  assert.deepEqual(first, { received: 5 })
  const done = await putChunk({ id: 'att-test-1', name: 'notes.txt', index: 1, total: 2, data: text.subarray(5).toString('base64') })
  assert.ok('path' in done)
  assert.equal(readFileSync(done.path, 'utf8'), 'line one\nline two\n')
  await assert.rejects(putChunk({ id: '../x', name: 'a', index: 0, total: 1, data: '' }), /could not be received/)
  await assert.rejects(putChunk({ id: 'att-test-2', name: 'big.bin', index: 0, total: 1, data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64') }), /too large/)
})

test('a run uses attached files: images as images, short text in the context, every path in the prompt', async () => {
  const image = await putChunk({ id: 'att-test-3', name: 'screen.png', index: 0, total: 1, data: PNG.toString('base64') })
  const log = await putChunk({ id: 'att-test-4', name: 'build.log', index: 0, total: 1, data: Buffer.from('ERROR: cannot find module x').toString('base64') })
  assert.ok('path' in image && 'path' in log)
  const bodies: { messages: { role: string; content: unknown }[] }[] = []
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Fix the missing module.' } }] }), { status: 200 })
  }) as typeof fetch
  const profile = { id: 'gpt', name: 'gpt', preset: 'openai', provider: 'openai', baseUrl: '', model: '', temperature: 0.3, maxTokens: 2000, enabled: true }
  const worker = await mountWorker(main, { host: mockHost({ storage: { models: { profiles: [profile] } }, secrets: { 'apiKey.gpt': 'k' } }) })
  const answer = await worker.request('prompt.enhance', { prompt: 'fix the build', level: 'off', files: [image.path, log.path] })
  const user = bodies[0].messages[1].content as { type: string; text?: string; image_url?: { url: string } }[]
  assert.equal(user[1].type, 'image_url')
  assert.match(user[0].text ?? '', /ERROR: cannot find module x/)
  assert.match(user[0].text ?? '', /<attached_files>\n1\. .*build\.log/)
  assert.ok(answer.enhanced.includes(image.path) && answer.enhanced.includes(log.path), answer.enhanced)
  assert.ok(answer.context.some((item) => item.id === 'attach:build.log'))
  await worker.deactivate()
})
