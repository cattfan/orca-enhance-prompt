// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { Message } from './messages.ts'
import type { RulesConfig } from './rules.ts'
import type { ContextItemView, ProfileView, Preset, Provider } from './presets.ts'

/** The longest a panel may wait for its worker (Orca caps `timeoutMs` at 120000). */
export const PANEL_REQUEST_LIMIT_MS = 120_000

export type AttemptView = { profileId: string; name: string; model: string; ok: boolean; error?: string; errorText?: Message; ms: number }
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
        /** Set by the panel to receive `enhance.progress` for this run. */
        runId?: string
        /** "Fix this error": the terminal whose latest error the prompt is about. */
        errorTerminalId?: string
        /** A prompt structure (Rules tab) whose sections replace the style's shape. */
        structureId?: string
        /** Paths of image files on this machine to attach (at most 4, 5 MB each; PNG, JPEG, GIF, WebP). */
        images?: string[]
        /** Orca's id of the workspace the panel is in (several can share a name and branch). */
        workspaceId?: string
      }
      output: {
        enhanced: string
        model: string
        profileName: string
        ms: number
        attempts: AttemptView[]
        context: ContextItemView[]
        notes: Message[]
      }
    }
    /** What context would be sent, without calling a model (no AI file picking). */
    'context.preview': {
      input: { prompt: string; terminalId?: string | null; level?: string; exclude?: string[]; workspaceId?: string }
      output: { context: ContextItemView[]; notes: Message[]; chars: number }
    }
    /** Types `text` into an agent terminal. */
    'prompt.send': {
      input: { terminalId: string; text: string; enter?: boolean }
      output: { accepted: boolean }
    }
    /** Copies `text` to the OS clipboard of the Orca host. */
    'prompt.copy': { input: { text: string }; output: { copied: boolean; error?: string } }
    /** Checks an image file to attach: an absolute path to a PNG, JPEG, GIF or WebP of at most 5 MB. */
    'images.inspect': { input: { path: string }; output: { path: string; name: string; bytes: number; type: string } }
    /** Agent terminals of the focused workspace, agents first. */
    'targets.list': {
      /** `known`: the workspace id of terminals the panel has seen (Orca's agent events, or the person's pick). */
      input: { known?: Record<string, string> }
      /** `choices`: the folders the focused workspace could be when several share its name and branch. */
      /** `workspace`: the focused workspace's name (rules can apply to one workspace). */
      /** `workspaceId`: Orca's id of the focused workspace (null when it cannot tell): the panel keeps each
       *  project's draft and result apart by it. */
      output: {
        targets: { terminalId: string; label: string; agent: string | null }[]
        workspace?: string | null
        workspaceId?: string | null
        choices?: { id: string; path: string }[]
      }
    }
    'models.get': { output: ModelsView }
    /** Adds or updates a profile (and its key). */
    'models.save': { input: ProfileInput; output: ModelsView }
    'models.delete': { input: { id: string }; output: ModelsView }
    /** Moves a profile one step, or straight to position `to` (0 = tried first). */
    'models.move': { input: { id: string; direction?: 'up' | 'down'; to?: number }; output: ModelsView }
    'models.roles': { input: { hookProfileId: string | null; selectorProfileId: string | null }; output: ModelsView }
    /** Sends a tiny request through one profile. */
    'models.test': { input: { id: string }; output: { ok: boolean; message: string; text?: Message; ms: number } }
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
    /** Deletes one history entry (in order with new entries being saved). */
    'history.remove': { input: { id: string }; output: { ok: true } }
    /** Deletes the whole history (in order with new entries being saved). */
    'history.clear': { output: { ok: true } }
    /** Rules tab: your rules and prompt structures. */
    'rules.get': { output: RulesConfig }
    /** Replaces them (cleaned and capped); answers with what was saved. */
    'rules.save': { input: { config: RulesConfig }; output: RulesConfig }
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
    /** The steps of the panel's enhance run, a full snapshot on every change. */
    'enhance.progress': {
      runId: string
      startedAt: number
      steps: { key: string; status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'; detail?: string }[]
    }
  }
}
