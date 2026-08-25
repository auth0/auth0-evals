/**
 * Secret redaction for agent output that leaves the machine.
 *
 * `.env` files are already withheld from the judge and the recommendation analyst,
 * but for a CLI eval the credentials are not in a file — they are on the command
 * line (`--client-secret …`, `export AUTH0_CLIENT_SECRET=…`) and in the error body
 * a failed `auth0 api` call prints back. Any trace we send to an LLM has to pass
 * through here first.
 *
 * The value is replaced, not the surrounding text: a reader still sees *that* a
 * secret was passed, in which flag, on which command. That matters because the
 * security graders judge exposure from the same trace — dropping the line entirely
 * would make "is the trace free of secrets?" pass vacuously, so `REDACTION_MARKER`
 * is deliberately conspicuous and is documented to those judges as evidence that a
 * secret occupied that position.
 *
 * This is name-driven (plus a shape rule for JWTs and long opaque tokens), so it
 * cannot catch a secret echoed with no surrounding context — e.g. a bare
 * `echo <32-char-value>`. It is a floor, not a guarantee.
 */

/** Stand-in for a removed secret value. Conspicuous on purpose — see the module note. */
export const REDACTION_MARKER = '[REDACTED SECRET]';

/** Name fragments that mark a flag, env var, or JSON key as holding a credential. */
const SECRET_NAME = 'secret|token|password|passwd|api[_-]?key|apikey|private[_-]?key|credential|signing[_-]?key';

/**
 * A quoted or bare value. Skips a value that is already the marker (so a second
 * pattern cannot redact the first pattern's output) and one that is the next flag
 * (`--token --json` passes no secret).
 */
const VALUE = `(?!\\[REDACTED|--)(?:"[^"]*"|'[^']*'|[^\\s,;&|)}\\]]+)`;

const PATTERNS: Array<[RegExp, string]> = [
  // `--client-secret VALUE`, `--client-secret=VALUE`, `--token VALUE`
  [new RegExp(`(--[\\w-]*(?:${SECRET_NAME})[\\w-]*)([=\\s]+)(?:${VALUE})`, 'gi'), `$1$2${REDACTION_MARKER}`],
  // `AUTH0_CLIENT_SECRET=VALUE`, `"client_secret": "VALUE"`, `clientSecret: VALUE`.
  // The credential word has to END the name, so `token_endpoint_auth_method: none`
  // and `expires_in` keep their values — they are configuration, not credentials,
  // and blanking them costs the analyst detail for nothing.
  [new RegExp(`(["']?[\\w.-]*(?:${SECRET_NAME})["']?\\s*[:=]\\s*)(?:${VALUE})`, 'gi'), `$1${REDACTION_MARKER}`],
  // `Authorization: Bearer VALUE`, `Authorization: Basic VALUE`. The header name is
  // required: a bare `Basic` is also the value of Auth0's `--auth-method` flag
  // (`token_endpoint_auth_method`), and matching the scheme alone masked the flag
  // that followed it. A bearer token with no header around it is still caught by the
  // JWT and long-opaque-token rules below.
  [/\b((?:proxy-)?authorization\s*:\s*)(Bearer|Basic)(\s+)(?!--)[\w\-._~+/]+=*/gi, `$1$2$3${REDACTION_MARKER}`],
  // `curl -u user:VALUE` in every form curl accepts: `-u user:v`, attached
  // `-uuser:v`, `--user user:v`, and `--user=user:v`.
  [/((?:-u(?=\S)|-u\s+|--user(?:=|\s+))["']?[^\s:"']+:)[^\s"']+/g, `$1${REDACTION_MARKER}`],
  // A JWT, wherever it appears.
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+/g, REDACTION_MARKER],
  // A long opaque token with no name attached. Auth0 client secrets are 64 chars
  // of URL-safe base64; the 40-char floor keeps client_ids (32 hex) and resource
  // ids (`org_`, `cgr_`, `rol_` + 16-24 chars) readable, because those are not
  // secrets and the analyst needs them to follow what the agent did.
  [/(?<![\w-])[A-Za-z0-9_-]{40,}(?![\w-])/g, REDACTION_MARKER],
];

/**
 * Replaces credential values in `text` with {@link REDACTION_MARKER}.
 *
 * Safe to call on anything: text with no credentials comes back unchanged.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
