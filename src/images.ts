// Images attached to a prompt: picked by their path on this machine (Orca's panels have no file
// picker), checked here, then shown to the rewriting model when it can see images, and always listed
// by path in the enhanced prompt so the agent in the terminal can open them itself.
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LlmError } from './llm.ts'
import { msg } from './messages.ts'
import type { ModelProfile } from './presets.ts'

/** At most this many images per prompt, of at most this size each (Anthropic's per-image limit). */
import { MAX_IMAGE_BYTES, MAX_IMAGES, sizeOver } from './image-limits.ts'
export { MAX_IMAGE_BYTES, MAX_IMAGES }

export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
/** An attached image as the panel lists it. */
export type ImageInfo = { path: string; name: string; bytes: number; type: ImageType }
/** An image with its bytes, for a model that can see it. */
export type ImageData = ImageInfo & { base64: string }

/** The image type from the file's first bytes; null when it is none of PNG, JPEG, GIF, WebP. */
export function sniffImage(head: Uint8Array): ImageType | null {
  const at = (index: number, ...bytes: number[]) => bytes.every((byte, offset) => head[index + offset] === byte)
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

/** A path as people paste it: quotes from "Copy as path", a file:// URL, spaces around. */
export function cleanImagePath(text: string): string {
  let path = text.trim().replace(/^["']|["']$/g, '').trim()
  if (/^file:\/\//i.test(path)) {
    try {
      path = fileURLToPath(path)
    } catch {
      // not a valid file URL: checked as a path below
    }
  }
  return path
}

/** Checks one attached image: an existing absolute path, a PNG/JPEG/GIF/WebP file, not too large. */
export async function inspectImage(text: string): Promise<ImageInfo> {
  const path = cleanImagePath(text)
  if (!path || !isAbsolute(path)) throw new LlmError(msg('error.image_path', { path: text.slice(0, 200) }), 'invalid_params')
  const info = await stat(path).catch(() => null)
  if (!info || !info.isFile()) throw new LlmError(msg('error.image_missing', { path }), 'invalid_params')
  if (info.size > MAX_IMAGE_BYTES) {
    throw new LlmError(msg('error.image_too_large', { name: basename(path), size: sizeOver(info.size, MAX_IMAGE_BYTES), max: megabytes(MAX_IMAGE_BYTES) }), 'too_large')
  }
  const handle = await readFile(path).catch(() => null)
  const type = handle ? sniffImage(handle.subarray(0, 16)) : null
  if (!type) throw new LlmError(msg('error.image_type', { name: basename(path) }), 'invalid_params')
  return { path, name: basename(path), bytes: info.size, type }
}

/** Checks every attached image (at most MAX_IMAGES) and reads their bytes. */
export async function loadImages(paths: readonly string[]): Promise<ImageData[]> {
  if (paths.length > MAX_IMAGES) throw new LlmError(msg('error.image_count', { max: MAX_IMAGES }), 'invalid_params')
  const out: ImageData[] = []
  for (const path of paths) {
    const info = await inspectImage(path)
    out.push({ ...info, base64: (await readFile(info.path)).toString('base64') })
  }
  return out
}

export const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/**
 * How a model gets the pictures. `data`: in the request (Anthropic, and the OpenAI, OpenRouter and
 * Gemini presets, whose models read images). `file`: by path on the command line (Codex `-i`).
 * `none`: only the paths in the text (other OpenAI-compatible endpoints, Claude Code and Gemini CLI
 * run with no tools, a custom CLI), since sending pictures to a model that cannot read them fails.
 */
export function imageSupport(profile: Pick<ModelProfile, 'provider' | 'preset'>): 'data' | 'file' | 'none' {
  if (profile.provider === 'anthropic') return 'data'
  if (profile.provider === 'openai') return ['openai', 'openrouter', 'gemini'].includes(profile.preset) ? 'data' : 'none'
  return profile.preset === 'codex' ? 'file' : 'none'
}

/** The block the user message gets: the attached images, so the rewriter keeps them in the prompt. */
export function imagesBlock(images: readonly ImageInfo[]): string {
  if (images.length === 0) return ''
  return `<attached_images>\n${images.map((image, index) => `${index + 1}. ${image.path} (${image.name}, ${megabytes(image.bytes)})`).join('\n')}\n</attached_images>`
}

/**
 * Makes sure the enhanced prompt names every attached image by its path, so the agent can open
 * them: the rewriter is asked to, and this adds a short list for any path it left out.
 */
export function withImagePaths(prompt: string, images: readonly ImageInfo[]): string {
  const missing = images.filter((image) => !prompt.includes(image.path))
  if (missing.length === 0) return prompt
  return `${prompt.trimEnd()}\n\nAttached images (open them):\n${missing.map((image) => `- ${image.path}`).join('\n')}`
}
