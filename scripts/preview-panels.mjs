// Renders every shot-* scenario as a full-height panel PNG into .orca/preview/, to check the layout
// and pick crop offsets for scripts/make-images.mjs. Usage: node scripts/preview-panels.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PANEL_CSS, renderPanel } from './render-panel.mjs'

const root = resolve(import.meta.dirname, '..')
const browser = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find((path) => existsSync(path))
const raw = execFileSync('orca', ['plugin', 'check', '.', '--json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'ignore']
})
let check
try {
  check = JSON.parse(raw)
} catch {
  console.error('orca plugin check --json did not return JSON')
  process.exit(1)
}
const out = join(root, '.orca/preview')
mkdirSync(out, { recursive: true })
for (const panel of (check.result ?? check).panels.filter((p) => p.scenario?.startsWith('shot-') && !p.scenario.endsWith('-dark'))) {
  const html = join(out, `${panel.scenario}.html`)
  writeFileSync(
    html,
    `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#000}${PANEL_CSS}</style></head><body>${renderPanel(panel.tree, { dark: true, open: /^(Context used|Ngữ cảnh|已用)/ })}</body></html>`
  )
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=420,1400', `--screenshot=${join(out, `${panel.scenario}.png`)}`, pathToFileURL(html).href], { stdio: 'ignore' })
  console.log(`.orca/preview/${panel.scenario}.png`)
}
