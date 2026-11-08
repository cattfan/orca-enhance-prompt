// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { ContextItemView, ProfileView, Preset, Provider } from './presets'

export type AttemptView = { profileId: string; name: string; model: string; ok: boolean; error?: string; ms: number }
export type ProfileInput = {
  id?: string
  name: string
  preset: string
  provider: Provider
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  enabled: boolean
  /** CLI profiles: executable name or path. */
  command?: string
  /** Custom CLI: arguments. */
  args?: string
  /** New API key; undefined keeps the current one, '' removes it. */
  apiKey?: string
}
export type ModelsView = {
  profiles: ProfileView[]
  hookProfileId: string | null
  selectorProfileId: string | null
  fromEnv: boolean
  presets: Preset[]
}

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    /** Rewrites `prompt` with the model chain (or one profile), with context at `level`. */
    'prompt.enhance': {
      input: {
        prompt: string
        style?: string
        terminalId?: string | null
        level?: string
        profileId?: string | null
        /** A model of that profile for this prompt only (from its live list). */
        model?: string
        /** Output language for this prompt (auto, en, vi, zh, ...); the setting when absent. */
        language?: string
        exclude?: string[]
      }
      output: {
        enhanced: string
        model: string
        profileName: string
        ms: number
        attempts: AttemptView[]
        context: ContextItemView[]
        notes: string[]
      }
    }
    /** What context would be sent, without calling a model (no AI file picking). */
    'context.preview': {
      input: { prompt: string; terminalId?: string | null; level?: string; exclude?: string[] }
      output: { context: ContextItemView[]; notes: string[]; chars: number }
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
    'models.get': { output: ModelsView }
    /** Adds or updates a profile (and its key). */
    'models.save': { input: ProfileInput; output: ModelsView }
    'models.delete': { input: { id: string }; output: ModelsView }
    /** Moves a profile one step, or straight to position `to` (0 = tried first). */
    'models.move': { input: { id: string; direction?: 'up' | 'down'; to?: number }; output: ModelsView }
    'models.roles': { input: { hookProfileId: string | null; selectorProfileId: string | null }; output: ModelsView }
    /** Sends a tiny request through one profile. */
    'models.test': { input: { id: string }; output: { ok: boolean; message: string; ms: number } }
    /**
     * The models a preset or saved profile can use, kept current from the CLI or the API itself.
     * Cached for a day; `refresh` fetches again. `apiKey` lets an unsaved form list API models.
     */
    'models.catalog': {
      input: {
        preset: string
        profileId?: string
        baseUrl?: string
        provider?: string
        command?: string
        apiKey?: string
        refresh?: boolean
      }
      output: {
        models: { id: string; label: string; description?: string; isDefault?: boolean }[]
        source: string
        fetchedAt: number
        error?: string
      }
    }
    /** What the plugin keeps: history entries, saved models, saved keys, cached model lists. */
    'data.summary': { output: { history: number; profiles: number; keys: number; catalogs: number } }
    /** Deletes history, cached model lists, or everything (models and their keys too). */
    'data.clear': { input: { what: 'history' | 'catalogs' | 'all' }; output: { ok: true } }
    /** Agent CLIs found on this machine (usable with the person's subscription). */
    'models.detect': { output: { found: { preset: string; label: string; path: string; added: boolean }[] } }
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginPanelEvents {
    /** The auto-enhance hook rewrote a prompt Orca was sending. */
    'hook.enhanced': { agent: string | null; mode: string; model?: string }
  }
}
