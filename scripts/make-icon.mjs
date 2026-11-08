// Renders assets/icon.svg to assets/icon.png (256x256, transparent) with headless Chrome or Edge.
// Usage: node scripts/make-icon.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const browser = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].find((path) => existsSync(path))
if (!browser) throw new Error('Chrome or Edge is needed to render the icon')

const svg = readFileSync(join(root, 'assets/icon.svg'), 'utf8')
const work = mkdtempSync(join(tmpdir(), 'enhance-icon-'))
const html = join(work, 'icon.html')
writeFileSync(html, `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden"><div style="width:256px;height:256px;line-height:0">${svg.replace("<svg ", "<svg style=\"display:block\" ")}</div></body></html>`)
execFileSync(browser, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--default-background-color=00000000',
  '--window-size=256,256',
  `--screenshot=${join(root, 'assets/icon.png')}`,
  pathToFileURL(html).href
], { stdio: 'ignore' })
rmSync(work, { recursive: true, force: true })
console.log('assets/icon.png')
