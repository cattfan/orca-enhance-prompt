// Live preview of the panel on localhost, for tweaking the UI.
//   node scripts/dev-server.mjs        (PORT=5173 by default)
// It runs `orca plugin check --json` (the panel's real component trees for every scenario in
// src/panel.check.ts, with sample data), draws them with scripts/render-panel.mjs, and redraws
// whenever a file under src/ changes. Nothing here talks to Orca's window or your real data.
import { execFile } from 'node:child_process'
import { readFileSync, watch } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const port = Number(process.env.PORT) || 5173
let state = { building: true, at: 0, ms: 0, error: null, scenarios: [] }
const clients = new Set()

function broadcast() {
  const data = `data: ${JSON.stringify({ building: state.building, at: state.at })}\n\n`
  for (const res of clients) res.write(data)
}

let running = false
let again = false
function build() {
  if (running) {
    again = true
    return
  }
  running = true
  state.building = true
  broadcast()
  const started = Date.now()
  execFile(
    'orca',
    ['plugin', 'check', '.', '--json'],
    { cwd: root, maxBuffer: 128 * 1024 * 1024, shell: process.platform === 'win32', windowsHide: true },
    (error, stdout) => {
      try {
        const parsed = JSON.parse(stdout)
        const result = parsed.result ?? parsed
        state = {
          building: false,
          at: Date.now(),
          ms: Date.now() - started,
          error: result.valid === false ? JSON.stringify(result.errors ?? []) : null,
          scenarios: (result.panels ?? []).map((panel) => ({
            name: panel.scenario ?? 'default',
            tree: panel.tree ?? null,
            issues: (panel.issues ?? []).map((issue) => issue.message ?? String(issue)),
            warnings: panel.warnings ?? []
          }))
        }
      } catch {
        state = { ...state, building: false, at: Date.now(), error: (error?.message ?? 'orca plugin check failed') + '\n' + String(stdout).slice(0, 2000) }
      }
      running = false
      console.log(`${new Date().toLocaleTimeString()} built ${state.scenarios.length} scenarios in ${state.ms} ms${state.error ? ' (with errors)' : ''}`)
      broadcast()
      if (again) {
        again = false
        build()
      }
    }
  )
}

let timer = null
watch(join(root, 'src'), { recursive: true }, (_event, file) => {
  if (!file || /\.test\.tsx?$/.test(file)) return
  clearTimeout(timer)
  timer = setTimeout(build, 250)
})

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Enhance Prompt · preview</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;font:13px/1.4 Inter,"Segoe UI",system-ui,sans-serif;background:#0d0e14;color:#e5e7eb}
  header{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding:10px 16px;background:#14151d;border-bottom:1px solid #26283a}
  header b{font-size:14px}
  header label{display:flex;gap:6px;align-items:center;color:#a1a1aa}
  select,input[type=range]{accent-color:#818cf8}
  select{background:#1c1d28;color:#e5e7eb;border:1px solid #2e3044;border-radius:6px;padding:4px 6px}
  #status{margin-left:auto;font-variant-numeric:tabular-nums;color:#a1a1aa}
  #status.busy{color:#fbbf24}#status.err{color:#f87171}
  main{display:flex;flex-wrap:wrap;gap:24px;padding:20px 16px;align-items:flex-start}
  .card{display:flex;flex-direction:column;gap:6px}
  .card h2{margin:0;font-size:12px;font-weight:600;color:#a1a1aa}
  .frame{border-radius:12px;overflow:hidden;box-shadow:0 0 0 1px #2a2c3d,0 12px 30px #0008}
  .msgs{max-width:420px;font-size:11px}.msgs .w{color:#fbbf24}.msgs .e{color:#f87171}
  pre.error{white-space:pre-wrap;color:#f87171;padding:16px;margin:0}
</style>
<style id="panel-css"></style>
</head><body>
<header>
  <b>Enhance Prompt · live preview</b>
  <label>Scenario <select id="scenario"></select></label>
  <label>Theme <select id="theme"><option value="dark">Dark</option><option value="light">Light</option></select></label>
  <label>Width <input id="width" type="range" min="300" max="640" value="420"><span id="wv">420</span></label>
  <label><input id="open" type="checkbox"> Open folds</label>
  <span id="status">building…</span>
</header>
<main id="out"></main>
<script type="module">
  import { renderPanel, PANEL_CSS } from '/render-panel.mjs'
  document.getElementById('panel-css').textContent = PANEL_CSS
  const $ = (id) => document.getElementById(id)
  const prefs = JSON.parse(localStorage.getItem('prefs') || '{}')
  for (const key of ['theme', 'width']) if (prefs[key]) $(key).value = prefs[key]
  $('open').checked = !!prefs.open
  let data = null
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
  function draw() {
    if (!data) return
    localStorage.setItem('prefs', JSON.stringify({ theme: $('theme').value, width: $('width').value, open: $('open').checked, scenario: $('scenario').value }))
    $('wv').textContent = $('width').value
    if (data.error) { $('out').innerHTML = '<pre class="error">' + esc(data.error) + '</pre>'; return }
    const pick = $('scenario').value
    const list = data.scenarios.filter((s) => !s.name.endsWith('-dark') && (pick === '*' || s.name === pick))
    const dark = $('theme').value === 'dark'
    const width = Number($('width').value)
    $('out').innerHTML = list.map((s) => {
      const msgs = [...s.issues.map((m) => '<div class="e">✖ ' + esc(m) + '</div>'), ...s.warnings.map((m) => '<div class="w">⚠ ' + esc(m) + '</div>')].join('')
      const body = s.tree ? renderPanel(s.tree, { dark, open: $('open').checked, width }) : '<pre class="error">no tree</pre>'
      return '<section class="card"><h2>' + esc(s.name) + '</h2><div class="frame">' + body + '</div><div class="msgs">' + msgs + '</div></section>'
    }).join('')
  }
  async function load() {
    data = await (await fetch('/api/state')).json()
    const sel = $('scenario'), current = sel.value || prefs.scenario || '*'
    sel.innerHTML = '<option value="*">All</option>' + data.scenarios.filter((s) => !s.name.endsWith('-dark')).map((s) => '<option>' + esc(s.name) + '</option>').join('')
    sel.value = [...sel.options].some((o) => o.value === current) ? current : '*'
    const st = $('status')
    st.className = data.error ? 'err' : ''
    st.textContent = data.error ? 'check failed' : 'updated ' + new Date(data.at).toLocaleTimeString() + ' · ' + data.ms + ' ms'
    draw()
  }
  for (const id of ['scenario', 'theme', 'width', 'open']) $(id).addEventListener('input', draw)
  // ?static: no live connection, so a headless browser can take a screenshot.
  if (!new URLSearchParams(location.search).has('static')) {
    const events = new EventSource('/events')
    events.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.building) { $('status').className = 'busy'; $('status').textContent = 'rebuilding…' }
      else load()
    }
  }
  load()
</script>
</body></html>`

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PAGE)
  } else if (url.pathname === '/render-panel.mjs') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    res.end(readFileSync(join(root, 'scripts/render-panel.mjs'), 'utf8'))
  } else if (url.pathname === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(state))
  } else if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(`data: ${JSON.stringify({ building: state.building, at: state.at })}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
  } else {
    res.writeHead(404)
    res.end()
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Enhance Prompt preview: http://localhost:${port}`)
  build()
})
