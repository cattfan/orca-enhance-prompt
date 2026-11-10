// Images among the files attached to a prompt (src/attachments.ts): recognised by their bytes, shown
// to the rewriting model when it can see images, and always listed by path in the enhanced prompt so
// the agent in the terminal can open them itself.
import type { ModelProfile } from './presets.ts'

export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
/** An attached image: where its copy is, its name, size and type. */
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
