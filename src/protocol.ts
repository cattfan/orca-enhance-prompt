// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
export {}

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    /** Rewrites `prompt` with the configured model. */
    'prompt.enhance': {
      input: { prompt: string; style?: string; terminalId?: string | null }
      output: { enhanced: string; model: string; provider: string; ms: number }
    }
    /** Types `text` into an agent terminal. */
    'prompt.send': {
      input: { terminalId: string; text: string; enter?: boolean }
      output: { accepted: boolean }
    }
    /** Copies `text` to the OS clipboard of the Orca host. */
    'prompt.copy': { input: { text: string }; output: { copied: boolean; error?: string } }
    /** Agent terminals of the focused workspace, agents first. */
    'targets.list': {
      output: { targets: { terminalId: string; label: string; agent: string | null }[] }
    }
    /** Where the API key comes from, and the effective provider/model. */
    'config.status': {
      output: {
        provider: string
        model: string
        baseUrl: string
        keySource: 'secret' | 'env' | 'none'
        envName: string
        autoEnhanceMode: string
      }
    }
    /** Stores (or with an empty key, removes) the API key for a provider. */
    'config.setKey': { input: { provider: string; key: string }; output: { ok: true } }
    /** Sends a tiny request to check the key, URL and model. */
    'config.test': { output: { ok: boolean; message: string; ms: number } }
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginPanelEvents {
    /** The auto-enhance hook rewrote a prompt Orca was sending. */
    'hook.enhanced': { agent: string | null; mode: string }
  }
}
