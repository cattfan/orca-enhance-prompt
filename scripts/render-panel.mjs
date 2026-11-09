// Renders a components-panel tree (from `orca plugin check --json`) to static HTML that follows
// Orca's look (checked against a real `orca plugin shot`). Used only for listing images.
const esc = (value) =>
  String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Lucide-style 24px stroke icons.
const ICONS = {
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3 3 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  agent: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  delete: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  add: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/>',
  collapse: '<path d="m18 15-6-6-6 6"/>',
  expand: '<path d="m6 9 6 6 6-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  warning: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
  stop: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.8-1.6l9.9-10.2a.5.5 0 0 1 .9.5l-1.9 6A1 1 0 0 0 13 10h7a1 1 0 0 1 .8 1.6l-9.9 10.2a.5.5 0 0 1-.9-.5l1.9-6A1 1 0 0 0 11 14z"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>'
}
export const icon = (name, size = 16) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ICONS.check}</svg>`

export const PANEL_CSS = `
.panel{--bg:#fff;--fg:#18181b;--muted:#71717a;--border:#e4e4e7;--accent-bg:#f4f4f5;--primary:#18181b;--warn:#c2410c;--ok:#15803d;--okbg:#f0fdf4;--warnbg:#fff7ed;--danger:#dc2626;
  background:var(--bg);color:var(--fg);font:13px/1.45 Inter,"Segoe UI",system-ui,sans-serif;padding:12px;box-sizing:border-box;width:420px;-webkit-font-smoothing:antialiased}
.panel.dark{--bg:#1a1a1a;--fg:#ececec;--muted:#9a9a9a;--border:#333333;--accent-bg:#262626;--primary:#f2f2f2;--warn:#fb923c;--ok:#4ade80;--okbg:#0f2a1a;--warnbg:#3a2210;--danger:#f87171}
.panel *{box-sizing:border-box}
.col{display:flex;flex-direction:column;width:100%}.row{display:flex;flex-direction:row;align-items:center}.wrap{flex-wrap:wrap}
.g-none{gap:0}.g-xs{gap:6px}.g-sm{gap:8px}.g-md{gap:12px}.g-lg{gap:16px}
.j-between{justify-content:space-between}.j-end{justify-content:flex-end}
.t{margin:0}.t-xs{font-size:11px}.t-sm{font-size:12px}.muted{color:var(--muted)}.w-medium{font-weight:500}.w-semibold{font-weight:600}
.tone-warning{color:var(--warn)}.tone-success{color:var(--ok)}.tone-danger{color:var(--danger)}
.trunc{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.badge{display:inline-flex;align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;background:var(--accent-bg);border:1px solid var(--border)}
.badge.tone-accent{background:#e4e4e7;color:#18181b;border-color:#e4e4e7}.dark .badge.tone-accent{background:#ececec;color:#111;border-color:#ececec}
.badge.tone-success{background:var(--okbg);color:var(--ok);border-color:transparent}.badge.tone-warning{background:var(--warnbg);color:var(--warn);border-color:transparent}
.sel{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px;background:var(--bg);white-space:nowrap}
.sel .ic{opacity:.6}
.field-label{font-weight:600;font-size:13px;margin-bottom:6px}
.ta,.inp{border:1px solid var(--border);border-radius:8px;padding:10px 12px;white-space:pre-wrap;font:inherit;background:var(--bg);overflow:hidden}
.ta.ph,.inp.ph{color:var(--muted)}
.btn{display:inline-flex;align-items:center;gap:6px;border-radius:8px;padding:6px 12px;font-weight:600;font-size:13px;border:1px solid var(--border);background:var(--bg);white-space:nowrap}
.btn.solid{background:var(--primary);color:var(--bg);border-color:var(--primary)}.btn.ghost{border-color:transparent;background:transparent}
.btn.sm{padding:4px 10px;font-size:12px}.btn.tone-danger{color:var(--danger)}
.ibtn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px}.ibtn.sm{width:26px;height:26px}.ibtn.tone-danger{color:var(--danger)}.ibtn.outline{border:1px solid var(--border);background:var(--accent-bg)}
.tabs{display:flex;gap:16px;border-bottom:1px solid var(--border);margin-bottom:12px}
.tab{display:flex;align-items:center;gap:6px;padding:6px 2px 9px;color:var(--muted);font-weight:500}.tab.on{color:var(--fg);border-bottom:2px solid var(--fg);margin-bottom:-1px}
.callout{border:1px solid var(--border);border-radius:10px;padding:10px 12px}
.callout.tone-success{background:var(--okbg);border-color:transparent}.callout.tone-warning{background:var(--warnbg);border-color:transparent}.callout.tone-accent{background:var(--accent-bg);border-color:transparent}
.callout-title{font-weight:600;margin-bottom:4px;display:flex;gap:6px;align-items:center}
.coll-head{display:flex;gap:8px;align-items:flex-start}.coll-head .ic{margin-top:2px}
.cb{display:flex;gap:8px;align-items:flex-start}.cb .box{width:16px;height:16px;border-radius:4px;border:1px solid var(--border);flex:none;margin-top:1px;display:flex;align-items:center;justify-content:center}
.cb .box.on{background:var(--primary);border-color:var(--primary);color:var(--bg)}
.sw{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%}.sw .track{width:34px;height:20px;border-radius:999px;background:var(--border);position:relative;flex:none}
.sw .track::after{content:"";position:absolute;width:16px;height:16px;border-radius:50%;background:#fff;top:2px;left:2px}.sw .track.on{background:var(--primary)}.sw .track.on::after{left:16px;background:var(--bg)}
.empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:18px 8px;color:var(--muted)}.empty b{color:var(--fg)}
.box-border{border:1px solid var(--border)}.r-md{border-radius:10px}.r-lg{border-radius:14px}.h3{font-weight:600;font-size:14px}.sep{height:1px;background:var(--border);width:100%}.grid2{display:grid;grid-template-columns:1fr 1fr;width:100%}.grid2 .sel{width:100%;justify-content:space-between}.bg-muted{background:var(--accent-bg)}.p-sm{padding:8px 10px}.p-md{padding:12px}
.prog{height:6px;border-radius:999px;background:var(--accent-bg);overflow:hidden;width:100%}.prog>i{display:block;height:100%;background:#818cf8;border-radius:999px}
.tone-accent{color:#818cf8}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12px}
`

const cls = (...parts) => parts.filter(Boolean).join(' ')
const textOf = (children) =>
  (children ?? []).map((child) => (typeof child === 'string' || typeof child === 'number' ? esc(child) : node(child))).join('')

let options = { open: false }

function node(n) {
  if (n === null || n === undefined || n === false) return ''
  if (typeof n === 'string' || typeof n === 'number') return esc(n)
  if (Array.isArray(n)) return n.map(node).join('')
  const p = n.props ?? {}
  const kids = n.children ?? []
  const inner = () => kids.map(node).join('')
  switch (n.type) {
    case 'Box': {
      const dir = p.direction === 'row' ? 'row' : 'col'
      // A tone background is a flat tint of that tone.
      const TINT = { success: '#16a34a26', warning: '#f59e0b26', danger: '#ef444426', accent: '#6366f126', neutral: 'var(--accent-bg)' }
      const style = [p.border === 'accent' ? 'border-color:#6366f1' : p.border === 'danger' ? 'border-color:#ef4444' : '', TINT[p.background] ? `background:${TINT[p.background]}` : '', p.paddingX || p.paddingY ? `padding:${p.paddingY ? 4 : 0}px ${p.paddingX ? 10 : 0}px` : '', p.align === 'center' ? 'align-items:center' : ''].filter(Boolean).join(';')
      return `<div class="${cls(dir, `g-${p.gap ?? 'none'}`, p.justify && `j-${p.justify}`, p.wrap && 'wrap', p.border && 'box-border', p.radius && `r-${p.radius}`, p.background === 'muted' && 'bg-muted', p.padding && `p-${p.padding}`)}" style="${style}">${inner()}</div>`
    }
    case 'Stack':
      return `<div class="${cls('col', `g-${p.gap ?? 'sm'}`)}">${inner()}</div>`
    case 'Toolbar':
      return `<div class="${cls('row', `g-${p.gap ?? 'xs'}`, 'wrap')}">${inner()}</div>`
    case 'Row':
      return `<div class="${cls('row', `g-${p.gap ?? 'sm'}`, p.justify && `j-${p.justify}`, p.wrap && 'wrap')}">${inner()}</div>`
    case 'Heading':
      return `<div class="t h3">${textOf(kids)}</div>`
    case 'Separator':
      return '<div class="sep"></div>'
    case 'Grid':
      return `<div class="${cls('grid2', `g-${p.gap ?? 'sm'}`)}">${inner()}</div>`
    case 'Text':
      return `<div class="${cls('t', p.size && `t-${p.size}`, p.muted && 'muted', p.weight && `w-${p.weight}`, p.tone && `tone-${p.tone}`, p.truncate && 'trunc', n.type === 'Heading' && 'w-semibold')}">${textOf(kids)}</div>`
    case 'RelativeTime':
      return '<span>5m ago</span>'
    case 'Badge':
      return `<span class="${cls('badge', p.tone && `tone-${p.tone}`)}">${textOf(kids)}</span>`
    case 'Select': {
      const label = p.options?.find((o) => o.value === p.value)?.label ?? p.placeholder ?? ''
      const control = `<span class="sel">${esc(label)}${icon('chevron', 14)}</span>`
      return p.labelHidden ? control : `<div class="col"><div class="field-label">${esc(p.label)}</div><div>${control}</div></div>`
    }
    case 'Input':
    case 'Textarea': {
      const value = p.value ?? p.defaultValue ?? ''
      const body = value
        ? `<div class="${n.type === 'Textarea' ? 'ta' : 'inp'}" style="${n.type === 'Textarea' ? `height:${(p.rows ?? 3) * 19 + 22}px` : ''}">${esc(p.type === 'password' ? '••••••••' : value)}</div>`
        : `<div class="${n.type === 'Textarea' ? 'ta ph' : 'inp ph'}" style="${n.type === 'Textarea' ? `height:${(p.rows ?? 3) * 19 + 22}px` : ''}">${esc(p.placeholder ?? '')}</div>`
      return p.labelHidden ? body : `<div class="col"><div class="field-label">${esc(p.label)}</div>${body}</div>`
    }
    case 'Button':
      return `<span class="${cls('btn', p.variant ?? 'outline', p.size === 'sm' && 'sm', p.tone && `tone-${p.tone}`)}">${p.icon ? icon(p.icon, 15) : ''}${textOf(kids)}</span>`
    case 'IconButton':
      return `<span class="${cls('ibtn', p.size === 'sm' && 'sm', p.variant === 'outline' && 'outline', p.tone && `tone-${p.tone}`)}" title="${esc(p.label)}">${icon(p.icon, p.size === 'sm' ? 15 : 17)}</span>`
    case 'Progress':
      return `<div class="prog" title="${esc(p.label)}"><i style="width:${Math.max(0, Math.min(100, Number(p.value ?? 0)))}%"></i></div>`
    case 'Spinner':
      return `<span class="row g-xs muted"><svg class="ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>${p.labelHidden ? '' : esc(p.label)}</span>`
    case 'Tabs': {
      const tabs = kids.filter((k) => k?.type === 'Tab')
      const current = tabs.find((tab) => tab.props.value === p.value) ?? tabs[0]
      return `<div class="col"><div class="tabs">${tabs
        .map((tab) => `<span class="${cls('tab', tab === current && 'on')}">${tab.props.icon ? icon(tab.props.icon, 15) : ''}${esc(tab.props.label)}</span>`)
        .join('')}</div>${current ? (current.children ?? []).map(node).join('') : ''}</div>`
    }
    case 'Callout':
      return `<div class="${cls('callout', p.tone && `tone-${p.tone}`)}">${p.title ? `<div class="callout-title">${p.icon ? icon(p.icon, 15) : ''}${esc(p.title)}</div>` : ''}${inner()}</div>`
    case 'Collapsible': {
      const isOpen = options.open instanceof RegExp ? options.open.test(p.title ?? '') : options.open
      return `<div class="col g-sm"><div class="coll-head">${icon(isOpen ? 'chevron' : 'right', 15)}<div><div class="w-semibold">${esc(p.title)}</div>${p.description ? `<div class="t-xs muted">${esc(p.description)}</div>` : ''}</div></div>${isOpen ? `<div style="padding-left:22px">${inner()}</div>` : ''}</div>`
    }
    case 'Checkbox':
      return `<div class="cb"><span class="${cls('box', p.checked !== false && 'on')}">${p.checked !== false ? icon('check', 12) : ''}</span><div><div>${esc(p.label)}</div>${p.description ? `<div class="t-xs muted">${esc(p.description)}</div>` : ''}</div></div>`
    case 'Switch':
      return `<div class="sw"><span class="w-semibold">${esc(p.label)}</span><span class="${cls('track', p.checked && 'on')}"></span></div>`
    case 'EmptyState':
      return `<div class="empty">${p.icon ? icon(p.icon, 22) : ''}<b>${esc(p.title)}</b><div class="t-sm">${esc(p.description ?? '')}</div>${inner()}</div>`
    case 'Field':
      return `<div class="col g-xs"><div class="field-label" style="margin:0">${esc(p.label)}</div>${inner()}${p.description ? `<div class="t-xs muted">${esc(p.description)}</div>` : ''}</div>`
    case 'KeyValue':
      return `<div class="kv">${(p.items ?? []).map((item) => `<span class="muted">${esc(item.label)}</span><span>${esc(item.value)}</span>`).join('')}</div>`
    default:
      return inner()
  }
}

export function renderPanel(tree, { dark = false, open = false, width = 420 } = {}) {
  options = { open }
  return `<div class="${cls('panel', dark && 'dark')}" style="width:${width}px">${node(tree)}</div>`
}
