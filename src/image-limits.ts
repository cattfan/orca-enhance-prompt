// Limits of attached images and files, shared by the panel and the worker (no Node imports here).
export const MAX_IMAGES = 4
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** A file pasted, dropped or picked in the panel can be at most this large. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
/**
 * Orca accepts a panel request whose input is at most 64 KiB of JSON; a larger one is refused with
 * `too_large` ("message too large"). Attachments go up in pieces of ATTACHMENT_CHUNK_BYTES: in base64
 * that is 60,076 characters, which leaves room for the id, the name and the JSON around them.
 */
export const REQUEST_INPUT_LIMIT = 64 * 1024
export const ATTACHMENT_CHUNK_BYTES = 44 * 1024
/** The longest base64 text one piece can be (the worker refuses anything longer). */
export const MAX_CHUNK_BASE64 = Math.ceil(ATTACHMENT_CHUNK_BYTES / 3) * 4

/**
 * The context item of an attached text file: its attachment's id and its name, the last two parts of
 * the path `attachments.put` answered. Two files of one name are two items.
 */
export const attachmentItemId = (path: string) => `attach:${path.split(/[\\/]/).slice(-2).join('/')}`

/**
 * A file's size next to a limit it passes: in MB with as many decimals as it takes to differ from the
 * limit ("10.0 MB" over "10.0 MB" would read as allowed), else in bytes.
 */
export function sizeOver(size: number, max: number): string {
  const mb = (bytes: number, digits: number) => (bytes / (1024 * 1024)).toFixed(digits)
  for (const digits of [1, 2, 3]) if (mb(size, digits) !== mb(max, digits)) return `${mb(size, digits)} MB`
  return `${size.toLocaleString('en-US')} bytes`
}
