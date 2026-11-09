// Demo pictures for docs/user-guide.md, drawn from the panel's own component trees with sample data:
// `orca plugin check --json` (scenarios guide-* and shot-* in src/panel.check.ts) and the progress mock
// (scripts/mock-progress.mjs). Flat colours only. Needs Chrome or Edge.
//   node scripts/make-guide-images.mjs
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PANEL_CSS, renderPanel } from './render-panel.mjs'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'docs/assets/guide')
mkdirSync(out, { recursive: true })
const browser = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find((path) => existsSync(path))
if (!browser) throw new Error('Chrome or Edge is needed to draw the pictures')

const check = spawnSync('orca', ['plugin', 'check', '.', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
let panels
try {
  const parsed = JSON.parse(check.stdout)
  panels = (parsed.result ?? parsed).panels
} catch {
  throw new Error(`orca plugin check --json did not return JSON:\n${check.stderr}`)
}
const tree = (scenario) => {
  const found = panels.find((panel) => panel.scenario === scenario)
  if (!found?.tree) throw new Error(`No tree for scenario ${scenario}`)
  return found.tree
}

// The progress mock, for the run card at work.
const mock = spawnSync(process.execPath, ['scripts/mock-progress.mjs', '--no-png'], { cwd: root, encoding: 'utf8' })
if (mock.status !== 0) throw new Error(`The progress mock failed:\n${mock.stdout}\n${mock.stderr}`)
let frames
try {
  frames = JSON.parse(readFileSync(join(root, '.orca/mock-progress/frames.json'), 'utf8'))
} catch (error) {
  throw new Error(`Could not read the progress mock's frames: ${error.message}`)
}
const frameAt = (plan, at) => frames.find((frame) => frame.plan === plan && frame.at === at)
function runCard(node) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) return node.map(runCard).find(Boolean) ?? null
  if (node.type === 'Box' && JSON.stringify(node).includes('"label":"Progress: ')) return node
  return node.children?.map(runCard).find(Boolean) ?? null
}
function atTime(node, ms) {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((child) => atTime(child, ms))
  if (node.type === 'RelativeTime') return `${(ms / 1000).toFixed(1)} s`
  return { ...node, children: node.children?.map((child) => atTime(child, ms)) }
}
const progress = (plan, at) => {
  const frame = frameAt(plan, at)
  if (!frame) throw new Error(`No mock frame ${plan} at ${at} ms`)
  return atTime(runCard(frame.tree), at)
}

/** One picture: the panel (or a part of it) on a flat background, cut to `height`. */
function draw(name, node, { width = 420, height = 640 } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'guide-'))
  const html = join(work, `${name}.html`)
  writeFileSync(
    html,
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#0F172A}.wrap{padding:20px}.card{border-radius:12px;overflow:hidden;border:1px solid #334155}${PANEL_CSS}</style></head><body><div class="wrap"><div class="card" style="width:${width}px">${renderPanel(node, { dark: true, width })}</div></div></body></html>`
  )
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${width + 40},${height}`, `--screenshot=${join(out, `${name}.png`)}`, pathToFileURL(html).href], { stdio: 'ignore' })
  rmSync(work, { recursive: true, force: true })
  console.log(`docs/assets/guide/${name}.png`)
}

draw('1-enhance-and-send', tree('shot-enhance'), { height: 720 })
draw('2-attach-images', tree('guide-images'), { height: 520 })
draw('3-progress', progress('sequential', 7000), { height: 260 })
draw('4-progress-parallel', progress('parallel', 850), { height: 240 })
draw('5-fix-this-error', tree('guide-fix'), { height: 500 })
draw('6-rules-and-structures', tree('guide-rules'), { height: 760 })
draw('7-models', tree('shot-models'), { height: 700 })
draw('8-history', tree('shot-history'), { height: 520 })
