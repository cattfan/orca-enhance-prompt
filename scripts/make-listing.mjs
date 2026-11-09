// Builds the listing pictures (assets/cover.jpg, assets/screenshots/*.jpg, 1600x1000) from the real
// web panel: the dev server's sample data (cd web && npm run dev, http://localhost:5174, ?mock=1) is
// shot with headless Edge or Chrome, then laid out on the cover art (assets/art/cover-art.jpg, drawn
// with gpt-image-2.5-sunburst) with the logo (assets/art/logo-512.png). JPEG conversion uses
// scripts/to-jpg.ps1 (Windows). Usage: node scripts/make-listing.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const SERVER = 'http://localhost:5174'
const browser = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find((path) => existsSync(path))
if (!browser) throw new Error('Edge or Chrome is needed')
await fetch(SERVER).catch(() => {
  throw new Error(`Start the dev server first: cd web && npm run dev (${SERVER})`)
})

const work = mkdtempSync(join(tmpdir(), 'listing-'))
const shoot = (out, url, width, height, waitMs = 6000) =>
  execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'listing-browser-'))}`,
      `--virtual-time-budget=${waitMs}`,
      `--window-size=${width},${height}`,
      `--screenshot=${out}`,
      url
    ],
    { stdio: 'ignore' }
  )

// The panel at a sidebar's width (380 px), on the sample data.
const PROMPT = encodeURIComponent('login page is broken on mobile')
const panels = {
  result: `mock=1&lang=en&width=380&demo=${PROMPT}`,
  options: `mock=1&lang=en&width=380&demo=${PROMPT}&options=1`,
  models: 'mock=1&lang=en&width=380&tab=models',
  vi: `mock=1&lang=vi&width=380&demo=${encodeURIComponent('trang đăng nhập bị vỡ trên điện thoại')}`,
  zh: 'mock=1&lang=zh&width=380&tab=history',
  dark: `mock=1&lang=en&width=380&theme=dark&demo=${PROMPT}`
}
const shots = {}
for (const [name, query] of Object.entries(panels)) {
  const file = join(work, `${name}.png`)
  shoot(file, `${SERVER}/?${query}`, 800, 1000, query.includes('demo=') ? 15000 : 6000)
  shots[name] = pathToFileURL(file).href
  console.log('shot', name)
}

const asset = (path) => pathToFileURL(join(root, path)).href
const panel = (name, height, scale = 1.3) =>
  `<div class="panel" style="width:${380 * scale}px;height:${height * scale}px"><img src="${shots[name]}" style="width:${800 * scale}px"></div>`

const css = `
  * { box-sizing: border-box; margin: 0; }
  body { width: 1600px; height: 1000px; overflow: hidden; font-family: "Segoe UI", system-ui, sans-serif; color: #0a0a0a; background: #f5f5f4; position: relative; }
  .art { position: absolute; left: 0; bottom: 0; width: 1600px; height: 533px; background: url("${asset('assets/art/cover-art.jpg')}") center / cover no-repeat; }
  .brand { position: absolute; left: 96px; top: 84px; display: flex; align-items: center; gap: 16px; font-size: 26px; font-weight: 600; letter-spacing: -0.01em; }
  .brand img { width: 56px; height: 56px; }
  .brand span { color: #78716c; font-weight: 400; }
  h1 { position: absolute; left: 96px; top: 200px; font-size: 72px; line-height: 1.05; font-weight: 700; letter-spacing: -0.03em; }
  .lead { position: absolute; left: 96px; top: 380px; width: 640px; font-size: 24px; line-height: 1.45; color: #44403c; }
  .chips { position: absolute; left: 96px; top: 500px; display: flex; gap: 10px; flex-wrap: wrap; width: 700px; }
  .chip { border: 1px solid #d6d3d1; background: #ffffff; border-radius: 999px; padding: 8px 16px; font-size: 18px; color: #292524; }
  .panel { overflow: hidden; border-radius: 16px; border: 1px solid #d6d3d1; background: #fff; box-shadow: 0 24px 60px rgba(0,0,0,0.12); }
  .panel img { display: block; }
  .stage { position: absolute; display: flex; gap: 40px; align-items: flex-start; }
  .center { left: 50%; transform: translateX(-50%); }
  .side-art { position: absolute; right: -260px; bottom: -40px; width: 1100px; height: 367px; background: url("${asset('assets/art/cover-art.jpg')}") center / cover no-repeat; opacity: 0.55; }
  .caption { position: absolute; left: 96px; top: 84px; width: 1400px; }
  .caption h2 { font-size: 48px; font-weight: 700; letter-spacing: -0.02em; }
  .caption p { margin-top: 12px; font-size: 22px; color: #57534e; width: 1100px; line-height: 1.45; }
  .label { margin-top: 12px; font-size: 16px; color: #78716c; text-align: center; }
`
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`
const header = (title, text) => `<div class="caption"><div class="brand" style="position:static;margin-bottom:28px"><img src="${asset('assets/icon.png')}" alt="">Enhance Prompt <span>for Orca</span></div><h2>${title}</h2><p>${text}</p></div>`

const pages = {
  cover: page(`<div class="art"></div>
    <div class="brand"><img src="${asset('assets/icon.png')}" alt="">Enhance Prompt <span>for Orca</span></div>
    <h1>Rough idea in.<br>Precise prompt out.</h1>
    <p class="lead">Turns a quick note into a project-aware prompt for Claude Code, Codex, Gemini and other agents, then sends it to the terminal.</p>
    <div class="chips"><span class="chip">Your subscription or API key</span><span class="chip">Project context</span><span class="chip">Files and screenshots</span><span class="chip">EN · VI · 中文</span></div>
    <div class="stage" style="right:96px;top:84px">${panel('result', 410, 1.45)}</div>`),
  '1-enhance': page(`${header('Grounded in your project', 'Rules, stack, git changes and the code that matters are read for you. See every item sent, untick what you do not want, paste a screenshot or attach files.')}
    <div class="side-art"></div><div class="stage center" style="top:330px">${panel('options', 440)}${panel('result', 410)}</div>`),
  '2-models': page(`${header('Your models, with fallback', 'Use the Claude Code or Codex subscription you already pay for, or any API key: OpenAI, Anthropic, OpenRouter, Gemini, Groq, Ollama and more. If one fails, the next one answers.')}
    <div class="side-art"></div><div class="stage center" style="top:330px">${panel('models', 440)}${panel('dark', 410)}</div>`),
  '3-languages': page(`${header('English, Tiếng Việt and 中文', 'The panel follows Orca\u2019s language or yours, and the enhanced prompt can be written in the language your agent works best in.')}
    <div class="side-art"></div><div class="stage center" style="top:330px">${panel('vi', 440)}${panel('zh', 440)}</div>`)
}

const outputs = { cover: 'assets/cover.jpg', '1-enhance': 'assets/screenshots/1-enhance.jpg', '2-models': 'assets/screenshots/2-models.jpg', '3-languages': 'assets/screenshots/3-languages.jpg' }
mkdirSync(join(root, 'assets/screenshots'), { recursive: true })
for (const [name, html] of Object.entries(pages)) {
  const htmlFile = join(work, `${name}.html`)
  const png = join(work, `${name}-page.png`)
  writeFileSync(htmlFile, html)
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'listing-browser-'))}`, '--allow-file-access-from-files', '--virtual-time-budget=3000', '--window-size=1600,1000', `--screenshot=${png}`, pathToFileURL(htmlFile).href], { stdio: 'ignore' })
  execFileSync('powershell', ['-NoProfile', '-File', join(root, 'scripts/to-jpg.ps1'), png, join(root, outputs[name]), '88'], { stdio: 'inherit' })
  console.log(outputs[name], readFileSync(join(root, outputs[name])).length)
}
rmSync(work, { recursive: true, force: true })
