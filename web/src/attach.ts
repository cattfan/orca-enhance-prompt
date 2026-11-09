// Attaching files in the web panel: paste, drop or the paperclip. A frame has no path for a file, so
// its bytes go to the worker in chunks (`attachments.put`), which keeps it in a temporary folder and
// answers with the path the run then uses.
import { plugin, read, set } from 'orca'
import { t } from '../../src/i18n.ts'
import { files, notice, message, put, type AttachedFile } from '../../src/panel/state.ts'

export const MAX_FILES = 8
export const MAX_FILE_BYTES = 10 * 1024 * 1024
/** Raw bytes per request (about 1 MB once in base64). */
const CHUNK = 768 * 1024

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

async function uploadOne(file: File): Promise<AttachedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const id = newId()
  const name = nameOf(file)
  const total = Math.max(1, Math.ceil(bytes.length / CHUNK))
  let answer: unknown = null
  for (let index = 0; index < total; index += 1) {
    const data = toBase64(bytes.subarray(index * CHUNK, (index + 1) * CHUNK))
    answer = await plugin.request('attachments.put', { id, name, index, total, data }, { timeoutMs: 60_000 })
  }
  const done = answer as { path: string; bytes: number }
  return { path: done.path, name, bytes: bytes.length, type: file.type || 'application/octet-stream' }
}

/** Attaches files (from a paste, a drop or the picker); too many or too large ones get a notice. */
export async function attachFiles(list: readonly File[], refresh: () => void): Promise<void> {
  const room = MAX_FILES - read<AttachedFile[]>(files).length - uploading.length
  if (list.length > room) set(notice, { tone: 'warning', text: t('At most {max} files per prompt.', { max: MAX_FILES }) })
  for (const file of list.slice(0, Math.max(0, room))) {
    if (file.size > MAX_FILE_BYTES) {
      set(notice, { tone: 'warning', text: t('{name} is too large; an attachment can be at most {max}.', { name: file.name, max: '10 MB' }) })
      continue
    }
    const name = nameOf(file)
    uploading = [...uploading, name]
    refresh()
    try {
      const attached = await uploadOne(file)
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
