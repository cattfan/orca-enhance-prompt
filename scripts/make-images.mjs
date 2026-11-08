// Builds the listing images (assets/cover.png, assets/screenshots/*.png) from the panel's own
// component trees: `orca plugin check --json` renders every shot-* scenario (sample data only),
// scripts/render-panel.mjs draws each tree the way Orca does, and headless Chrome/Edge takes the
// 1600x1000 picture. Usage: node scripts/make-images.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { icon, PANEL_CSS, renderPanel } from './render-panel.mjs'

const root = resolve(import.meta.dirname, '..')
const browsers = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
]
const browser = browsers.find((path) => existsSync(path))
if (!browser) throw new Error('Chrome or Edge is needed to render the images')

const raw = execFileSync('orca', ['plugin', 'check', '.', '--json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  // orca can be a .cmd shim on Windows; the arguments are fixed words.
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'ignore']
})
let check
try {
  check = JSON.parse(raw)
} catch (error) {
  console.error(`orca plugin check --json did not return JSON: ${error.message}`)
  process.exit(1)
}
const result = check.result ?? check
const tree = (scenario) => {
  const found = result.panels.find((panel) => panel.scenario === scenario)
  if (!found?.tree) throw new Error(`No tree for scenario ${scenario}`)
  return found.tree
}

const iconData = `data:image/png;base64,${readFileSync(join(root, 'assets/icon.png')).toString('base64')}`
const PAGE_CSS = `
html,body{margin:0;width:1600px;height:1000px;overflow:hidden}
body{font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#fafafa;
  background:radial-gradient(1200px 700px at 85% 10%,#2563eb55,transparent 60%),radial-gradient(900px 600px at 0% 100%,#7c3aed66,transparent 60%),linear-gradient(135deg,#0b1020,#141a33 55%,#0b1020)}
.stage{position:absolute;inset:0;display:flex;align-items:center;gap:64px;padding:0 90px;box-sizing:border-box}
.copy{flex:1;min-width:0}
.brand{display:flex;align-items:center;gap:14px;font-weight:600;font-size:22px;color:#c7d2fe;margin-bottom:26px}
.brand img{width:44px;height:44px;border-radius:11px}
h1{font-size:58px;line-height:1.08;margin:0 0 22px;letter-spacing:-1.5px}
h1 em{font-style:normal;background:linear-gradient(90deg,#a78bfa,#60a5fa,#22d3ee);-webkit-background-clip:text;color:transparent}
p.lead{font-size:23px;line-height:1.5;color:#cbd5e1;margin:0 0 30px;max-width:640px}
ul.points{list-style:none;padding:0;margin:0;display:grid;gap:14px;font-size:19px;color:#e2e8f0}
ul.points li{display:flex;gap:12px;align-items:flex-start}
ul.points .ic{color:#60a5fa;flex:none;margin-top:3px}
.frame{border-radius:16px;overflow:hidden;box-shadow:0 30px 80px #000a,0 0 0 1px #ffffff1a;flex:none;background:#fff}
.frame.dark{background:#18181b}
.chip{display:inline-flex;gap:8px;align-items:center;font-size:15px;padding:6px 12px;border-radius:999px;background:#ffffff14;border:1px solid #ffffff26;color:#e2e8f0;margin:0 8px 8px 0}
.caption{font-size:14px;color:#94a3b8;margin-top:10px;text-align:center}
${PANEL_CSS}`

const page = (body) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_CSS}</style></head><body>${body}</body></html>`
const CONTEXT_FOLD = /^(Context used|Ngữ cảnh đã dùng|已用上下文)/
const frame = (scenario, { dark = true, open = false, height = 900, scale = 1, width = 420, offset = 0 } = {}) =>
  `<div class="frame${dark ? ' dark' : ''}" style="width:${width * scale}px;height:${height * scale}px"><div style="transform:scale(${scale});transform-origin:0 0;margin-top:${-offset * scale}px">${renderPanel(tree(scenario), { dark, open: open ? CONTEXT_FOLD : false, width })}</div></div>`

/** A README feature picture: one or more panel crops on the brand background, 960x600. */
const feature = (...frames) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_CSS}
html,body{width:960px;height:600px}.stage{justify-content:center;padding:0;gap:28px}</style></head><body><div class="stage">${frames.join('')}</div></body></html>`
const brand = `<div class="brand"><img src="${iconData}" alt="">Enhance Prompt for Orca</div>`
const points = (items) => `<ul class="points">${items.map(([ic, text]) => `<li>${icon(ic, 22)}<span>${text}</span></li>`).join('')}</ul>`

const images = {
  cover: page(`<div class="stage">
    <div class="copy">${brand}
      <h1>Rough idea in,<br><em>project-aware prompt</em> out.</h1>
      <p class="lead">Rewrite prompts for Claude Code, Codex and Gemini CLI with your repo's real files, rules and commands, then send them straight to an agent terminal.</p>
      <div><span class="chip">${icon('agent', 16)} Your subscription or API key</span><span class="chip">${icon('zap', 16)} Fallback across models</span><span class="chip">${icon('book', 16)} EN · VI · 中文</span></div>
    </div>
    ${frame('shot-enhance', { height: 930, scale: 0.98 })}
  </div>`),
  'screenshots/1-enhance': page(`<div class="stage">
    <div class="copy">${brand}
      <h1>Grounded in <em>your repo</em></h1>
      <p class="lead">Five context levels, from the prompt alone to rules, stack, git changes and the code that matches your request.</p>
      ${points([
        ['book', 'Reads AGENTS.md, CLAUDE.md, .cursorrules, README and real build/test commands'],
        ['search', 'Deep: git status/diff and relevant files found by search, with line snippets'],
        ['check', 'See every item sent, untick what you do not want; .env and keys are never read'],
        ['play', 'Send to the agent terminal, copy, or refine again']
      ])}
    </div>
    ${frame('shot-enhance', { open: true, height: 930, scale: 0.98, offset: 240 })}
  </div>`),
  'screenshots/2-models': page(`<div class="stage">
    <div class="copy">${brand}
      <h1>Any model, <em>with fallback</em></h1>
      <p class="lead">Use the subscription you already have, or bring an API key. When one model fails, the next one answers.</p>
      ${points([
        ['agent', 'Claude Code, Codex CLI and Gemini CLI detected and added in one click: no API key'],
        ['zap', 'OpenAI, Anthropic, OpenRouter, Gemini, Groq, DeepSeek, Mistral, Ollama, LM Studio, any OpenAI-compatible endpoint'],
        ['refresh', 'Reorder, enable, test; fall back on any error or only on network/429/5xx'],
        ['settings', 'Pick a fast model for auto-enhance and one for picking files']
      ])}
    </div>
    ${frame('shot-models', { height: 930, scale: 0.98 })}
  </div>`),
  'screenshots/3-languages': page(`<div class="stage" style="gap:36px;padding:0 60px">
    <div style="flex:none;width:430px">${brand}
      <h1 style="font-size:50px">EN · VI · <em>中文</em></h1>
      <p class="lead" style="font-size:21px">The panel follows Orca's language or your choice, and the enhanced prompt can be written in English, Vietnamese or Chinese, per prompt.</p>
      ${points([['book', 'History with search, reuse and copy'], ['zap', 'Auto-enhance prompts Orca sends to agents']])}
    </div>
    <div>${frame('shot-enhance-vi', { height: 930, scale: 0.92 })}<div class="caption">Tiếng Việt</div></div>
    <div>${frame('shot-history-zh', { height: 930, scale: 0.92 })}<div class="caption">中文 · 历史</div></div>
  </div>`)
}

// README feature pictures (docs/assets/readme-features), rendered at 2x for sharp text.
const features = {
  'enhance-and-send': feature(frame('shot-enhance', { height: 520, scale: 1.02, offset: 385 })),
  'project-context': feature(frame('shot-enhance', { open: true, height: 640, scale: 0.82, offset: 95 })),
  subscription: feature(frame('shot-models', { height: 500, scale: 1.04, offset: 95 })),
  'models-fallback': feature(frame('shot-models', { height: 480, scale: 1.08, offset: 750 })),
  languages: feature(
    frame('shot-enhance-vi', { height: 640, scale: 0.84, offset: 0 }),
    frame('shot-history-zh', { height: 640, scale: 0.84, offset: 0 })
  ),
  history: feature(frame('shot-history', { height: 520, scale: 1.04, offset: 0 }))
}

const work = mkdtempSync(join(tmpdir(), 'enhance-images-'))
mkdirSync(join(root, 'assets/screenshots'), { recursive: true })
mkdirSync(join(root, 'docs/assets/readme-features'), { recursive: true })
const shoot = (html, out, size, dpr) => {
  const file = join(work, `${Math.random().toString(36).slice(2)}.html`)
  writeFileSync(file, html)
  execFileSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--force-device-scale-factor=${dpr}`,
    `--window-size=${size}`,
    `--screenshot=${out}`,
    pathToFileURL(file).href
  ], { stdio: 'ignore' })
}
for (const [name, html] of Object.entries(images)) {
  shoot(html, join(root, 'assets', `${name}.png`), '1600,1000', 1)
  console.log(`assets/${name}.png`)
}
for (const [name, html] of Object.entries(features)) {
  shoot(html, join(root, 'docs/assets/readme-features', `${name}.png`), '960,600', 2)
  console.log(`docs/assets/readme-features/${name}.png`)
}
rmSync(work, { recursive: true, force: true })
