// Files attached to a prompt in the web panel: pasted, dropped or picked there, they have no path on
// disk, so the panel sends their bytes in chunks and they are kept in a folder of their own under the
// system's temporary folder. Images then work like images attached by path (src/images.ts); other
// files go in the context when they are short text, and every attachment is listed by its path so the
// agent can open it.
import { appendFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { MAX_ATTACHMENT_BYTES, MAX_CHUNK_BASE64, MAX_IMAGE_BYTES, MAX_IMAGES, sizeOver } from './image-limits.ts'
import { megabytes, sniffImage, type ImageData } from './images.ts'
import { LlmError } from './llm.ts'
import { msg } from './messages.ts'

/**
 * Where attachments are kept; removed after a day. Under the test runner (Node sets
 * NODE_TEST_CONTEXT in a test's process) it is a folder of that test file's own, so a test never
 * writes into, or deletes, the folder that holds what a person attached in the real panel.
 */
export const ATTACHMENTS_DIR = join(tmpdir(), `enhance-prompt-attachments${process.env.NODE_TEST_CONTEXT ? `-test-${process.pid}` : ''}`)
/** An attachment can be at most MAX_ATTACHMENT_BYTES; text files at most TEXT_MAX of it go in the context. */
export { MAX_ATTACHMENT_BYTES }
export const TEXT_MAX = 200_000
const DAY_MS = 24 * 3600_000

/** A file name safe on every system, its extension kept. */
export function safeName(name: string): string {
  const cleaned = basename(name).replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/^\.+/, '').trim().slice(0, 120)
  return cleaned || 'file'
}

/**
 * Adds one chunk (base64) of an attachment. Chunks come in order; the last one answers with the file's
 * path. Refuses an id that is not ours or a file past MAX_ATTACHMENT_BYTES.
 */
export async function putChunk(input: { id: string; name: string; index: number; total: number; data: string; size?: number }): Promise<{ path: string; bytes: number } | { received: number }> {
  if (!/^[a-z0-9-]{6,40}$/.test(input.id)) throw new LlmError(msg('error.attachment_bad'), 'invalid_params')
  // One piece must fit in a panel request (64 KiB): the panel cuts files at ATTACHMENT_CHUNK_BYTES.
  if (typeof input.data !== 'string' || input.data.length > MAX_CHUNK_BASE64) throw new LlmError(msg('error.attachment_bad'), 'invalid_params')
  // The whole size, when the panel says it on the first piece: refused before anything is written.
  if (input.index === 0 && typeof input.size === 'number' && input.size > MAX_ATTACHMENT_BYTES) {
    throw new LlmError(msg('error.file_too_large', { name: safeName(input.name), size: sizeOver(input.size, MAX_ATTACHMENT_BYTES), max: megabytes(MAX_ATTACHMENT_BYTES) }), 'too_large')
  }
  if (!Number.isInteger(input.index) || !Number.isInteger(input.total) || input.index < 0 || input.index >= input.total) {
    throw new LlmError(msg('error.attachment_bad'), 'invalid_params')
  }
  const dir = join(ATTACHMENTS_DIR, input.id)
  const path = join(dir, safeName(input.name))
  if (input.index === 0) {
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
  }
  const bytes = Buffer.from(input.data, 'base64')
  const before = await stat(path).then((info) => info.size).catch(() => 0)
  if (before + bytes.length > MAX_ATTACHMENT_BYTES) {
    await rm(dir, { recursive: true, force: true })
    throw new LlmError(msg('error.file_too_large', { name: safeName(input.name), size: sizeOver(before + bytes.length, MAX_ATTACHMENT_BYTES), max: megabytes(MAX_ATTACHMENT_BYTES) }), 'too_large')
  }
  await appendFile(path, bytes)
  if (input.index < input.total - 1) return { received: before + bytes.length }
  return { path, bytes: before + bytes.length }
}

/**
 * Removes attachments older than a day. Called when the worker starts and whenever a new file
 * arrives: a worker can run for days, and "removed after a day" must not wait for its next start.
 */
export async function cleanAttachments(now = Date.now()): Promise<void> {
  const entries = await readdir(ATTACHMENTS_DIR).catch(() => [] as string[])
  for (const entry of entries) {
    const info = await stat(join(ATTACHMENTS_DIR, entry)).catch(() => null)
    if (info && now - info.mtimeMs > DAY_MS) await rm(join(ATTACHMENTS_DIR, entry), { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Removes every attachment now ("Delete everything"). */
export async function clearAttachments(): Promise<void> {
  await rm(ATTACHMENTS_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

export type LoadedFiles = {
  /** Image files among them, for models that read images. */
  images: ImageData[]
  /** Short text files: their content goes in the context. */
  texts: { path: string; name: string; content: string }[]
  /** Every attached file, by path, for the agent. */
  paths: string[]
}

/** Reads attached files: images as images, short text as text, anything else by path only. */
export async function loadFiles(paths: readonly string[]): Promise<LoadedFiles> {
  const out: LoadedFiles = { images: [], texts: [], paths: [] }
  for (const path of paths) {
    const info = await stat(path).catch(() => null)
    if (!info || !info.isFile()) throw new LlmError(msg('error.image_missing', { path }), 'invalid_params')
    if (info.size > MAX_ATTACHMENT_BYTES) {
      throw new LlmError(msg('error.file_too_large', { name: basename(path), size: sizeOver(info.size, MAX_ATTACHMENT_BYTES), max: megabytes(MAX_ATTACHMENT_BYTES) }), 'too_large')
    }
    const bytes = await readFile(path)
    out.paths.push(path)
    const type = sniffImage(bytes.subarray(0, 16))
    if (type && info.size <= MAX_IMAGE_BYTES && out.images.length < MAX_IMAGES) {
      out.images.push({ path, name: basename(path), bytes: info.size, type, base64: bytes.toString('base64') })
      continue
    }
    const head = bytes.subarray(0, TEXT_MAX)
    if (!type && !head.includes(0)) out.texts.push({ path, name: basename(path), content: head.toString('utf8') })
  }
  return out
}
