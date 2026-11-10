// Files pasted, dropped or picked in the web panel: received in chunks, kept on disk, used in the prompt.
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { after } from 'node:test'
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { ATTACHMENTS_DIR, excerpt, loadFiles, MAX_ATTACHMENT_BYTES, putChunk, safeName, TEXT_MAX } from './attachments.ts'
import { ATTACHMENT_CHUNK_BYTES, attachmentItemId, MAX_CHUNK_BASE64, MAX_IMAGE_BYTES, REQUEST_INPUT_LIMIT } from './image-limits.ts'
import * as main from './worker.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
// The tests' own folder (see ATTACHMENTS_DIR) goes when they are done.
after(() => rmSync(ATTACHMENTS_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))

test('tests keep their attachments apart from the real panel\'s', () => {
  assert.notEqual(ATTACHMENTS_DIR, join(tmpdir(), 'enhance-prompt-attachments'))
  assert.equal(dirname(ATTACHMENTS_DIR), tmpdir())
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
  await assert.rejects(putChunk({ id: 'att-test-2', name: 'big.bin', index: 0, total: 300, data: 'AAAA', size: MAX_ATTACHMENT_BYTES + 1 }), /big.bin is 10,485,761 bytes; an attachment can be at most 10.0 MB/)
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
  const profile = { id: 'gpt', name: 'gpt', preset: 'openai', provider: 'openai', baseUrl: '', model: '', maxTokens: 2000, enabled: true }
  const worker = await mountWorker(main, { host: mockHost({ storage: { models: { profiles: [profile] } }, secrets: { 'apiKey.gpt': 'k' } }) })
  const answer = await worker.request('prompt.enhance', { prompt: 'fix the build', level: 'off', files: [image.path, log.path] })
  const user = bodies[0].messages[1].content as { type: string; text?: string; image_url?: { url: string } }[]
  assert.equal(user[1].type, 'image_url')
  assert.match(user[0].text ?? '', /ERROR: cannot find module x/)
  assert.match(user[0].text ?? '', /<attached_files>\n1\. .*build\.log/)
  assert.ok(answer.enhanced.includes(image.path) && answer.enhanced.includes(log.path), answer.enhanced)
  // A short text is whole: listed as a file of the context, with no "trimmed" next to it.
  const item = answer.context.find((entry) => entry.id === 'attach:att-test-4/build.log')
  assert.deepEqual(item, { id: 'attach:att-test-4/build.log', kind: 'file', label: 'build.log', chars: 'ERROR: cannot find module x'.length })
  await worker.deactivate()
})

/** Attaches bytes as the panel does, piece by piece, and answers with the path of the copy. */
async function attach(id: string, name: string, content: string | Buffer): Promise<string> {
  const bytes = Buffer.from(content)
  const total = Math.max(1, Math.ceil(bytes.length / ATTACHMENT_CHUNK_BYTES))
  let done: Awaited<ReturnType<typeof putChunk>> | null = null
  for (let index = 0; index < total; index++) {
    done = await putChunk({ id, name, index, total, data: bytes.subarray(index * ATTACHMENT_CHUNK_BYTES, (index + 1) * ATTACHMENT_CHUNK_BYTES).toString('base64') })
  }
  assert.ok(done && 'path' in done)
  return done.path
}

/** A worker with one OpenAI model, and what it sent: the user message of each call. */
async function workerWithModel() {
  const sent: string[] = []
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: { content: unknown }[] }
    sent.push(String(body.messages[1].content))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Fix the build.' } }] }), { status: 200 })
  }) as typeof fetch
  const profile = { id: 'gpt', name: 'gpt', preset: 'openai', provider: 'openai', baseUrl: '', model: '', maxTokens: 2000, enabled: true }
  const worker = await mountWorker(main, { host: mockHost({ storage: { models: { profiles: [profile] } }, secrets: { 'apiKey.gpt': 'k' } }) })
  return { worker, sent }
}

const SPLIT = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

test('a long text is kept as its beginning and its end: whole lines, the count of what was left out, no character split', () => {
  assert.deepEqual(excerpt('short'), { text: 'short', cut: 0 })
  assert.equal(excerpt('x'.repeat(TEXT_MAX)).cut, 0)
  // A log of 5,000 lines: its first and its last lines are there, the middle is counted.
  const lines = Array.from({ length: 5000 }, (_, index) => `line ${index + 1}: something happened here`)
  const log = lines.join('\n')
  const { text, cut } = excerpt(log)
  const parts = text.split(`\n…(${cut.toLocaleString('en-US')} characters left out)…\n`)
  assert.equal(parts.length, 2, text.slice(0, 200))
  const [head, tail] = parts
  assert.ok(head.startsWith('line 1: something happened here\nline 2:'))
  assert.ok(tail.endsWith('\nline 5000: something happened here'))
  assert.ok(!text.includes('line 2500:'))
  assert.equal(head.length + tail.length + cut, log.length)
  assert.ok(head.length + tail.length <= TEXT_MAX && head.length + tail.length > TEXT_MAX * 0.9, `${head.length} + ${tail.length}`)
  // The cut falls between lines on both sides, and more of the beginning is kept than of the end.
  assert.ok(lines.includes(head.split('\n').at(-1) ?? '') && lines.includes(tail.split('\n')[0]))
  assert.ok(head.length > tail.length)
  // One endless line has no line break to cut on: it is cut where the limit falls.
  assert.equal(excerpt('y'.repeat(TEXT_MAX * 3)).cut, TEXT_MAX * 2)
  // A character of two code units (an emoji) is never cut in two, at the beginning or at the end.
  for (const max of [9, 10, 11, 12, 13]) {
    const cutEmoji = excerpt('😀'.repeat(40), max)
    assert.ok(!SPLIT.test(cutEmoji.text), `max ${max}: ${JSON.stringify(cutEmoji.text)}`)
    assert.ok(cutEmoji.cut >= 80 - max)
  }
})

test('a long attached text goes to the model as an excerpt marked as trimmed; a file with binary bytes goes by path only', async () => {
  const lines = Array.from({ length: 6000 }, (_, index) => `step ${index + 1} passed`)
  lines[2999] = 'THE-MIDDLE-OF-THE-LOG'
  lines[5999] = 'ERROR: the build failed at the last step'
  const long = lines.join('\n')
  assert.ok(long.length > TEXT_MAX * 4)
  const log = await attach('att-long-log', 'ci.log', long)
  // Text at first, binary further on (past the first 200,000 bytes, where only the start used to be looked at).
  const binary = await attach('att-binary', 'core.dump', Buffer.concat([Buffer.from('looks like text\n'.repeat(15_000)), Buffer.from([0, 1, 2, 3])]))
  const { worker, sent } = await workerWithModel()
  const answer = await worker.request('prompt.enhance', { prompt: 'why did the build fail?', level: 'off', files: [log, binary] })

  assert.match(sent[0], /step 1 passed\nstep 2 passed/)
  assert.match(sent[0], /ERROR: the build failed at the last step/)
  assert.match(sent[0], /\n…\([\d,]+ characters left out\)…\n/)
  assert.ok(!sent[0].includes('THE-MIDDLE-OF-THE-LOG'))
  assert.match(sent[0], /<item kind="file" label="ci\.log" note="trimmed">/)
  // The whole message stays small: the excerpt, not the 100,000 characters of the file.
  assert.ok(sent[0].length < TEXT_MAX + 2000, String(sent[0].length))
  const item = answer.context.find((entry) => entry.id === attachmentItemId(log))
  assert.ok(item && item.chars <= TEXT_MAX + 60, JSON.stringify(item))
  assert.equal(item.note, 'trimmed')
  assert.deepEqual(item.why, { code: 'why.trimmed' })

  // The binary file: none of its bytes in the message, no context item, but listed by its path like the log.
  assert.ok(!sent[0].includes('looks like text'))
  assert.ok(!answer.context.some((entry) => entry.id === attachmentItemId(binary)))
  assert.ok(sent[0].includes(`<attached_files>\n1. ${log}\n2. ${binary}\n</attached_files>`), sent[0].slice(-400))
  assert.ok(answer.enhanced.includes(log) && answer.enhanced.includes(binary))
  await worker.deactivate()
})

test('two attached files of one name are two context items; an unticked one keeps its path but its text is left out', async () => {
  const first = await attach('att-same-a', 'error.log', 'FIRST-LOG: timeout')
  const second = await attach('att-same-b', 'error.log', 'SECOND-LOG: refused')
  assert.equal(attachmentItemId(first), 'attach:att-same-a/error.log')
  assert.equal(attachmentItemId('C:\\Temp\\enhance-prompt-attachments\\att-same-b\\error.log'), 'attach:att-same-b/error.log')
  const { worker, sent } = await workerWithModel()
  const enhance = (exclude: string[]) => worker.request('prompt.enhance', { prompt: 'fix it', level: 'off', files: [first, second], exclude })

  const both = await enhance([])
  assert.deepEqual(both.context.map((entry) => entry.id), ['attach:att-same-a/error.log', 'attach:att-same-b/error.log'])
  assert.ok(sent[0].includes('FIRST-LOG: timeout') && sent[0].includes('SECOND-LOG: refused'))

  // Unticked in the panel's context list: its text stays out, the agent can still open the file.
  const one = await enhance(['attach:att-same-b/error.log'])
  assert.deepEqual(one.context.map((entry) => entry.id), ['attach:att-same-a/error.log'])
  assert.ok(sent[1].includes('FIRST-LOG: timeout'))
  assert.ok(!sent[1].includes('SECOND-LOG'), sent[1])
  assert.ok(sent[1].includes(`2. ${second}`))
  assert.ok(one.enhanced.includes(second))
  await worker.deactivate()
})

// "message too large": Orca refuses a panel request over 64 KiB, and the panel used to send pieces
// of 768 KB. Every piece now fits, a 5 MB image goes through, and a file too large says its size.
test('each attachment piece fits in one panel request, so a 5 MB image attaches', async () => {
  const largest = JSON.stringify({ id: `att-${'x'.repeat(36)}`, name: 'n'.repeat(120), index: 9999, total: 9999, data: 'A'.repeat(MAX_CHUNK_BASE64), size: MAX_ATTACHMENT_BYTES })
  assert.ok(largest.length < REQUEST_INPUT_LIMIT, `${largest.length} >= ${REQUEST_INPUT_LIMIT}`)
  // An image of exactly the image limit, sent as the panel sends it, piece by piece.
  const image = Buffer.alloc(MAX_IMAGE_BYTES, 7)
  PNG.copy(image, 0)
  const total = Math.ceil(image.length / ATTACHMENT_CHUNK_BYTES)
  let done: Awaited<ReturnType<typeof putChunk>> | null = null
  for (let index = 0; index < total; index++) {
    const data = image.subarray(index * ATTACHMENT_CHUNK_BYTES, (index + 1) * ATTACHMENT_CHUNK_BYTES).toString('base64')
    done = await putChunk({ id: 'att-five-mb', name: 'screen.png', index, total, data, ...(index === 0 ? { size: image.length } : {}) })
  }
  assert.ok(done && 'path' in done && done.bytes === MAX_IMAGE_BYTES)
  const loaded = await loadFiles([(done as { path: string }).path])
  assert.equal(loaded.images.length, 1, 'an image of exactly 5 MB is still an image')
})

test('a piece larger than one request, or a file over the limit, is refused with the sizes', async () => {
  // The old 768 KB pieces: refused by the worker too, never written.
  await assert.rejects(putChunk({ id: 'att-old-size', name: 'a.png', index: 0, total: 1, data: Buffer.alloc(768 * 1024).toString('base64') }), /could not be received/)
  await assert.rejects(
    putChunk({ id: 'att-too-big', name: 'big.log', index: 0, total: 300, data: 'AAAA', size: MAX_ATTACHMENT_BYTES + 1024 * 1024 }),
    /big\.log is 11\.0 MB; an attachment can be at most 10\.0 MB/
  )
})

test('"Delete everything" removes the attached files; one kept for more than a day goes when a new file arrives', async () => {
  const worker = await mountWorker(main, { host: mockHost() })
  const put = (id: string, name: string) => worker.request('attachments.put', { id, name, index: 0, total: 1, data: PNG.toString('base64') })
  const old = await put('att-old-one', 'yesterday.png')
  assert.ok('path' in old && existsSync(old.path))
  // Two days old (a worker can run that long without starting again).
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600_000)
  utimesSync(dirname(old.path), twoDaysAgo, twoDaysAgo)
  const fresh = await put('att-new-one', 'today.png')
  assert.ok('path' in fresh)
  for (let i = 0; i < 100 && existsSync(old.path); i++) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.ok(!existsSync(old.path), 'the old attachment is still there')
  assert.ok(existsSync(fresh.path))

  // Clearing history or model lists leaves attachments alone; Delete everything removes them.
  await worker.request('data.clear', { what: 'history' })
  await worker.request('data.clear', { what: 'catalogs' })
  assert.ok(existsSync(fresh.path))
  await worker.request('data.clear', { what: 'all' })
  assert.ok(!existsSync(fresh.path), 'Delete everything left an attached file on disk')
  assert.ok(!existsSync(ATTACHMENTS_DIR))
  // The next attachment starts a new folder.
  const again = await put('att-after-wipe', 'again.png')
  assert.ok('path' in again && existsSync(again.path))
  await worker.deactivate()
})

test('a run reads only files the panel attached: any other path is refused before a model is called', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
  }) as typeof fetch
  const profile = { id: 'gpt', name: 'gpt', preset: 'openai', provider: 'openai', baseUrl: '', model: '', maxTokens: 2000, enabled: true }
  const worker = await mountWorker(main, { host: mockHost({ storage: { models: { profiles: [profile] } }, secrets: { 'apiKey.gpt': 'k' } }) })
  const enhance = (files: string[]) => worker.request('prompt.enhance', { prompt: 'fix it', level: 'off', files })

  // A file of this machine that was never attached: its text must not reach a model.
  const outside = mkdtempSync(join(tmpdir(), 'not-attached-'))
  try {
    writeFileSync(join(outside, 'notes.txt'), 'private notes')
    await assert.rejects(enhance([join(outside, 'notes.txt')]), /could not be received/)
    // ...also when the path starts in the attachments folder and climbs out of it.
    await assert.rejects(enhance([join(ATTACHMENTS_DIR, '..', basename(outside), 'notes.txt')]), /could not be received/)
    await assert.rejects(enhance([ATTACHMENTS_DIR]), /could not be received/)
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
  // An attachment that has been cleaned away since (they are kept for a day): said by its name.
  await assert.rejects(enhance([join(ATTACHMENTS_DIR, 'att-long-gone', 'yesterday.log')]), /The attached file yesterday\.log is no longer there/)
  assert.equal(calls, 0, 'a model was called')

  // What was attached is read.
  const log = await putChunk({ id: 'att-read-me', name: 'build.log', index: 0, total: 1, data: Buffer.from('ERROR in build').toString('base64') })
  assert.ok('path' in log)
  const answer = await enhance([log.path])
  assert.equal(calls, 1)
  assert.ok(answer.context.some((item) => item.id === attachmentItemId(log.path)))
  await worker.deactivate()
})
