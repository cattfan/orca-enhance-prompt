// Messages the worker sends the panel (notes, context labels, errors) as a code and parameters, so
// the panel shows them in its own language. The English templates below are also the keys of the
// translations in src/i18n.ts. No Node imports: the worker and the panel both load this file.

export const MESSAGES = {
  // Shown text that came from outside (a provider's error, a file name): never translated.
  raw: '{text}',

  // Context notes: why something was left out.
  'note.no_workspace': 'No focused workspace.',
  'note.workspace_unknown': 'Could not tell which folder the workspace is in; project files skipped.',
  'note.remote': 'Remote (SSH/WSL) workspace: project files are not readable from the plugin.',
  'note.terminal_off': 'Terminal output is off in Privacy.',
  'note.not_git': 'Not a git repository: no git context.',
  'note.no_files': 'No files matched the prompt; the agent will be told to locate them.',
  'note.project_files_off': 'Project files are off in Privacy: workspace and agent only.',
  'note.preview_no_picker': 'Preview skips the AI file picker.',
  'note.picker_skipped': 'AI file picker skipped: {reason}',

  // Context item titles and why an item is there.
  'label.workspace': 'Workspace',
  'label.agent': 'Target agent',
  'label.stack': 'Stack & commands',
  'label.log': 'Recent commits',
  'label.diff': 'Uncommitted changes',
  'label.tree': 'Repository tree ({count} files)',
  'label.status': 'Git status ({count} changed)',
  'label.terminal': 'Recent output: {name}',
  'why.keyword': 'keyword match',
  'why.ai': 'picked by AI',
  'why.trimmed': 'trimmed',

  // Errors and results.
  'error.no_prompt': 'Write a prompt first.',
  'error.cancelled': 'Cancelled.',
  'error.send_off': 'Sending to terminals is off in Privacy.',
  'error.nothing_to_send': 'Nothing to send.',
  'error.invalid_profile': 'Invalid model profile.',
  'error.unknown_profile': 'Unknown profile.',
  'result.test_ok': '{name} · {model} answered (key: {key}).',
  'error.bad_url': 'Invalid API base URL: {url}',
  'error.https_only': 'The API base URL must use https (http is allowed only for localhost).',
  'error.key_in_url': 'Put the API key in the Models tab, not in the URL.',
  'error.timeout': 'The request was cancelled or timed out.',
  'error.stopped': '{url} stopped answering: {detail}',
  'error.not_json': '{url} did not answer with JSON ({what}). A proxy or sign-in page may be in the way.',
  'error.empty_body': 'an empty answer',
  'error.no_key': 'No API key. Add one in the Enhance Prompt panel (Models tab).',
  'error.no_key_env': 'No API key. Add one in the Enhance Prompt panel (Models tab) or set {env}.',
  'error.unreachable': 'Could not reach {url}: {detail}',
  'error.http': '{status}: {detail}',
  'error.empty_answer': 'The model returned an empty answer.',
  'error.unsafe_argument': 'Unsafe argument for a .cmd launcher.',
  'error.cli_missing': '{name} was not found. Install it and sign in, or set its full path in the model.',
  'error.cli_start': 'Could not start {binary}: {detail}',
  'error.cli_exit': '{kind} exited with {code}',
  'error.cli_exit_detail': '{kind} exited with {code}: {detail}',
  'error.cli_sign_in': '{text} (run it once in a terminal to sign in)',
  'error.cli_empty': '{kind} returned an empty answer.',
  'error.no_model': 'No model configured. Add one in the Models tab.',
  'error.profile_no_key': '{name}: no API key',
  'error.all_failed': 'All models failed. {list}',
  'error.attempt': '{name}: {reason}',
  'error.out_of_time': 'Out of time.'
} as const

export type MessageCode = keyof typeof MESSAGES
export type MessageParam = string | number | Message | MessageParam[]
/** Plain JSON, so it travels in request outputs and thrown errors alike. */
export type Message = { code: MessageCode; params?: Record<string, MessageParam> }

export function msg(code: MessageCode, params?: Record<string, MessageParam>): Message {
  return params ? { code, params } : { code }
}

/** Text from outside the plugin, shown as is. */
export const raw = (text: string): Message => ({ code: 'raw', params: { text } })

export function isMessage(value: unknown): value is Message {
  return Boolean(value) && typeof value === 'object' && typeof (value as Message).code === 'string' && (value as Message).code in MESSAGES
}

/**
 * Fills a message with `lookup` turning each template into the shown text: the panel passes its
 * translator, the worker passes English. Lists join with " · ".
 */
export function render(message: Message, lookup: (template: string, params: Record<string, string>) => string): string {
  const param = (value: MessageParam): string => {
    if (Array.isArray(value)) return value.map(param).join(' · ')
    if (isMessage(value)) return render(value, lookup)
    return String(value)
  }
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(message.params ?? {})) params[key] = param(value)
  return lookup(MESSAGES[message.code], params)
}

const fill = (template: string, params: Record<string, string>) => template.replace(/\{(\w+)\}/g, (match, key: string) => params[key] ?? match)

/** The English text: for logs, error messages and the model. */
export function english(message: Message): string {
  return render(message, fill)
}
