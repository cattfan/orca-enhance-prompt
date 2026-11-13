// setup.ts: starts the panel. Orca's and the worker's events reach the panel's state (state.ts) and
// the first data is asked for. No UI here: the web panel (web/src/main.tsx) calls it once its frame
// is ready, and the tests call it on Orca's panel runtime (src/panel/testing.ts), so the wiring that
// ships is the wiring that is tested.
import { on, plugin, read, set, settings } from 'orca'
import { t } from '../i18n.ts'
import {
  applyProgress,
  cancel,
  detectClis,
  learnTerminals,
  refreshConsents,
  refreshDataSummary,
  refreshDefaults,
  refreshHookLast,
  refreshModels,
  refreshRules,
  refreshTargets,
  stopTicking,
  workspaceRemoved
} from './actions.ts'
import { notice, restoreSaved, say, tab } from './state.ts'

/**
 * Brings back what the last panel run saved, follows the events and loads the models, terminals,
 * rules, detected CLIs and confirmations. Returns a function that stops following the events.
 */
export function wirePanel(): () => void {
  restoreSaved()
  const subscriptions = [
    settings.onDidChange(() => void refreshDefaults()),
    on('workspace.changed', () => void refreshTargets()),
    on('workspace.removed', ({ workspaceId, path }) => workspaceRemoved(workspaceId, path)),
    on('agent.status.changed', ({ terminalId, workspaceId }) => {
      // Orca says which workspace this agent's terminal is in: keep it for telling workspaces apart.
      if (terminalId && workspaceId) learnTerminals([terminalId], workspaceId)
      void refreshTargets()
    }),
    plugin.on('enhance.progress', applyProgress),
    plugin.on('hook.enhanced', ({ agent, mode, model }) => {
      set(notice, {
        tone: 'neutral',
        text: t('Auto-enhanced ({mode}) a prompt for {agent}.', {
          mode: model ? `${mode}, ${model}` : mode,
          agent: agent ?? t('an agent')
        })
      })
      void refreshHookLast()
    }),
    // Auto-enhance (AI) let a prompt through as it was: say why, it used to be in the log only.
    plugin.on('hook.skipped', ({ agent, reason }) => {
      set(notice, { tone: 'warning', text: t('Auto-enhance left a prompt for {agent} unchanged: {reason}', { agent: agent ?? t('an agent'), reason: say(reason) }) })
      void refreshHookLast()
    })
  ]
  void refreshDefaults()
  void refreshModels()
  void refreshTargets()
  void refreshRules()
  void detectClis()
  void refreshConsents()
  // The stored-data counts read every saved key; load them only for the section that shows them.
  if (read(tab) === 'privacy') {
    void refreshDataSummary()
    void refreshHookLast()
  }
  return () => {
    for (const subscription of subscriptions) subscription.dispose()
  }
}

/** The panel is closing or reloading: its run ends, and the request's signal stops the worker's model call too. */
export function closePanel(): void {
  cancel()
  stopTicking()
}
