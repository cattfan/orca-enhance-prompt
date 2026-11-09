// Progress mock: runs the panel's real run card through simulated runs (steps one after another,
// steps side by side, and a cancel) with no worker, model, git or network, then draws every frame.
//   node scripts/mock-progress.mjs          # English
//   node scripts/mock-progress.mjs --vi     # Vietnamese
//   node scripts/mock-progress.mjs --width 280   # a narrow panel
// Writes .orca/mock-progress/index.html (open it: the frames play like a video, with a slider) and
// one PNG per frame when Chrome or Edge is installed, and prints the total and every step's share.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PANEL_CSS, renderPanel } from './render-panel.mjs'

const root = resolve(import.meta.dirname, '..')
const out = join(root, '.orca', 'mock-progress')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const lang = process.argv.includes('--vi') ? 'vi' : 'en'
// --width 280 shows a narrow panel (default 380).
const widthAt = process.argv.indexOf('--width')
const width = widthAt > 0 ? Number(process.argv[widthAt + 1]) || 380 : 380

// The mock is a test file so it runs on Orca's own panel runtime (orca/testing); the runner needs the
// whole plugin folder, and this env var turns the mock on (the other tests run too, in seconds).
const run = spawnSync('orca', ['plugin', 'test', '.'], {
  cwd: root,
  encoding: 'utf8',
  // No shell: orca.exe is on PATH (the same way scripts/e2e.mjs runs it).
  env: { ...process.env, MOCK_PROGRESS_OUT: out, MOCK_PROGRESS_LANG: lang }
})
const framesFile = join(out, 'frames.json')
if (run.status !== 0 || !existsSync(framesFile)) {
  console.error(run.stdout, run.stderr)
  console.error('The progress mock did not run.')
  process.exit(1)
}
let frames
try {
  frames = JSON.parse(readFileSync(framesFile, 'utf8'))
} catch (error) {
  console.error(`Could not read ${framesFile}: ${error.message}`)
  process.exit(1)
}

// The run card only: the first Box that holds the total bar.
function runCard(tree) {
  let found = null
  const walk = (node) => {
    if (found || !node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (node.type === 'Box' && JSON.stringify(node).includes('"label":"' + (lang === 'vi' ? 'Tiến độ: ' : 'Progress: '))) {
      found = node
      return
    }
    node.children?.forEach(walk)
  }
  walk(tree)
  return found
}

// The card's running time is a live clock in Orca; here it is the frame's simulated time.
function atTime(node, ms) {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((child) => atTime(child, ms))
  if (node.type === 'RelativeTime') return `${(ms / 1000).toFixed(1)} s`
  return { ...node, children: node.children?.map((child) => atTime(child, ms)) }
}
const pages = frames.map((frame) => renderPanel(atTime(runCard(frame.tree) ?? frame.tree, frame.at), { dark: true, width }))
const rows = []
for (const frame of frames) {
  const steps = Object.entries(frame.bars)
    .filter(([label]) => !/^(Progress|Tiến độ): /.test(label))
    .map(([label, value]) => `${label.replace(/: \d+%$/, '')} ${value}%`)
  rows.push(`${frame.plan.padEnd(10)} t=${String(frame.at).padStart(5)} ms  total ${String(frame.total).padStart(3)}%  ${steps.join(' | ')}`)
}
console.log(rows.join('\n'))

writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><html><head><meta charset="utf-8"><title>Progress mock</title><style>
body{margin:0;background:#111;color:#ddd;font:13px system-ui;padding:16px}${PANEL_CSS}
.bar{display:flex;gap:10px;align-items:center;margin-bottom:12px}.frame{display:none}.frame.on{display:block}
</style></head><body>
<div class="bar"><button id="play">Pause</button><input id="pos" type="range" min="0" max="${pages.length - 1}" value="0" style="width:300px"><span id="info"></span></div>
${pages.map((html, index) => `<div class="frame" data-i="${index}">${html}</div>`).join('\n')}
<script>
const frames=${JSON.stringify(frames.map((frame) => ({ plan: frame.plan, at: frame.at, total: frame.total })))};
const nodes=[...document.querySelectorAll('.frame')];let i=0,playing=true;
function show(n){i=n;nodes.forEach((node,k)=>node.classList.toggle('on',k===n));pos.value=n;const f=frames[n];info.textContent=f.plan+' · t='+(f.at/1000).toFixed(1)+' s · total '+f.total+'%'}
play.onclick=()=>{playing=!playing;play.textContent=playing?'Pause':'Play'};pos.oninput=()=>show(Number(pos.value));
setInterval(()=>{if(playing)show((i+1)%nodes.length)},700);show(0);
</script></body></html>`
)

const browser = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find((path) => existsSync(path))
// --no-png: only the HTML page (the dev server's /mock-progress uses it; much faster).
if (browser && !process.argv.includes('--no-png')) {
  pages.forEach((html, index) => {
    const file = join(out, `frame-${String(index).padStart(2, '0')}-${frames[index].plan}-${frames[index].at}ms.html`)
    writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#000}${PANEL_CSS}</style></head><body>${html}</body></html>`)
    execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${width},360`, `--screenshot=${file.replace(/\.html$/, '.png')}`, pathToFileURL(file).href], { stdio: 'ignore' })
    rmSync(file)
  })
}
console.log(`\n${frames.length} frames → ${join(out, 'index.html')}${browser && !process.argv.includes('--no-png') ? ' (and a PNG per frame)' : ''}`)
