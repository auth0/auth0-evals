/**
 * Secret redaction for agent output that leaves the machine.
 *
 * `.env` files are already withheld from the judge and the recommendation analyst,
 * but for a CLI eval the credentials are not in a file — they are on the command
 * line (`--client-secret …`, `export AUTH0_CLIENT_SECRET=…`) and in the error body
 * a failed `auth0 api` call prints back. Any trace we send to an LLM has to pass
 * through here first.
 *
 * Two consumers, both of which take output off this machine:
 *
 * - `formatCommandTrace` (`graders/executors/llm-judge.ts`) — traces sent to an
 *   LLM judge or the recommendation analyst.
 * - `serializers.ts` — everything a run *publishes*: the JSON results file, the
 *   HTML report, the trace rendered in a dashboard. Redaction happens there at
 *   serialisation, which runs *after* graders and the scorer, so it cannot change
 *   a verdict or a score; graders still read the real workspace. It is also why
 *   the report template needs no redaction logic of its own — what it renders is
 *   already safe.
 *
 * What is deliberately *not* redacted matters as much as what is. Client ids, user
 * ids, `AUTH0_DOMAIN`, and audiences are identifiers and public configuration, not
 * credentials — a SPA client id is served in the JS bundle of every app that uses
 * it, and the domain appears in every token's `iss` claim and in the unauthenticated
 * `openid-configuration` document. Obscuring them would imply a secrecy they do not
 * have while destroying exactly what a reviewer needs to judge whether the agent
 * wired the SDK to the right application. The same reasoning is why `.env` contents
 * are not swept wholesale: a blanket sweep buys no security and trains readers to
 * skim past the marker, so the one marker that does matter stops registering.
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
 * pattern cannot redact the first pattern's output), one that is the next flag
 * (`--token --json` passes no secret), and one that is purely numeric.
 *
 * The numeric guard is what keeps prose readable. A credential is never a bare
 * number, but `token` and `secret` appear constantly in sentences that end in one
 * — `No token = 401`, `"expires_in": 86400`, `access_token_lifetime: 3600`. Without
 * the guard the first of those renders as `No token = [REDACTED SECRET] Valid…`,
 * losing the status code and the sentence break, and a reader is told a secret was
 * exposed where none was.
 */
const VALUE = `(?!\\[REDACTED|--|\\d+\\b)(?:"[^"]*"|'[^']*'|[^\\s,;&|)}\\]]+)`;

/**
 * An argument key that names a credential outright, for the structured case where
 * the name is an object key rather than text beside the value (`{ Authorization:
 * 'Bearer …' }`). Same end-anchoring as the text rules, so `token_endpoint_auth_method`
 * is not caught.
 */
const SECRET_KEY = new RegExp(`^(?:(?:proxy-)?authorization|[\\w.-]*(?:${SECRET_NAME}))$`, 'i');

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
  // The value runs to the next whitespace or quote, so a token with an unusual
  // character (`%`, `!`, `#`) is masked whole rather than leaking its suffix, while
  // the closing quote of `-H "Authorization: Bearer …"` is left in place.
  [/\b((?:proxy-)?authorization\s*:\s*)(Bearer|Basic)(\s+)(?!--)[^\s"']+/gi, `$1$2$3${REDACTION_MARKER}`],
  // `curl -u user:VALUE` in every form curl accepts: `-u user:v`, attached
  // `-uuser:v`, `--user user:v`, and `--user=user:v`.
  [/((?:-u(?=\S)|-u\s+|--user(?:=|\s+))["']?[^\s:"']+:)[^\s"']+/g, `$1${REDACTION_MARKER}`],
  // A PEM private key block, wherever it appears. Listed before the shape rules
  // below because it spans lines and its base64 body would otherwise be chewed
  // into by the long-opaque-token rule, leaving the BEGIN/END lines behind.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTION_MARKER],
  // A JWT, wherever it appears.
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+/g, REDACTION_MARKER],
  // Vendor-prefixed API keys (OpenAI, GitHub, Slack). These carry their own
  // recognisable prefix and sit below the 40-character floor of the opaque-token
  // rule, so neither the name rules nor the length rule catches them.
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, REDACTION_MARKER],
  [/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}/g, REDACTION_MARKER],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, REDACTION_MARKER],
  // A credential value that carries the credential word *inside itself*, with no key
  // beside it — `'barkbook_secret_def456uvw' NOT found in source files (good)`. A
  // grader detail quotes the needle it searched for, so the value arrives bare: the
  // name rules have no key to match and the value is too short for the length rule.
  // Three constraints keep this off ordinary identifiers: the word must be flanked by
  // separators, the suffix must be at least 6 characters, and it must contain a digit.
  // That is what separates a value like `_def456uvw` from a meaningful suffix such as
  // `reset_password_2fa` or `change_password_v2`.
  // The prefix admits several segments, so multi-word fixture names are covered too
  // (`fixture_not_a_real_secret_9f8e…`, `AUTH0_CLIENT_SECRET_abc123`), not just the
  // single-segment `barkbook_secret_…` shape.
  [
    /\b[A-Za-z0-9][A-Za-z0-9_-]*[_-](?:secret|password|passwd)[_-](?=[A-Za-z0-9_-]{6,})[A-Za-z0-9_-]*[0-9][A-Za-z0-9_-]*/gi,
    REDACTION_MARKER,
  ],
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

/**
 * Applies {@link redactSecrets} to every string in a tool call's argument record,
 * recursing through nested objects and arrays.
 *
 * A `.env` write is the usual route by which a credential reaches a trace, and it
 * arrives as one long string under a `content` key rather than as a keyed secret —
 * so the value has to be swept, not just classified by its key.
 *
 * The key is also consulted. In a structured record the credential's *name* can be
 * the object key rather than text beside the value (`{ Authorization: 'Bearer …' }`),
 * which the text rules cannot see, and such a value is often too short for the
 * opaque-token floor to catch on shape alone.
 *
 * A matching key masks the value *whole*, including an array or an object. Recursing
 * into it instead would re-scrub each leaf with no knowledge of the key that named it,
 * so `{ password: ['hunter2'] }` would publish `hunter2` — short, shapeless, and no
 * longer beside its own name. The key is the only evidence available, so it has to
 * cover everything beneath it.
 *
 * Non-string primitives are returned as-is, even under a credential-named key: a
 * number, boolean, or null cannot carry a credential, and coercing them to strings
 * would change the JSON types consumers read back.
 */
export function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = SECRET_KEY.test(key) && isCompoundOrString(value) ? REDACTION_MARKER : redactValue(value);
  }
  return out;
}

/** A value that can carry a credential: a string, or a container that may hold one. */
function isCompoundOrString(value: unknown): boolean {
  return typeof value === 'string' || (value !== null && typeof value === 'object');
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === 'object') return redactArgs(value as Record<string, unknown>);
  return value;
}
