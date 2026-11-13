// The web panel's entry: starts the panel's state (src/panel/setup.ts wires Orca's events to it), then
// draws the header and the current section.
import { lazy, StrictMode, Suspense, useReducer } from 'react'
import { createRoot } from 'react-dom/client'
import { read, set } from 'orca'
import { BookOpenIcon, BotIcon, LanguagesIcon, ScrollTextIcon, SettingsIcon, SparklesIcon } from 'lucide-react'
import './index.css'
import { t, UI_LANGUAGES, uiLanguageSetting } from '../../src/i18n.ts'
import { SECTION_LABELS, UI_LANGUAGE_LABELS } from '../../src/panel/view.ts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BRAND } from '../../src/brand.ts'
import { busy, draft, files, history, historyOpen, notice, optionsOpen, put, say, sendAfterEnhance, tab } from '../../src/panel/state.ts'
import { msg } from '../../src/messages.ts'
import { previews } from './attach'
import { changeUiLanguage, enhanceAndSend, enhanceNow, refreshDataSummary, refreshHookLast, refreshTargets } from '../../src/panel/actions.ts'
import { closePanel, wirePanel } from '../../src/panel/setup.ts'
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
  { value: 'enhance', Icon: SparklesIcon },
  { value: 'history', Icon: BookOpenIcon },
  { value: 'models', Icon: BotIcon },
  { value: 'rules', Icon: ScrollTextIcon },
  { value: 'privacy', Icon: SettingsIcon }
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
  if (value === 'privacy') {
    void refreshDataSummary()
    void refreshHookLast()
  }
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
            {SECTIONS.map(({ value, Icon }) => (
              <IconAction
                key={value}
                label={value === 'history' ? `${t(SECTION_LABELS.history)} (${read(history).length})` : value === 'enhance' ? BRAND : t(SECTION_LABELS[value])}
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

async function start(): Promise<void> {
  // In a plain browser (npm run dev) there is no Orca: a mock stands in, with sample data.
  if (import.meta.env.DEV && !('orca' in window)) {
    await (await import('./mock-orca')).installMockOrca()
    // ?tab=models: open a section directly (screenshots).
    const section = new URLSearchParams(location.search).get('tab')
    if (section) set(tab, section)
  }
  await ready()
  // Closing or reloading the panel ends its run: the worker stops the model too.
  window.addEventListener('pagehide', closePanel)
  wirePanel()
  if (import.meta.env.DEV) {
    // A browser hears no Orca events: reload the terminal list now and then instead.
    setInterval(() => void refreshTargets(), 8000)
    // ?demo=<prompt>: types it and runs Enhance (listing pictures, on the sample data); ?options=1 opens the options.
    const query = new URLSearchParams(location.search)
    const demo = query.get('demo')
    if (query.get('options') === '1') set(optionsOpen, true)
    // ?entry=h1: a history entry read in place; ?toast=undo: a notice with its button (pictures).
    const entry = query.get('entry')
    if (entry) set(historyOpen, entry)
    if (query.get('toast') === 'undo') {
      setTimeout(() => set(notice, { tone: 'neutral', text: t('Removed from the history.'), action: { label: t('Undo'), run: { kind: 'history.restore', id: 'none' } } }), 600)
    }
    // ?toast=blocked: what Send says for an agent that is waiting for an answer, once the demo's result is there.
    if (query.get('toast') === 'blocked') {
      const text = say(msg('error.agent_blocked', { name: 'Claude Code' }))
      setTimeout(() => set(notice, { tone: 'warning', text, action: { label: t('Type it without Enter'), run: { kind: 'send.anyway', terminalId: 'none', text: '' } } }), 6000)
    }
    // ?onestep=1: "Send right after enhancing" is on, so its button is drawn next to Enhance;
    // ?onestep=run: the demo prompt also goes through it (enhanced, then sent or held back);
    // ?onestep=0 turns it back off (the pictures share one browser profile, and it is remembered).
    const oneStep = query.get('onestep')
    if (oneStep) set(sendAfterEnhance, oneStep !== '0')
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
      // Run once the panel is idle (opening the options gathers the context first).
      const go = (): void => void (read(busy) ? setTimeout(go, 200) : oneStep === 'run' ? enhanceAndSend() : enhanceNow())
      if (query.get('run') !== '0') setTimeout(go, 300)
    }
    // The drawn content's height, in the title: scripts/make-listing.mjs crops its shots with it.
    // With the options open, also where they are (left,top,right,bottom): a picture of them alone.
    setInterval(() => {
      const page = document.querySelector('#root > div')
      if (!page) return
      const bottom = Math.max(0, ...Array.from(page.children).map((child) => child.getBoundingClientRect().bottom))
      const options = read(optionsOpen) ? document.querySelector('#root .grid.grid-cols-2')?.parentElement?.getBoundingClientRect() : undefined
      const where = options ? ` options:${[options.left, options.top, options.right, options.bottom].map(Math.round).join(',')}` : ''
      document.title = `height:${Math.ceil(bottom + 12)}${where}`
    }, 250)
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void start()
