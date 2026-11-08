// `orca plugin check` renders the panel once per scenario.
import { defineCheck } from 'orca/testing'
import { PRESETS } from './presets'

const gpt = {
  id: 'gpt', name: 'OpenAI', preset: 'openai', provider: 'openai' as const, baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini', temperature: 0.3, maxTokens: 2000, enabled: true, keySource: 'secret' as const, envName: 'OPENAI_API_KEY'
}
const claude = { ...gpt, id: 'claude', name: 'Anthropic', preset: 'anthropic', provider: 'anthropic' as const, baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-4-5', keySource: 'none' as const, envName: 'ANTHROPIC_API_KEY' }
const models = (profiles: (typeof gpt | typeof claude)[]) => ({ profiles, hookProfileId: null, selectorProfileId: null, fromEnv: false, presets: PRESETS })
const agents = { targets: [{ terminalId: 't1', label: 'Claude · waiting', agent: 'claude' }] }

export default defineCheck({
  'no model': { requests: { 'models.get': models([]), 'targets.list': { targets: [] } } },
  ready: {
    requests: { 'models.get': models([gpt, claude]), 'targets.list': agents },
    persisted: {
      plugin: {
        draft: 'login page is broken on mobile',
        result: 'Fix the login page layout on mobile.\n\nStart in src/auth/LoginForm.tsx.\n\nDone when: pnpm test passes.'
      }
    }
  },
  history: {
    requests: { 'models.get': models([gpt]), 'targets.list': { targets: [] } },
    storage: {
      history: [
        { id: 'a', at: 1767225600000, original: 'add dark mode', enhanced: 'Add a dark mode toggle…', style: 'feature', model: 'gpt-4.1-mini', source: 'panel' },
        { id: 'b', at: 1767225500000, original: 'fix flaky test', enhanced: 'Investigate the flaky test…', style: 'bugfix', model: 'gpt-4.1-mini', source: 'hook' }
      ]
    }
  }
})
