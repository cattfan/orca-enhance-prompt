// Builds every picture of the panel from the real web panel on its sample data (the dev server:
// cd web && npm run dev, http://localhost:5174, ?mock=1), shot with headless Edge or Chrome:
//   - the listing: assets/cover.jpg and assets/screenshots/*.jpg (1600x1000), on the cover art
//     (assets/art/cover-art.jpg, drawn with gpt-image-2.5-sunburst) with the logo;
//   - the README features: docs/assets/readme-features/*.jpg (1440x900);
//   - the user guide: docs/assets/guide/*.png (one panel each).
// JPEG conversion uses scripts/to-jpg.ps1 (Windows). Usage: node scripts/make-listing.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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
const profile = () => `--user-data-dir=${mkdtempSync(join(tmpdir(), 'listing-browser-'))}`
function shoot(out, url, width, height, waitMs, scale = 2) {
  try {
    execFileSync(
      browser,
      ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${scale}`, profile(), '--allow-file-access-from-files', `--virtual-time-budget=${waitMs}`, `--window-size=${width},${height}`, `--screenshot=${out}`, url],
      { stdio: 'ignore' }
    )
  } catch (error) {
    // The browser can crash on exit when a run is still going (the mid-run shots): the picture is taken by then.
    if (!existsSync(out)) throw error
  }
}

/** The drawn content's height: the dev page writes it in its title (web/src/main.tsx). */
function measure(url, waitMs) {
  let dom = ''
  try {
    dom = execFileSync(browser, ['--headless=new', '--disable-gpu', profile(), `--virtual-time-budget=${waitMs}`, '--window-size=800,1600', '--dump-dom', url], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024
    })
  } catch (error) {
    // The browser sometimes crashes on exit after printing the page: the page is still there.
    dom = String(error.stdout ?? '')
  }
  const height = Number(/<title>height:(\d+)<\/title>/.exec(dom)?.[1])
  if (!height) throw new Error(`Could not measure ${url}`)
  return height
}

// The panel at a sidebar's width (380 px), on the sample data. `wait` is simulated time: a run takes
// about 4.5 s, so a shorter wait catches it half way.
const PROMPT = encodeURIComponent('login page is broken on mobile')
const VI = encodeURIComponent('trang đăng nhập bị vỡ trên điện thoại')
const panels = {
  result: { query: `lang=en&demo=${PROMPT}`, wait: 15000 },
  options: { query: `lang=en&demo=${PROMPT}&options=1`, wait: 15000 },
  attach: { query: `lang=en&demo=${PROMPT}&attach=1&run=0`, wait: 4000 },
  progress: { query: `lang=en&demo=${PROMPT}`, wait: 3000 },
  progressEarly: { query: `lang=en&demo=${PROMPT}`, wait: 1500 },
  models: { query: 'lang=en&tab=models', wait: 6000 },
  rules: { query: 'lang=en&tab=rules', wait: 6000 },
  history: { query: 'lang=en&tab=history', wait: 6000 },
  vi: { query: `lang=vi&demo=${VI}`, wait: 15000 },
  zh: { query: 'lang=zh&tab=history', wait: 6000 },
  dark: { query: `lang=en&theme=dark&demo=${PROMPT}`, wait: 15000 },
  modelsDark: { query: 'lang=en&theme=dark&tab=models', wait: 6000 }
}
const shots = {}
const heights = {}
for (const [name, { query, wait }] of Object.entries(panels)) {
  const file = join(work, `${name}.png`)
  const url = `${SERVER}/?mock=1&width=380&${query}`
  heights[name] = measure(url, wait)
  // The whole panel, its last card's corners included.
  shoot(file, url, 800, heights[name] + 40, wait)
  shots[name] = pathToFileURL(file).href
  console.log('shot', name, heights[name])
}

const asset = (path) => pathToFileURL(join(root, path)).href
/** Panels side by side, scaled to fit `room` px of height (at most `max` times). */
const panel = (names, room, max = 1.35) => {
  const scale = Math.min(max, room / Math.max(...names.map((name) => heights[name])))
  return names
    .map((name) => `<div class="panel" style="width:${380 * scale}px;height:${heights[name] * scale}px"><img src="${shots[name]}" style="width:${800 * scale}px"></div>`)
    .join('')
}

const css = (width, height) => `
  * { box-sizing: border-box; margin: 0; }
  body { width: ${width}px; height: ${height}px; overflow: hidden; font-family: "Segoe UI", system-ui, sans-serif; color: #0a0a0a; background: #f5f5f4; position: relative; }
  .art { position: absolute; left: 0; bottom: 0; width: 1600px; height: 533px; background: url("${asset('assets/art/cover-art.jpg')}") center / cover no-repeat; }
  .side-art { position: absolute; right: -260px; bottom: -40px; width: 1100px; height: 367px; background: url("${asset('assets/art/cover-art.jpg')}") center / cover no-repeat; opacity: 0.55; }
  .brand { position: absolute; left: 96px; top: 84px; display: flex; align-items: center; gap: 16px; font-size: 26px; font-weight: 600; letter-spacing: -0.01em; }
  .brand img { width: 56px; height: 56px; }
  .brand span { color: #78716c; font-weight: 400; }
  h1 { position: absolute; left: 96px; top: 200px; font-size: 72px; line-height: 1.05; font-weight: 700; letter-spacing: -0.03em; }
  .lead { position: absolute; left: 96px; top: 380px; width: 640px; font-size: 24px; line-height: 1.45; color: #44403c; }
  .chips { position: absolute; left: 96px; top: 500px; display: flex; gap: 10px; flex-wrap: wrap; width: 700px; }
  .chip { border: 1px solid #d6d3d1; background: #ffffff; border-radius: 999px; padding: 8px 16px; font-size: 18px; color: #292524; }
  .panel { overflow: hidden; border-radius: 16px; border: 1px solid #d6d3d1; background: #fff; box-shadow: 0 24px 60px rgba(0,0,0,0.12); flex: none; }
  .panel img { display: block; }
  .stage { position: absolute; display: flex; gap: 40px; align-items: flex-start; }
  .center { left: 50%; transform: translateX(-50%); }
  .middle { top: 50%; transform: translate(-50%, -50%); }
  .caption { position: absolute; left: 96px; top: 84px; width: 1400px; }
  .caption h2 { font-size: 48px; font-weight: 700; letter-spacing: -0.02em; }
  .caption p { margin-top: 12px; font-size: 22px; color: #57534e; width: 1100px; line-height: 1.45; }
`
const page = (body, width = 1600, height = 1000) => `<!doctype html><html><head><meta charset="utf-8"><style>${css(width, height)}</style></head><body>${body}</body></html>`
const header = (title, text) =>
  `<div class="caption"><div class="brand" style="position:static;margin-bottom:28px"><img src="${asset('assets/icon.png')}" alt="">Enhance Prompt <span>for Orca</span></div><h2>${title}</h2><p>${text}</p></div>`
const listing = (names, title, text) => page(`${header(title, text)}<div class="side-art"></div><div class="stage center" style="top:325px">${panel(names, 640)}</div>`)
/** A README feature: the panels alone, centred on the art (the README text sits next to it). */
const feature = (names) => page(`<div class="side-art"></div><div class="stage center middle">${panel(names, 820, 1.5)}</div>`, 1440, 900)

const pages = {
  'assets/cover.jpg': page(`<div class="art"></div>
    <div class="brand"><img src="${asset('assets/icon.png')}" alt="">Enhance Prompt <span>for Orca</span></div>
    <h1>Rough idea in.<br>Precise prompt out.</h1>
    <p class="lead">Turns a quick note into a project-aware prompt for Claude Code, Codex, Gemini and other agents, then sends it to the terminal.</p>
    <div class="chips"><span class="chip">Your subscription or API key</span><span class="chip">Project context</span><span class="chip">Files and screenshots</span><span class="chip">EN · VI · 中文</span></div>
    <div class="stage" style="right:96px;top:72px">${panel(['result'], 856)}</div>`),
  'assets/screenshots/1-enhance.jpg': listing(['options', 'result'], 'Grounded in your project', 'Rules, stack, git changes and the code that matters are read for you. See every item sent, untick what you do not want, paste a screenshot or attach files.'),
  'assets/screenshots/2-models.jpg': listing(['models', 'dark'], 'Your models, with fallback', 'Use the Claude Code or Codex subscription you already pay for, or any API key: OpenAI, Anthropic, OpenRouter, Gemini, Groq, Ollama and more. If one fails, the next one answers.'),
  'assets/screenshots/3-languages.jpg': listing(['vi', 'zh'], 'English, Tiếng Việt and 中文', 'The panel follows Orca\u2019s language or yours, and the enhanced prompt can be written in the language your agent works best in.'),
  'docs/assets/readme-features/enhance-and-send.jpg': feature(['attach', 'result']),
  'docs/assets/readme-features/project-context.jpg': feature(['options']),
  'docs/assets/readme-features/subscription.jpg': feature(['models']),
  'docs/assets/readme-features/models-fallback.jpg': feature(['modelsDark', 'dark']),
  'docs/assets/readme-features/languages.jpg': feature(['vi', 'zh']),
  'docs/assets/readme-features/history.jpg': feature(['history'])
}
/** User guide pictures: one panel on a plain background, as the guide shows it. */
const guide = {
  'docs/assets/guide/1-enhance-and-send.png': 'result',
  'docs/assets/guide/2-attach-files.png': 'attach',
  'docs/assets/guide/3-progress.png': 'progress',
  'docs/assets/guide/4-progress-early.png': 'progressEarly',
  'docs/assets/guide/6-rules-and-structures.png': 'rules',
  'docs/assets/guide/7-models.png': 'models',
  'docs/assets/guide/8-history.png': 'history'
}

const render = (html, width, height, out) => {
  const htmlFile = join(work, `page-${Math.random().toString(36).slice(2)}.html`)
  writeFileSync(htmlFile, html)
  mkdirSync(dirname(out), { recursive: true })
  shoot(out, pathToFileURL(htmlFile).href, width, height, 3000, 1)
}
for (const [path, html] of Object.entries(pages)) {
  const [width, height] = path.includes('readme-features') ? [1440, 900] : [1600, 1000]
  const png = join(work, 'page.png')
  render(html, width, height, png)
  execFileSync('powershell', ['-NoProfile', '-File', join(root, 'scripts/to-jpg.ps1'), png, join(root, path), '88'], { stdio: 'inherit' })
  console.log(path, readFileSync(join(root, path)).length)
}
for (const [path, name] of Object.entries(guide)) {
  // 2x pixels of a 380 px panel with a 24 px margin: sharp on any screen, shown at half size.
  const height = heights[name] + 48
  const html = `<!doctype html><html><head><style>* { margin: 0 } body { width: 428px; height: ${height}px; background: #f5f5f4; } .panel { margin: 24px; width: 380px; height: ${heights[name]}px; overflow: hidden; border-radius: 12px; border: 1px solid #d6d3d1; background: #fff; } img { display: block; width: 800px }</style></head><body><div class="panel"><img src="${shots[name]}"></div></body></html>`
  const htmlFile = join(work, 'guide.html')
  writeFileSync(htmlFile, html)
  const png = join(work, 'guide.png')
  shoot(png, pathToFileURL(htmlFile).href, 800, height, 3000, 2)
  // Keep the panel's 428 px (856 at 2x): crop the window's extra width away.
  execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Drawing; $i=[Drawing.Image]::FromFile('${png}'); $b=New-Object Drawing.Bitmap 856,${height * 2}; $g=[Drawing.Graphics]::FromImage($b); $g.DrawImage($i,0,0); $b.Save('${join(root, path)}'); $i.Dispose()`], { stdio: 'inherit' })
  console.log(path)
}
rmSync(work, { recursive: true, force: true })
