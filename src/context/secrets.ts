// Masking of values that look like keys, tokens or passwords, before text goes to a model.
// Two strengths: `redactSecrets` for what was printed (terminal output, command lines), which may
// cut too much, and `redactCode` for source code (a diff, a file's lines), which must not: it
// masks only what is certainly the value of a secret. Neither can catch everything, and the
// panel says so.

/** Values in a format only a credential has, whatever stands around them. */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
]
const SECRET_NAME = '[A-Za-z0-9_]*(?:api[_-]?key|token|secret|passw(?:or)?d|credential)[A-Za-z0-9_]*'
/** `API_KEY=...`, `"token": "..."`, `password: ...`: the name stays, the value goes. */
const SECRET_ASSIGNMENT = new RegExp(`\\b(${SECRET_NAME})(["']?\\s*[:=]\\s*["']?)([^\\s"',;]{6,})`, 'gi')
/** The same, where the value is a quoted literal: `apiKey: "..."`, `"client_secret": '...'`. */
const SECRET_LITERAL = new RegExp(`\\b(${SECRET_NAME}["']?\\s*[:=]\\s*)(["'\`])([^"'\`\\s]{12,})\\2`, 'gi')

function maskFormats(text: string): string {
  let out = text
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]')
  return out
}

/** Masks values that look like keys, tokens or passwords. */
export function redactSecrets(text: string): string {
  // A count of tokens is not a token: `max_tokens: 200000`, `input_tokens=1234567` and
  // `{"max_tokens": 200000}` (the value takes the closing brace with it) stay as they are.
  return maskFormats(text).replace(SECRET_ASSIGNMENT, (match, name: string, sep: string, value: string) =>
    /tokens$/i.test(name) && /^\d+[\]})]*$/.test(value) ? match : `${name}${sep}[redacted]`
  )
}

/**
 * The same for source code, where going by the name alone would cut code (`const token =
 * getToken()`, `password: string`, `tokenUrl = '/oauth/token'`). Masked here: a value in one of
 * the credential formats, and a quoted literal of 12 characters or more with both letters and
 * digits that is given to a name saying key, token, secret or password. Everything else stays, so
 * the lines still read as the code they are.
 */
export function redactCode(text: string): string {
  return maskFormats(text).replace(SECRET_LITERAL, (match, lead: string, quote: string, value: string) =>
    /[A-Za-z]/.test(value) && /\d/.test(value) ? `${lead}${quote}[redacted]${quote}` : match
  )
}
