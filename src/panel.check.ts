// `orca plugin check` renders the panel once per scenario.
import { defineCheck } from 'orca/testing'

const status = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
  baseUrl: 'https://api.openai.com/v1',
  keySource: 'secret' as const,
  envName: 'OPENAI_API_KEY',
  autoEnhanceMode: 'off'
}

export default defineCheck({
  'no key': {
    requests: { 'config.status': { ...status, keySource: 'none' as const }, 'targets.list': { targets: [] } }
  },
  ready: {
    requests: {
      'config.status': status,
      'targets.list': { targets: [{ terminalId: 't1', label: 'Claude · waiting', agent: 'claude' }] }
    },
    persisted: {
      plugin: {
        draft: 'login page is broken on mobile',
        result:
          'Fix the login page layout on mobile.\n\nContext: …\n\nDone when: the form fits 360px wide screens and existing tests pass.'
      }
    }
  },
  history: {
    requests: { 'config.status': status, 'targets.list': { targets: [] } },
    storage: {
      history: [
        { id: 'a', at: 1767225600000, original: 'add dark mode', enhanced: 'Add a dark mode toggle…', style: 'feature', model: 'gpt-4.1-mini', source: 'panel' },
        { id: 'b', at: 1767225500000, original: 'fix flaky test', enhanced: 'Investigate the flaky test…', style: 'bugfix', model: 'gpt-4.1-mini', source: 'hook' }
      ]
    }
  }
})
