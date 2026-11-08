// `orca plugin check` renders the panel once per scenario; the `shot-*` ones also feed
// `orca plugin shot . --scenario <name>` for the listing screenshots (scripts/screenshots.mjs).
import { defineCheck } from 'orca/testing'
import { PRESETS, type ProfileView } from './presets'

const base: ProfileView = {
  id: 'claude-code',
  name: 'Claude Code',
  preset: 'claude-code',
  provider: 'cli',
  baseUrl: '',
  model: 'haiku',
  temperature: 0.3,
  maxTokens: 2000,
  enabled: true,
  command: '',
  args: '',
  keySource: 'subscription',
  envName: ''
}
const gpt: ProfileView = { ...base, id: 'gpt', name: 'OpenAI', preset: 'openai', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keySource: 'secret', envName: 'OPENAI_API_KEY' }
const groq: ProfileView = { ...base, id: 'groq', name: 'Groq', preset: 'groq', provider: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keySource: 'env', envName: 'GROQ_API_KEY' }
const ollama: ProfileView = { ...base, id: 'ollama', name: 'Ollama', preset: 'ollama', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder', keySource: 'not-needed', envName: '', enabled: false }

const models = (profiles: ProfileView[], hookProfileId: string | null = null) => ({
  profiles,
  hookProfileId,
  selectorProfileId: null,
  fromEnv: false,
  presets: PRESETS
})
const agents = { targets: [{ terminalId: 't1', label: 'Claude Code · waiting', agent: 'claude' }, { terminalId: 't2', label: 'Codex · done', agent: 'codex' }] }
const detect = (added: boolean) => ({
  found: [
    { preset: 'claude-code', label: 'Claude Code (subscription)', path: 'claude', added },
    { preset: 'codex', label: 'Codex CLI (ChatGPT subscription)', path: 'codex', added: false }
  ]
})

const enhancedEn = `Fix the mobile layout of the login page.

Context:
- Likely relevant: src/auth/LoginForm.tsx, src/styles/auth.css (found by search)
- Stack: React + Vite, pnpm; follow AGENTS.md (no new dependencies)

Requirements:
1. The form fits 360px wide screens without horizontal scroll.
2. Inputs and the submit button keep at least 44px touch targets.
3. Desktop layout stays unchanged.

Done when: pnpm test and pnpm lint pass, and you report what changed.`

const enhancedVi = `Sửa bố cục trang đăng nhập trên mobile.

Ngữ cảnh:
- Có thể liên quan: src/auth/LoginForm.tsx, src/styles/auth.css (tìm thấy qua tìm kiếm)
- Stack: React + Vite, pnpm; tuân theo AGENTS.md (không thêm dependency)

Yêu cầu:
1. Form vừa màn hình rộng 360px, không cuộn ngang.
2. Ô nhập và nút gửi giữ vùng chạm tối thiểu 44px.
3. Giữ nguyên bố cục desktop.

Xong khi: pnpm test và pnpm lint đều pass, và báo lại những gì đã đổi.`

const context = [
  { id: 'workspace', kind: 'workspace', label: 'Workspace', chars: 22 },
  { id: 'agent', kind: 'agent', label: 'Target agent', chars: 14 },
  { id: 'rules:AGENTS.md', kind: 'rules', label: 'AGENTS.md', chars: 1840 },
  { id: 'stack', kind: 'stack', label: 'Stack & commands', chars: 960 },
  { id: 'file:src/auth/LoginForm.tsx', kind: 'file', label: 'src/auth/LoginForm.tsx', chars: 1380, note: 'keyword match' },
  { id: 'file:src/styles/auth.css', kind: 'file', label: 'src/styles/auth.css', chars: 1120, note: 'keyword match' },
  { id: 'git:status', kind: 'git', label: 'Git status (2 changed)', chars: 64 },
  { id: 'tree', kind: 'tree', label: 'Repository tree (412 files)', chars: 1690 }
]
const lastRun = {
  model: 'haiku',
  profileName: 'Claude Code',
  ms: 8400,
  attempts: [
    { profileId: 'gpt', name: 'OpenAI', model: 'gpt-4.1-mini', ok: false, error: '429: rate limit', ms: 300 },
    { profileId: 'claude-code', name: 'Claude Code', model: 'haiku', ok: true, ms: 8100 }
  ]
}
const now = 1767225600000
const history = [
  { id: 'a', at: now - 5 * 60_000, original: 'login page is broken on mobile', enhanced: enhancedEn, style: 'bugfix', model: 'haiku', source: 'panel' },
  { id: 'b', at: now - 50 * 60_000, original: 'add dark mode toggle to settings', enhanced: 'Add a dark mode toggle…', style: 'feature', model: 'gpt-4.1-mini', source: 'panel' },
  { id: 'c', at: now - 3 * 3600_000, original: 'refactor the api client into hooks', enhanced: 'Refactor…', style: 'refactor', model: 'gpt-4.1-mini', source: 'panel' },
  { id: 'd', at: now - 26 * 3600_000, original: 'implement issue #42: export to CSV', enhanced: 'Implement…', style: 'balanced', model: 'llama-3.3-70b-versatile', source: 'hook' },
  { id: 'e', at: now - 50 * 3600_000, original: 'review my changes before the PR', enhanced: 'Review…', style: 'review', model: 'haiku', source: 'panel' }
]

/** Sample live model lists, as `models.catalog` answers them. */
function catalogFor(preset: string) {
  const lists: Record<string, string[]> = {
    'claude-code': ['haiku', 'sonnet', 'opus', 'fable', 'default'],
    openai: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-5-mini', 'o4-mini'],
    groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen-2.5-coder-32b'],
    ollama: ['qwen2.5-coder', 'llama3.2', 'deepseek-r1']
  }
  return { models: (lists[preset] ?? []).map((id) => ({ id, label: id })), source: 'sample', fetchedAt: now }
}

const enhanceScenario = (lang: 'en' | 'vi') => ({
  settings: { uiLanguage: lang },
  requests: { 'models.get': models([base, gpt, groq]), 'targets.list': agents, 'models.detect': detect(true) },
  persisted: {
    plugin: {
      tab: 'enhance',
      draft: lang === 'vi' ? 'trang login bị vỡ layout trên mobile' : 'login page is broken on mobile',
      result: lang === 'vi' ? enhancedVi : enhancedEn,
      style: 'bugfix',
      level: 'deep',
      lastRun,
      contextShown: context
    }
  }
})

const scenarios = {
  'no model': { requests: { 'models.get': models([]), 'targets.list': { targets: [] }, 'models.detect': detect(false) } },
  ready: {
    requests: { 'models.get': models([gpt]), 'targets.list': agents, 'models.detect': detect(false) },
    persisted: { plugin: { draft: 'login page is broken on mobile', result: enhancedEn } }
  },
  history: {
    requests: { 'models.get': models([gpt]), 'targets.list': { targets: [] }, 'models.detect': detect(false) },
    storage: { history }
  },
  'shot-enhance': enhanceScenario('en'),
  'shot-enhance-vi': enhanceScenario('vi'),
  'shot-models': {
    settings: { uiLanguage: 'en', autoEnhanceMode: 'ai' },
    requests: {
      'models.get': models([base, gpt, groq, ollama], 'groq'),
      'targets.list': agents,
      'models.detect': detect(true),
      'models.catalog': ({ preset }: { preset: string }) => catalogFor(preset)
    },
    persisted: { plugin: { tab: 'models' } }
  },
  'shot-history': {
    settings: { uiLanguage: 'en' },
    requests: { 'models.get': models([base, gpt]), 'targets.list': agents, 'models.detect': detect(true) },
    storage: { history },
    persisted: { plugin: { tab: 'history' } }
  },
  'shot-models-new': {
    settings: { uiLanguage: 'en' },
    requests: { 'models.get': models([]), 'targets.list': agents, 'models.detect': detect(false) },
    persisted: { plugin: { tab: 'models' } }
  },
  'shot-history-zh': {
    settings: { uiLanguage: 'zh' },
    requests: { 'models.get': models([base, gpt]), 'targets.list': agents, 'models.detect': detect(true) },
    storage: { history },
    persisted: { plugin: { tab: 'history' } }
  }
}

// Each shot-* scenario again in the dark theme, for screenshots that follow Orca's theme.
const dark = Object.fromEntries(
  Object.entries(scenarios)
    .filter(([name]) => name.startsWith('shot-'))
    .map(([name, scenario]) => [`${name}-dark`, { ...scenario, theme: 'dark' as const }])
)

export default defineCheck({ ...scenarios, ...dark })
