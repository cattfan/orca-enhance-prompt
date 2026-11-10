// Attaching files in the web panel: paste, drop or the paperclip. A frame has no path for a file, so
// its bytes go to the worker in chunks (`attachments.put`), which keeps it in a temporary folder and
// answers with the path the run then uses.
import { plugin, read, set } from 'orca'
import { t } from '../../src/i18n.ts'
import { files, notice, message, put, type AttachedFile } from '../../src/panel/state.ts'
import { ATTACHMENT_CHUNK_BYTES, MAX_ATTACHMENT_BYTES, MAX_IMAGE_BYTES, sizeOver } from '../../src/image-limits.ts'

export const MAX_FILES = 8
export const MAX_FILE_BYTES = MAX_ATTACHMENT_BYTES
/**
 * Raw bytes per request. Orca refuses a panel request larger than 64 KiB ("message too large"):
 * pieces of 768 KB (about 1 MB in base64) made every attachment fail. See src/image-limits.ts.
 */
const CHUNK = ATTACHMENT_CHUNK_BYTES

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/**
 * Why a file cannot be attached, with its size and the limit; null when it can. An image larger than
 * models accept (5 MB) is refused here too, instead of being sent by path without a word.
 */
export function tooLarge(file: { name: string; size: number; type: string }): string | null {
  if (file.type.startsWith('image/') && file.size > MAX_IMAGE_BYTES) {
    return t('{name} is {size}; an image can be at most {max}.', { name: file.name, size: sizeOver(file.size, MAX_IMAGE_BYTES), max: megabytes(MAX_IMAGE_BYTES) })
  }
  if (file.size > MAX_FILE_BYTES) return t('{name} is {size}; an attachment can be at most {max}.', { name: file.name, size: sizeOver(file.size, MAX_FILE_BYTES), max: megabytes(MAX_FILE_BYTES) })
  return null
}

/** Previews of attached images, by path, for this panel run only. */
export const previews = new Map<string, string>()
/** Names being uploaded now, shown with a spinner. */
let uploading: string[] = []
export const uploadingNames = () => uploading

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(text)
}

const newId = () => `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** A pasted screenshot comes as "image.png": give it a name that says when it was taken. */
function nameOf(file: File): string {
  if (file.name && file.name !== 'image.png') return file.name
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const extension = file.type.split('/')[1] || 'png'
  return `pasted-${stamp}.${extension}`
}

async function uploadOne(file: File, name: string): Promise<AttachedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const id = newId()
  const total = Math.max(1, Math.ceil(bytes.length / CHUNK))
  let answer: unknown = null
  for (let index = 0; index < total; index += 1) {
    const data = toBase64(bytes.subarray(index * CHUNK, (index + 1) * CHUNK))
    // The first piece says the whole size, so the worker can refuse a file that is too large at once.
    answer = await plugin.request('attachments.put', { id, name, index, total, data, ...(index === 0 ? { size: bytes.length } : {}) }, { timeoutMs: 60_000 })
  }
  const done = answer as { path: string; bytes: number }
  return { path: done.path, name, bytes: bytes.length, type: file.type || 'application/octet-stream' }
}

/** Attaches files (from a paste, a drop or the picker); too many or too large ones get a notice. */
export async function attachFiles(list: readonly File[], refresh: () => void): Promise<void> {
  const room = MAX_FILES - read<AttachedFile[]>(files).length - uploading.length
  if (list.length > room) set(notice, { tone: 'warning', text: t('At most {max} files per prompt.', { max: MAX_FILES }) })
  for (const file of list.slice(0, Math.max(0, room))) {
    const refused = tooLarge(file)
    if (refused) {
      set(notice, { tone: 'warning', text: refused })
      continue
    }
    const name = nameOf(file)
    uploading = [...uploading, name]
    refresh()
    try {
      const attached = await uploadOne(file, name)
      if (file.type.startsWith('image/')) previews.set(attached.path, URL.createObjectURL(file))
      put(files, [...read<AttachedFile[]>(files), attached])
    } catch (error) {
      set(notice, { tone: 'danger', text: message(error) })
    } finally {
      uploading = uploading.filter((entry) => entry !== name)
      refresh()
    }
  }
}

/** Files from a paste or a drop (a copied file, or a screenshot in the clipboard). */
export function filesOf(data: DataTransfer | null): File[] {
  if (!data) return []
  const out: File[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) out.push(file)
    }
  }
  return out.length > 0 ? out : Array.from(data.files ?? [])
}
