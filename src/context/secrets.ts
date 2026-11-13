// Masking of values that look like keys, tokens or passwords, before text goes to a model.
// Two strengths: `redactSecrets` for what was printed (terminal output, command lines), which may
// cut too much, and `redactCode` for source code (a diff, a file's lines), which must not: it
// masks only what is certainly the value of a secret. Neither can catch everything, and the
// panel says so.

/** `sk-...`, `pk-...`, `rk-...`: API keys of several providers. In code these letters also start ordinary names. */
const DASHED_KEY = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g
/** Values in a format only a credential has, whatever stands around them. */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  // Not `\b` at the end: a key may end in "-", after which no word boundary follows.
  /\bAIza[0-9A-Za-z_-]{35}(?![\w-])/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
]
/**
 * A name that says it holds a secret: `password`, `apiToken`, `CLIENT_SECRET`, `private_key`,
 * `accessKey`. "key" alone is too common a word in code, so it counts only after one of the
 * words that make it a credential.
 */
const SECRET_NAME = '[A-Za-z0-9_]*(?:(?:api|private|access|auth|encryption|signing)[_-]?key|token|secret|passw(?:or)?d|credential)[A-Za-z0-9_]*'
/** `API_KEY=...`, `"token": "..."`, `password: ...`: the name stays, the value goes. */
const SECRET_ASSIGNMENT = new RegExp(`\\b(${SECRET_NAME})(["']?\\s*[:=]\\s*["']?)([^\\s"',;]{6,})`, 'gi')
/**
 * What may stand between such a name and its value in source code: `=`, `:`, `:=` (Go), `=>` (PHP,
 * Ruby), a type in between (`apiKey: string = "..."`), and the end of a subscript before it
 * (`config['SECRET_KEY'] = "..."`).
 */
const GIVEN = `["']?\\]?\\s*(?::\\s*[A-Za-z_][\\w.<>\\[\\]|? ]{0,40}?\\s*=|:=|=>|[:=])\\s*`
/** The same name given a quoted literal: `apiKey: "..."`, `"client_secret": '...'`. */
const SECRET_LITERAL = new RegExp(`\\b(${SECRET_NAME}${GIVEN})(["'\`])([^"'\`\\s]{12,})\\2`, 'gi')

/** `[redacted]`, and as many line breaks as the value had: the lines after it keep their numbers. */
const masked = (match: string) => `[redacted]${'\n'.repeat(match.split('\n').length - 1)}`

function maskFormats(text: string): string {
  let out = text
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, masked)
  return out
}

/** Masks values that look like keys, tokens or passwords. */
export function redactSecrets(text: string): string {
  // A count of tokens is not a token: `max_tokens: 200000`, `input_tokens=1234567` and
  // `{"max_tokens": 200000}` (the value takes the closing brace with it) stay as they are.
  return maskFormats(text.replace(DASHED_KEY, '[redacted]')).replace(SECRET_ASSIGNMENT, (match, name: string, sep: string, value: string) =>
    /tokens$/i.test(name) && /^\d+[\]})]*$/.test(value) ? match : `${name}${sep}[redacted]`
  )
}

/** An address with a scheme and no sign-in part (`https://auth.example.com/oauth2/token`): an endpoint, not a secret. */
const PLAIN_URL = /^[a-z][a-z0-9+.-]*:\/\/[^@]*$/i

/**
 * The same for source code, where going by the name alone would cut code (`const token =
 * getToken()`, `password: string`, `tokenUrl = '/oauth/token'`). Masked here:
 * - a value in one of the credential formats; of `sk-…`, `pk-…` and `rk-…` only one that holds a
 *   digit and does not go on from a longer name, since CSS classes and file names start that way
 *   too (`sk-circleBounceDelay`, `--rk-colors-accentColor`);
 * - a quoted literal of 12 characters or more, with both letters and digits, given to a name that
 *   says it holds a secret, unless it is a plain address.
 * Everything else stays, and a masked value keeps its line breaks, so the lines still read as the
 * code they are and keep their numbers.
 */
export function redactCode(text: string): string {
  const keys = text.replace(DASHED_KEY, (match, offset: number) => (/\d/.test(match) && !/[\w-]/.test(text[offset - 1] ?? '') ? '[redacted]' : match))
  return maskFormats(keys).replace(SECRET_LITERAL, (match, lead: string, quote: string, value: string) =>
    /[A-Za-z]/.test(value) && /\d/.test(value) && !PLAIN_URL.test(value) ? `${lead}${quote}[redacted]${quote}` : match
  )
}
