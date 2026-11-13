// Builds every picture of the panel from the real web panel on its sample data (the dev server:
// npm run web:dev, http://localhost:5174, ?mock=1), shot with headless Edge or Chrome:
//   - the listing: assets/cover.jpg and assets/screenshots/*.jpg (1600x1000), on the cover art
//     (assets/art/cover-art.jpg, drawn with gpt-image-2.5-sunburst) with the logo;
//   - the README features: docs/assets/readme-features/*.jpg (1200x1000). The README shows them
//     half a column wide, so each holds as little as tells its feature, as large as fits;
//   - the user guide: docs/assets/guide/*.png (one panel each, at twice its size).
// The listing's and the README's pictures leave the version out of the panel's header (?version=0):
// a number there is out of date with the next release. The guide shows the panel as it is.
// JPEG conversion uses scripts/to-jpg.ps1 (Windows).
//   node scripts/make-listing.mjs                                every picture
//   LISTING_ONLY=cover,guide/7 node scripts/make-listing.mjs     only the paths with one of these in them
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
  throw new Error(`Start the dev server first: npm run web:dev (${SERVER})`)
})

const work = mkdtempSync(join(tmpdir(), 'listing-'))
// One browser profile for the whole run: a fresh profile per launch is slow where a virus scanner
// checks every new folder.
const browserProfile = mkdtempSync(join(tmpdir(), 'listing-browser-'))
const profile = () => `--user-data-dir=${browserProfile}`
const only = process.env.LISTING_ONLY ? process.env.LISTING_ONLY.split(',').filter(Boolean) : null
const wanted = (path) => !only || only.some((part) => path.includes(part))

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

/**
 * What the dev page says about itself in its title (web/src/main.tsx): the drawn content's height
 * and, with the options open, where they are (left, top, right, bottom).
 */
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
  const title = /<title>(height:[^<]*)<\/title>/.exec(dom)?.[1] ?? ''
  const height = Number(/height:(\d+)/.exec(title)?.[1])
  if (!height) throw new Error(`Could not measure ${url}`)
  const options = /options:(-?\d+),(-?\d+),(-?\d+),(-?\d+)/.exec(title)?.slice(1).map(Number)
  return { height, ...(options ? { options } : {}) }
}

// The panel at a sidebar's width (380 px), in each state the pictures show. `wait` is simulated
// time: a run takes about 4.5 s, so a shorter wait catches it half way.
const PROMPT = encodeURIComponent('login page is broken on mobile')
const VI = encodeURIComponent('trang đăng nhập bị vỡ trên điện thoại')
const states = {
  result: { query: `lang=en&demo=${PROMPT}`, wait: 15000 },
  options: { query: `lang=en&demo=${PROMPT}&options=1&run=0`, wait: 6000 },
  attach: { query: `lang=en&demo=${PROMPT}&attach=1&run=0`, wait: 4000 },
  progress: { query: `lang=en&demo=${PROMPT}`, wait: 3000 },
  progressEarly: { query: `lang=en&demo=${PROMPT}`, wait: 1500 },
  models: { query: 'lang=en&tab=models', wait: 6000 },
  rules: { query: 'lang=en&tab=rules', wait: 6000 },
  history: { query: 'lang=en&tab=history', wait: 6000 },
  // An entry opened to read its enhanced prompt in place.
  historyOpen: { query: 'lang=en&tab=history&entry=h1', wait: 6000 },
  // The Settings section with auto-enhance on (rules), as most of the listing's readers will use it.
  settings: { query: 'lang=en&tab=privacy&set=autoEnhanceMode:rules', wait: 6000 },
  vi: { query: `lang=vi&demo=${VI}`, wait: 15000 },
  zh: { query: 'lang=zh&tab=history', wait: 6000 },
  // The first model fails and the next one answers: the result says which one it fell back after.
  fallbackDark: { query: `lang=en&theme=dark&fallback=1&demo=${PROMPT}`, wait: 15000 },
  // The Settings section with Read other agents' sessions on (2 agents, 120 lines) and the other switches that ask first.
  otherAgents: { query: 'lang=en&tab=privacy&set=allowOtherAgents:true,otherAgentsMax:2,otherAgentsLines:120,allowAgentActivity:true,allowAgentLaunch:true&consent=allowOtherAgents,allowAgentActivity,allowAgentLaunch', wait: 6000 },
  // A result with the open-in-Orca buttons in the context list and Start a new agent.
  newAgent: { query: `lang=en&demo=${PROMPT}&options=1&set=allowAgentLaunch:true&consent=allowAgentLaunch`, wait: 15000 }
}

const taken = new Map()
/** A picture of the panel in one state, taken the first time it is asked for: its file, height and marks. */
function picture(name, versioned = false) {
  const key = `${name}${versioned ? '-versioned' : ''}`
  let found = taken.get(key)
  if (!found) {
    const { query, wait } = states[name]
    // fresh: nothing the panel saved in an earlier shot (the shots share one browser profile).
    const url = `${SERVER}/?mock=1&fresh&width=380&edge=0${versioned ? '' : '&version=0'}&${query}`
    const measured = measure(url, wait)
    const file = join(work, `${key}.png`)
    // The whole panel, its last card's corners included.
    shoot(file, url, 800, measured.height + 40, wait)
    found = { ...measured, url: pathToFileURL(file).href, dark: query.includes('theme=dark') }
    taken.set(key, found)
    console.log('shot', key, measured.height)
  }
  return found
}

const asset = (path) => pathToFileURL(join(root, path)).href
/** How many times its size a card `height` px tall may be drawn to fit `room` px (at most `max`). */
const fit = (height, room, max) => Math.min(max, room / height)
/** One panel, or its rows `from`..`to` (in the panel's own px), as a framed card `scale` times its size. */
const card = (shot, scale, from = 0, to = shot.height) =>
  `<div class="panel${shot.dark ? ' dark' : ''}" style="width:${380 * scale}px;height:${(to - from) * scale}px"><img src="${shot.url}" style="width:${800 * scale}px;margin-top:${-from * scale}px"></div>`
/** A part of a panel alone (`box`: left, top, right, bottom in the panel's own px), on a card of its own with `AIR` px around it. */
const AIR = 14
const excerpt = (shot, scale, [left, top, right, bottom]) =>
  `<div class="panel" style="padding:${AIR * scale}px"><div style="overflow:hidden;width:${(right - left) * scale}px;height:${(bottom - top) * scale}px"><img src="${shot.url}" style="width:${800 * scale}px;margin:${-top * scale}px 0 0 ${-left * scale}px"></div></div>`

const css = (width, height) => `
  * { box-sizing: border-box; margin: 0; }
  body { width: ${width}px; height: ${height}px; overflow: hidden; font-family: "Segoe UI", system-ui, sans-serif; color: #0a0a0a; background: #f5f5f4; position: relative; }
  .art { position: absolute; left: 20px; bottom: 10px; width: 960px; height: 320px; background: url("${asset('assets/art/cover-art.jpg')}") center / contain no-repeat; }
  .side-art { position: absolute; right: -260px; bottom: -40px; width: 1100px; height: 367px; background: url("${asset('assets/art/cover-art.jpg')}") center / cover no-repeat; opacity: 0.55; }
  .brand { position: absolute; left: 96px; top: 84px; display: flex; align-items: center; gap: 16px; font-size: 26px; font-weight: 600; letter-spacing: -0.01em; }
  .brand img { width: 56px; height: 56px; }
  .brand span { color: #78716c; font-weight: 400; }
  h1 { position: absolute; left: 96px; top: 200px; font-size: 72px; line-height: 1.05; font-weight: 700; letter-spacing: -0.03em; }
  .lead { position: absolute; left: 96px; top: 380px; width: 640px; font-size: 24px; line-height: 1.45; color: #44403c; }
  .chips { position: absolute; left: 96px; top: 500px; display: flex; gap: 10px; flex-wrap: wrap; width: 700px; }
  .chip { border: 1px solid #d6d3d1; background: #ffffff; border-radius: 999px; padding: 8px 16px; font-size: 18px; color: #292524; }
  .panel { overflow: hidden; border-radius: 16px; border: 1px solid #d6d3d1; background: #fff; box-shadow: 0 24px 60px rgba(0,0,0,0.12); flex: none; }
  .panel.dark { border-color: #262626; background: #0a0a0a; }
  .panel img { display: block; }
  .stage { position: absolute; display: flex; gap: 48px; align-items: flex-start; }
  .center { left: 50%; transform: translateX(-50%); }
  .middle { top: 50%; transform: translate(-50%, -50%); }
  .caption { position: absolute; left: 96px; top: ${CAPTION_TOP}px; width: ${width - 192}px; }
  .caption h2 { font-size: 50px; line-height: 55px; font-weight: 700; letter-spacing: -0.02em; }
  .caption p { margin-top: 10px; font-size: 22px; line-height: 32px; color: #57534e; white-space: nowrap; }
`
const page = (body, width = 1600, height = 1000) => `<!doctype html><html><head><meta charset="utf-8"><style>${css(width, height)}</style></head><body>${body}</body></html>`

// A listing screenshot: a title and one line under it, then the panels as large as the rest allows.
const CAPTION_TOP = 56
const STAGE_TOP = CAPTION_TOP + 55 + 10 + 32 + 28
const STAGE_ROOM = 1000 - STAGE_TOP - 40
const listing = (title, text, cards) => page(`<div class="side-art"></div><div class="caption"><h2>${title}</h2><p>${text}</p></div><div class="stage center" style="top:${STAGE_TOP}px">${cards}</div>`)
/** Whole panels side by side, as large as the tallest allows. */
const whole = (names, max = 1.3) => {
  const shots = names.map((name) => picture(name))
  const scale = fit(Math.max(...shots.map((shot) => shot.height)), STAGE_ROOM, max)
  return shots.map((shot) => card(shot, scale)).join('')
}

/** A README feature: its cards alone, centred on the art (the README's text sits next to it). */
const FEATURE = [1200, 1000]
const FEATURE_ROOM = 900
const feature = (cards) => page(`<div class="side-art"></div><div class="stage center middle">${cards}</div>`, ...FEATURE)
/** One whole panel, as large as fits. */
const alone = (name) => {
  const shot = picture(name)
  return card(shot, fit(shot.height, FEATURE_ROOM, 1.9))
}

// Each picture is drawn only when it is asked for (LISTING_ONLY), and so are the shots it needs.
const pages = {
  'assets/cover.jpg': () => {
    const shot = picture('result')
    return page(`<div class="art"></div>
    <div class="brand"><img src="${asset('assets/icon.png')}" alt="">Enhance Prompt <span>for Orca</span></div>
    <h1>Rough idea in.<br>Precise prompt out.</h1>
    <p class="lead">Turns a quick note into a project-aware prompt for Claude Code, Codex, Gemini and other agents, then sends it to the terminal.</p>
    <div class="chips"><span class="chip">Your subscription or API key</span><span class="chip">Project context</span><span class="chip">Files and screenshots</span><span class="chip">EN · VI · 中文</span></div>
    <div class="stage" style="right:96px;top:72px">${card(shot, fit(shot.height, 856, 1.4))}</div>`)
  },
  'assets/screenshots/1-enhance.jpg': () =>
    listing('Grounded in your project', 'Rules, stack, git changes and the code that matters are read for you. Untick whatever you would rather not send.', whole(['options', 'result'])),
  'assets/screenshots/2-models.jpg': () =>
    listing('Your models, with fallback', 'Your Claude Code or Codex subscription, or any API key. When one model fails, the next one answers.', whole(['models', 'fallbackDark'])),
  'assets/screenshots/3-rules.jpg': () => {
    // The Settings section is long: it runs off the bottom of the picture.
    const [rules, settings] = [picture('rules'), picture('settings')]
    const scale = fit(rules.height, STAGE_ROOM, 1.3)
    return listing('Your rules, your switches', 'A rule for one project or for all of them, and a switch for everything the plugin may read or do.', `${card(rules, scale)}${card(settings, scale)}`)
  },
  'assets/screenshots/4-languages.jpg': () =>
    listing('English, Tiếng Việt and 中文', 'The panel follows Orca\u2019s language or yours; the prompt is written in the language your agent works best in.', whole(['vi', 'zh'])),
  'docs/assets/readme-features/enhance-and-send.jpg': () => feature(alone('result')),
  'docs/assets/readme-features/project-context.jpg': () => {
    // The options alone: the levels and every item of context, large enough to read.
    const shot = picture('options')
    if (!shot.options) throw new Error('The options were not open in the "options" shot')
    const [, top, , bottom] = shot.options
    return feature(excerpt(shot, fit(bottom - top + 2 * AIR, FEATURE_ROOM, 1.9), shot.options))
  },
  'docs/assets/readme-features/subscription.jpg': () => feature(alone('models')),
  'docs/assets/readme-features/models-fallback.jpg': () => feature(alone('fallbackDark')),
  'docs/assets/readme-features/languages.jpg': () => {
    const [vi, zh] = [picture('vi'), picture('zh')]
    // Two panels and the gap between them, inside the picture's width.
    const scale = Math.min(fit(Math.max(vi.height, zh.height), FEATURE_ROOM, 1.9), (FEATURE[0] - 2 * 40 - 48) / (2 * 380))
    return feature(`${card(vi, scale)}${card(zh, scale)}`)
  },
  'docs/assets/readme-features/history.jpg': () => feature(alone('history'))
}
/** User guide pictures: one panel on a plain background, as the guide shows it. */
const guide = {
  'docs/assets/guide/1-enhance-and-send.png': 'result',
  'docs/assets/guide/2-attach-files.png': 'attach',
  'docs/assets/guide/3-progress.png': 'progress',
  'docs/assets/guide/4-progress-early.png': 'progressEarly',
  'docs/assets/guide/6-rules-and-structures.png': 'rules',
  'docs/assets/guide/7-models.png': 'models',
  'docs/assets/guide/8-history.png': 'historyOpen',
  'docs/assets/guide/9-other-agents-settings.png': 'otherAgents',
  'docs/assets/guide/11-new-agent.png': 'newAgent'
}
/** What Orca's catalog takes: a cover up to 1024 KB, a screenshot up to 1536 KB. */
const LIMITS = [
  ['assets/cover.jpg', 1024],
  ['assets/screenshots/', 1536]
]

const render = (html, width, height, out) => {
  const htmlFile = join(work, `page-${Math.random().toString(36).slice(2)}.html`)
  writeFileSync(htmlFile, html)
  mkdirSync(dirname(out), { recursive: true })
  shoot(out, pathToFileURL(htmlFile).href, width, height, 3000, 1)
}
/** Cuts a 2x picture to the `width` x `height` (in its own px) at its top left. */
const cut = (png, out, width, height) =>
  execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Drawing; $i=[Drawing.Image]::FromFile('${png}'); $b=New-Object Drawing.Bitmap ${width},${height}; $g=[Drawing.Graphics]::FromImage($b); $g.DrawImage($i,0,0); $b.Save('${out}'); $i.Dispose()`], { stdio: 'inherit' })

for (const [path, draw] of Object.entries(pages)) {
  if (!wanted(path)) continue
  const [width, height] = path.includes('readme-features') ? FEATURE : [1600, 1000]
  const png = join(work, 'page.png')
  render(draw(), width, height, png)
  execFileSync('powershell', ['-NoProfile', '-File', join(root, 'scripts/to-jpg.ps1'), png, join(root, path), '88'], { stdio: 'inherit' })
  const bytes = readFileSync(join(root, path)).length
  const limit = LIMITS.find(([prefix]) => path.startsWith(prefix))?.[1]
  if (limit && bytes > limit * 1024) throw new Error(`${path} is ${Math.round(bytes / 1024)} KB: the catalog takes at most ${limit} KB`)
  console.log(path, bytes)
}

/**
 * A guide picture: the left `width` x `height` px of a shot (`across` px wide), on a plain
 * background with a 24 px margin, at 2x: sharp on any screen, shown at half size.
 */
function framed(shotUrl, across, width, height, out) {
  const html = `<!doctype html><html><head><style>* { margin: 0 } body { width: ${width + 48}px; height: ${height + 48}px; background: #f5f5f4; } .panel { margin: 24px; width: ${width}px; height: ${height}px; overflow: hidden; border-radius: 12px; border: 1px solid #d6d3d1; background: #fff; } img { display: block; width: ${across}px }</style></head><body><div class="panel"><img src="${shotUrl}"></div></body></html>`
  const htmlFile = join(work, 'guide.html')
  writeFileSync(htmlFile, html)
  const png = join(work, 'guide.png')
  shoot(png, pathToFileURL(htmlFile).href, Math.max(800, width + 48), height + 48, 3000, 2)
  // Cut the window's extra width away.
  cut(png, out, (width + 48) * 2, (height + 48) * 2)
}

// The confirmation dialog, over the Settings section. A dialog is centred in its window, so this
// one is the whole window: 500 px, a wide sidebar, the narrowest a headless window lays out.
const DIALOG = 'docs/assets/guide/10-confirm-dialog.png'
if (wanted(DIALOG)) {
  const [width, height] = [500, 760]
  const shot = join(work, 'dialog.png')
  shoot(shot, `${SERVER}/?mock=1&fresh&lang=en&tab=privacy&ask=allowAgentActivity`, width, height, 6000)
  framed(pathToFileURL(shot).href, width, width, height, join(root, DIALOG))
  console.log(DIALOG)
}

for (const [path, name] of Object.entries(guide)) {
  if (!wanted(path)) continue
  const shot = picture(name, true)
  framed(shot.url, 800, 380, shot.height, join(root, path))
  console.log(path)
}
rmSync(work, { recursive: true, force: true })
rmSync(browserProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
