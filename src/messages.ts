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
  'note.terminal_off': 'Terminal output is off in Settings.',
  'note.not_git': 'Not a git repository: no git context.',
  'note.no_files': 'No files matched the prompt; the agent will be told to locate them.',
  'note.project_files_off': 'Project files are off in Settings: workspace and agent only.',
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
  'label.agents': 'Other agents in this workspace',
  'label.session': 'Other agent session: {name}',
  'label.activity': 'Recent agent activity',
  'label.saved': 'Files you saved lately',
  'why.keyword': 'keyword match',
  'why.ai': 'picked by AI',
  'why.trimmed': 'trimmed',

  // Errors and results.
  'error.no_prompt': 'Write a prompt first.',
  'error.attachment_bad': 'That attachment could not be received; try attaching it again.',
  'error.attachment_missing': 'The attached file {name} is no longer there (attachments are kept for a day). Attach it again.',
  'error.file_too_large': '{name} is {size}; an attachment can be at most {max}.',
  'note.images_paths_only': 'This model cannot see images: it got their paths only, and the prompt lists them for the agent.',
  'error.cancelled': 'Cancelled.',
  'error.send_off': 'Sending to terminals is off in Settings.',
  'error.launch_off': 'Starting new agents is off in Settings, or not confirmed yet.',
  'error.open_off': 'Opening files in Orca is off in Settings.',
  // Shown inside "Could not load the list (…)": no capital, no full stop.
  'error.lists_off': 'online model lists are off in Settings',
  'error.key_not_saved': 'Orca could not store the API key: this machine has no key store for it. Use a key from an environment variable, or a subscription CLI.',
  'error.agent_blocked': '{name} is waiting for an answer from you, and what is typed now could be taken as that answer.',
  // Why auto-enhance let a prompt through unchanged (the Settings section shows the last one).
  'hook.no_model': 'No enabled API model: a subscription CLI starts too slowly for the 2 s auto-enhance has.',
  'hook.empty': 'The model returned no prompt.',
  'error.unsupported': 'This version of Orca cannot do that yet.',
  'error.invalid_request': 'Invalid request.',
  'error.nothing_to_send': 'Nothing to send.',
  'error.invalid_profile': 'Invalid model profile.',
  'error.unknown_profile': 'Unknown profile.',
  'result.test_ok': '{name} · {model} answered (key: {key}).',
  'error.bad_url': 'Invalid API base URL: {url}',
  'error.https_only': 'The API base URL must use https (http is allowed only for localhost).',
  'error.key_in_url': 'Put the API key in the Models tab, not in the URL.',
  'error.timeout': 'The request was cancelled or timed out.',
  'error.model_timeout': '{model} did not answer within {seconds} s.',
  'error.too_slow': '{reason} A lower context level or a faster model answers sooner.',
  'error.run_gone': 'That run is no longer going (the plugin was restarted). Try again.',
  'error.stopped': '{url} stopped answering: {detail}',
  'error.not_json': '{url} did not answer with JSON ({what}). A proxy or sign-in page may be in the way.',
  'error.empty_body': 'an empty answer',
  'error.no_key': 'No API key. Add one in the Enhance Prompt panel (Models tab).',
  'error.no_key_env': 'No API key. Add one in the Enhance Prompt panel (Models tab) or set {env}.',
  'error.unreachable': 'Could not reach {url}: {detail}',
  'error.http': '{status}: {detail}',
  'error.empty_answer': 'The model returned an empty answer.',
  'error.cut_off': '{model} reached its limit of {max} tokens before it finished. Raise Max tokens for this model in the Models tab.',
  'error.refused': '{model} declined this request ({category}). Use another model, or rephrase the request.',
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
/** Plain JSON: it travels as it is in a request's output, and inside the text of a thrown error (below). */
export type Message = { code: MessageCode; params?: Record<string, MessageParam> }

/**
 * A thrown error reaches the panel as its code and its text only: Orca passes no other field on.
 * So the message travels inside the text: the English sentence (for logs and the command line),
 * then the message itself between these marks, as percent-encoded JSON: it then holds no bracket
 * and no space, so whatever a provider's own text contains, the marks are found again. The panel
 * reads it back and shows it in its own language; where the marks did not survive, the sentence
 * alone is shown.
 */
const WIRE_OPEN = ' [[message:'
const WIRE_CLOSE = ']]'

/** The text of an error that carries `message` to the panel. */
export function withMessage(message: Message): string {
  return `${english(message)}${WIRE_OPEN}${encodeURIComponent(JSON.stringify(message))}${WIRE_CLOSE}`
}

/** The message an error's text carries, or null when it carries none. */
export function messageIn(text: string): Message | null {
  const at = text.lastIndexOf(WIRE_OPEN)
  if (at < 0 || !text.endsWith(WIRE_CLOSE)) return null
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(text.slice(at + WIRE_OPEN.length, text.length - WIRE_CLOSE.length)))
    return isMessage(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** An error's text without what it carries: the sentence a person or a log reads. */
export function plainText(text: string): string {
  const at = text.lastIndexOf(WIRE_OPEN)
  return at < 0 ? text : text.slice(0, at)
}

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
