// The web panel's entry: wires Orca's events to the shared state (as src/panel.tsx's setup does), then
// draws the header and the current section.
import { lazy, StrictMode, Suspense, useReducer } from 'react'
import { createRoot } from 'react-dom/client'
import { on, plugin, read, set, settings } from 'orca'
import { BookOpenIcon, BotIcon, LanguagesIcon, ScrollTextIcon, SettingsIcon, SparklesIcon } from 'lucide-react'
import './index.css'
import { t, UI_LANGUAGES, uiLanguageSetting } from '../../src/i18n.ts'
import { UI_LANGUAGE_LABELS } from '../../src/panel/view.ts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BRAND } from '../../src/brand.ts'
import { draft, files, history, notice, optionsOpen, put, restoreSaved, tab } from '../../src/panel/state.ts'
import { previews } from './attach'
import {
  applyProgress,
  cancel,
  changeUiLanguage,
  detectClis,
  enhanceNow,
  learnTerminals,
  refreshDataSummary,
  refreshDefaults,
  refreshModels,
  refreshRules,
  refreshTargets,
  stopTicking,
  workspaceRemoved
} from '../../src/panel/actions.ts'
import { TooltipProvider } from '@/components/ui/tooltip'
import { IconAction, Notices } from './common'
import { WhatsNew } from './whats-new'
import logo from '../../assets/art/logo-64.png'
import { ready, useOrca } from './orca-runtime'
import { EnhanceSection } from './enhance'

// The Enhance section is drawn at once; the others load the first time they open (a smaller first load).
const loadSections = () => import('./sections')
const HistorySection = lazy(() => loadSections().then((module) => ({ default: module.HistorySection })))
const ModelsSection = lazy(() => loadSections().then((module) => ({ default: module.ModelsSection })))
const RulesSection = lazy(() => loadSections().then((module) => ({ default: module.RulesSection })))
const SettingsSection = lazy(() => loadSections().then((module) => ({ default: module.SettingsSection })))

const SECTIONS = [
  { value: 'enhance', label: 'Enhance', Icon: SparklesIcon },
  { value: 'history', label: 'History', Icon: BookOpenIcon },
  { value: 'models', label: 'Models', Icon: BotIcon },
  { value: 'rules', label: 'Rules', Icon: ScrollTextIcon },
  { value: 'privacy', label: 'Privacy', Icon: SettingsIcon }
] as const

/** The panel language, at the top left (Auto follows Orca). */
function LanguagePicker() {
  return (
    <Select value={read(uiLanguageSetting)} onValueChange={(value) => void changeUiLanguage(value)}>
      <SelectTrigger
        size="sm"
        aria-label={t('Panel language')}
        className="h-7 w-auto gap-1 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:bg-accent dark:bg-transparent"
      >
        <LanguagesIcon className="size-3.5" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {UI_LANGUAGES.map((value) => (
          <SelectItem key={value} value={value}>
            {value === 'auto' ? t('Auto') : UI_LANGUAGE_LABELS[value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function openSection(value: string): void {
  set(tab, value)
  if (value === 'privacy') void refreshDataSummary()
}

function App() {
  useOrca()
  // Uploads keep their own list outside the atoms; this redraws when it changes.
  const [, refresh] = useReducer((count: number) => count + 1, 0)
  const current = SECTIONS.find((section) => section.value === read(tab)) ?? SECTIONS[0]
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-screen flex-col gap-3 p-3">
        <header className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <img src={logo} alt="" className="size-5 shrink-0 dark:invert" />
            {/* The app's name stays; the highlighted icon says which section is open. */}
            <h1 className="truncate text-sm font-semibold">{BRAND}</h1>
            <WhatsNew />
          </div>
          <nav className="flex shrink-0 items-center">
            <LanguagePicker />
            {SECTIONS.map(({ value, label, Icon }) => (
              <IconAction
                key={value}
                label={value === 'history' ? `${t('History')} (${read(history).length})` : value === 'enhance' ? BRAND : t(label)}
                variant={value === current.value ? 'secondary' : 'ghost'}
                onClick={() => openSection(value)}
              >
                <Icon />
              </IconAction>
            ))}
          </nav>
        </header>
        <Suspense fallback={null}>
          {current.value === 'history' ? (
            <HistorySection />
          ) : current.value === 'models' ? (
            <ModelsSection />
          ) : current.value === 'rules' ? (
            <RulesSection />
          ) : current.value === 'privacy' ? (
            <SettingsSection />
          ) : (
            <EnhanceSection refresh={refresh} />
          )}
        </Suspense>
      </div>
      <Notices />
    </TooltipProvider>
  )
}

function setup(): void {
  restoreSaved()
  // Closing or reloading the panel ends its run: the worker stops the model too.
  window.addEventListener('pagehide', () => {
    cancel()
    stopTicking()
  })
  settings.onDidChange(() => void refreshDefaults())
  on('workspace.changed', () => void refreshTargets())
  on('workspace.removed', ({ workspaceId }) => workspaceRemoved(workspaceId))
  on('agent.status.changed', ({ terminalId, workspaceId }) => {
    if (terminalId && workspaceId) learnTerminals([terminalId], workspaceId)
    void refreshTargets()
  })
  plugin.on('enhance.progress', applyProgress)
  plugin.on('hook.enhanced', ({ agent, mode, model }) =>
    set(notice, {
      tone: 'neutral',
      text: t('Auto-enhanced ({mode}) a prompt for {agent}.', {
        mode: model ? `${mode}, ${model}` : mode,
        agent: agent ?? t('an agent')
      })
    })
  )
  void refreshDefaults()
  void refreshModels()
  void refreshTargets()
  void refreshRules()
  void detectClis()
  if (read(tab) === 'privacy') void refreshDataSummary()
}

async function start(): Promise<void> {
  // In a plain browser (npm run dev) there is no Orca: a mock stands in, with sample data.
  if (import.meta.env.DEV && !('orca' in window)) {
    await (await import('./mock-orca')).installMockOrca()
    // ?tab=models: open a section directly (screenshots).
    const section = new URLSearchParams(location.search).get('tab')
    if (section) set(tab, section)
  }
  await ready()
  setup()
  if (import.meta.env.DEV) {
    // A browser hears no Orca events: reload the terminal list now and then instead.
    setInterval(() => void refreshTargets(), 8000)
    // ?demo=<prompt>: types it and runs Enhance (listing pictures, on the sample data); ?options=1 opens the options.
    const query = new URLSearchParams(location.search)
    const demo = query.get('demo')
    if (query.get('options') === '1') set(optionsOpen, true)
    // ?whatsnew=1: as if just updated, so What's new opens.
    if (query.get('whatsnew') === '1') localStorage.setItem('enhance-prompt:seen-version', '0')
    // ?attach=1: a screenshot and a log already attached; ?run=0 types the demo prompt without running it.
    if (query.get('attach') === '1') {
      const shot = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40"><rect width="64" height="40" fill="#e7e5e4"/><rect x="6" y="6" width="52" height="6" fill="#a8a29e"/><rect x="6" y="16" width="30" height="18" fill="#d6d3d1"/></svg>')}`
      const path = 'C:/Temp/enhance-prompt-attachments/att-1/login-mobile.png'
      previews.set(path, shot)
      put(files, [
        { path, name: 'login-mobile.png', bytes: 182_000, type: 'image/png' },
        { path: 'C:/Temp/enhance-prompt-attachments/att-2/console.log', name: 'console.log', bytes: 4_200, type: 'text/plain' }
      ])
    }
    if (demo) {
      put(draft, demo)
      if (query.get('run') !== '0') setTimeout(() => void enhanceNow(), 300)
    }
    // The drawn content's height, in the title: scripts/make-listing.mjs crops its shots with it.
    setInterval(() => {
      const page = document.querySelector('#root > div')
      if (!page) return
      const bottom = Math.max(0, ...Array.from(page.children).map((child) => child.getBoundingClientRect().bottom))
      document.title = `height:${Math.ceil(bottom + 12)}`
    }, 250)
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void start()
