// No build step: Orca strips the types and compiles the JSX when the panel loads.
import { Separator, IconButton, on, plugin, read, Row, set, settings, Stack, Text, type PanelContext } from 'orca'
import { t } from './i18n.ts'
import { VERSION } from './version.ts'
import { BRAND } from './brand.ts'
import { tab, notice, restoreSaved, history } from './panel/state.ts'
import { stopTicking, workspaceRemoved, cancel, refreshDefaults, refreshModels, refreshTargets, applyProgress, detectClis, refreshDataSummary } from './panel/actions.ts'
import { EnhanceTab } from './panel/enhance-tab.tsx'
import { HistoryTab } from './panel/history-tab.tsx'
import { ModelsTab } from './panel/models-tab.tsx'
import { PrivacyTab } from './panel/privacy-tab.tsx'
import { refreshRules, RulesTab } from './panel/rules-tab.tsx'

export function setup(ctx: PanelContext): void {
  restoreSaved()
  // Closing or reloading the panel ends its run: stop the request so the worker stops the model too.
  ctx.signal.addEventListener('abort', () => {
    cancel()
    stopTicking()
  })
  ctx.subscriptions.push(
    settings.onDidChange(() => void refreshDefaults()),
    on('workspace.changed', () => void refreshTargets()),
    on('workspace.removed', ({ workspaceId }) => workspaceRemoved(workspaceId)),
    on('agent.status.changed', () => void refreshTargets()),
    plugin.on('enhance.progress', applyProgress),
    plugin.on('hook.enhanced', ({ agent, mode, model }) =>
      set(notice, { tone: 'neutral', text: t('Auto-enhanced ({mode}) a prompt for {agent}.', { mode: model ? `${mode}, ${model}` : mode, agent: agent ?? t('an agent') }) })
    )
  )
  void refreshDefaults()
  void refreshModels()
  void refreshTargets()
  void refreshRules()
  void detectClis()
  // The stored-data counts read every saved key; load them only for the section that shows them.
  if (read(tab) === 'privacy') void refreshDataSummary()
}

const SECTIONS = [
  { value: 'enhance', label: 'Enhance', icon: 'lightbulb' },
  { value: 'history', label: 'History', icon: 'book' },
  { value: 'models', label: 'Models', icon: 'agent' },
  { value: 'rules', label: 'Rules', icon: 'wrench' },
  { value: 'privacy', label: 'Privacy', icon: 'settings' }
] as const

function openSection(value: string): void {
  set(tab, value)
  if (value === 'privacy') void refreshDataSummary()
}

/**
 * Icon navigation instead of Tabs: four 30px buttons fit any sidebar width, where Orca's tab strip
 * hides the tabs that do not fit. The section name sits on the left; each icon names itself on hover.
 */
function Nav() {
  const current = SECTIONS.find((section) => section.value === read(tab)) ?? SECTIONS[0]
  return (
    <Row justify="between" gap="xs">
      <Row gap="xs">
        <Text weight="semibold" truncate>
          {current.value === 'enhance' ? BRAND : t(current.label)}
        </Text>
        <Text muted size="xs">
          {`v${VERSION}`}
        </Text>
      </Row>
      <Row gap="none">
        {SECTIONS.map((section) => (
          <IconButton
            key={section.value}
            icon={section.icon}
            label={section.value === 'history' ? `${t('History')} (${read(history).length})` : section.value === 'enhance' ? BRAND : t(section.label)}
            variant={section.value === current.value ? 'outline' : 'ghost'}
            onPress={() => openSection(section.value)}
          />
        ))}
      </Row>
    </Row>
  )
}

export default function Panel() {
  const current = read(tab)
  return (
    <Stack gap="sm">
      <Nav />
      <Separator />
      {current === 'history' ? <HistoryTab /> : current === 'models' ? <ModelsTab /> : current === 'privacy' ? <PrivacyTab /> : current === 'rules' ? <RulesTab /> : <EnhanceTab />}
    </Stack>
  )
}

// Exported for tests.
export { applyProgress, beginRun, finishRun as finishRunForTest, setNowForTest } from './panel/actions.ts'
