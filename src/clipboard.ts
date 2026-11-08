// Copies text to the clipboard of the machine the worker runs on, with the OS's own tool.
// Fixed commands only; the text is written to the tool's stdin, never put on a command line.
import { spawn } from 'node:child_process'

type Tool = { command: string; args: string[]; encode: (text: string) => Buffer }

const utf8 = (text: string) => Buffer.from(text, 'utf8')
// clip.exe reads UTF-16LE when the input starts with a byte-order mark.
const utf16 = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])

/** The OS tools tried in order, with how each wants its input encoded. Exported for tests. */
export function clipboardTools(platform: NodeJS.Platform): Tool[] {
  if (platform === 'win32') {
    return [{ command: 'clip.exe', args: [], encode: utf16 }]
  }
  if (platform === 'darwin') {
    return [{ command: 'pbcopy', args: [], encode: utf8 }]
  }
  return [
    { command: 'wl-copy', args: [], encode: utf8 },
    { command: 'xclip', args: ['-selection', 'clipboard'], encode: utf8 },
    { command: 'xsel', args: ['--clipboard', '--input'], encode: utf8 }
  ]
}

function run(tool: Tool, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool.command, tool.args, {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
      env: { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8' }
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${tool.command} timed out`))
    }, 5000)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${tool.command} exited with ${code}`))
      }
    })
    child.stdin.end(tool.encode(text))
  })
}

export async function copyToClipboard(
  text: string,
  platform: NodeJS.Platform = process.platform
): Promise<{ copied: boolean; error?: string }> {
  let lastError = 'no clipboard tool found'
  for (const tool of clipboardTools(platform)) {
    try {
      await run(tool, text)
      return { copied: true }
    } catch (error) {
      lastError = (error as Error).message
    }
  }
  return { copied: false, error: lastError }
}
