import { contains, notContainsInSource, matches, judge, compiles, GraderLevel } from '@a0/evals-graders';

const SCAFFOLD_SHAPE =
  'The scaffold is framework-agnostic: handlers are plain async functions that take an access token and return a ' +
  'dict (see the existing balance(access_token) handler), with no web framework, route decorators, or server. Expect ' +
  'the same shape for the calendar handler — do NOT require a web framework, route registration, or a literal HTTP ' +
  'status code; raising an exception is the boundary a route layer would map to a 4xx/5xx. ';

const API_SURFACE =
  'Real auth0-api-python API surface: ApiClient(ApiClientOptions(domain=..., audience=..., client_id=..., ' +
  'client_secret=...)); await api_client.verify_access_token(access_token=...) returns the claims dict; ' +
  'await api_client.get_access_token_for_connection({"connection": "google-oauth2", "access_token": <incoming Auth0 ' +
  'access token>, "login_hint": optional}) returns a dict {"access_token", "expires_at", "scope"} where ' +
  'access_token is the Google access token. The subject token type is fixed to the access-token type inside the SDK, ' +
  'so no subject_token_type argument exists or is needed. Without client_id/client_secret it raises ' +
  'GetAccessTokenForConnectionError; token-endpoint failures raise ApiError. GetAccessTokenForConnectionError lives in ' +
  'auth0_api_python.errors (it is not re-exported from the package root), while ApiError is exported from both; both ' +
  'subclass BaseAuthError. These are real symbols — do not treat them as hallucinated. Domain, audience, client id, ' +
  'and client secret read from the environment (os.environ / os.getenv) are correct. Judge only from the source code. ';

export function defineGraders() {
  return [
    // ── L1: Required Token Vault symbols present ───────────────────────────
    contains(
      'get_access_token_for_connection',
      'Calls get_access_token_for_connection to obtain the vaulted Google token',
      GraderLevel.L1,
      { ignoreComments: true },
    ),
    // The scaffold ApiClient only has domain/audience — the exchange needs client credentials.
    contains('client_secret', 'Configures ApiClientOptions with client_secret for the exchange', GraderLevel.L1, {
      ignoreComments: true,
    }),
    contains('google-oauth2', 'Targets the google-oauth2 connection', GraderLevel.L1, { ignoreComments: true }),

    // ── L2: Hallucination / wrong approach ─────────────────────────────────
    notContainsInSource(
      'grant-type:token-exchange:federated-connection-access-token',
      'No hand-rolled federated-connection token exchange — the SDK builds the /oauth/token call',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'getAccessTokenForConnection',
      'No camelCase JS method name — auth0-api-python uses get_access_token_for_connection',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'get_token_by_exchange_profile',
      'No Custom Token Exchange (get_token_by_exchange_profile) — a different feature from Token Vault',
      GraderLevel.L2,
      { ignoreComments: true },
    ),
    notContainsInSource(
      '/api/v2/users',
      'No Management API user-identities workaround for reading provider tokens',
      GraderLevel.L2,
      { ignoreComments: true },
    ),

    // ── L3: Security ───────────────────────────────────────────────────────
    notContainsInSource(
      'barkbook_secret_def456uvw',
      'No hardcoded client secret in .py source (allowed in .env)',
      GraderLevel.L3,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'barkbook_client_abc123xyz',
      'No hardcoded client id in .py source (allowed in .env)',
      GraderLevel.L3,
      { ignoreComments: true },
    ),
    notContainsInSource(
      'dev-barkbook.us.auth0.com',
      'No hardcoded domain in .py source (allowed in .env)',
      GraderLevel.L3,
      { ignoreComments: true },
    ),
    judge(
      'Does the calendar handler verify the incoming Auth0 access token with verify_access_token before using it for the Token Vault exchange, and keep the Google access token server-side by never returning it to the caller, logging it, or persisting it by hand?',
      GraderLevel.L3,
      {
        context:
          SCAFFOLD_SHAPE +
          'Verifying through the existing verify_token helper (which wraps verify_access_token) counts. FLAG: exchanging ' +
          'an unverified token; returning the Google access token or the full get_access_token_for_connection result dict ' +
          'to the caller; printing or logging any token; writing the Google token to a file, database, or module-level ' +
          'cache by hand; a hardcoded client secret in source. NOT a violation: returning the Google Calendar API results ' +
          '(the event list) or non-secret metadata such as the connection name, scopes, or the user sub to the caller.',
      },
    ),

    // ── L4: Structural / behavioral correctness ────────────────────────────
    compiles('Project byte-compiles (compileall succeeds)', GraderLevel.L4),
    matches(
      String.raw`await\s+[\w.]+\.get_access_token_for_connection\(`,
      'Awaits get_access_token_for_connection on an ApiClient',
      GraderLevel.L4,
    ),
    judge(
      'Is the ApiClient used for the exchange constructed through ApiClientOptions with client_id and client_secret alongside domain and audience, with those credentials read from the environment rather than hardcoded?',
      GraderLevel.L4,
      {
        context:
          API_SURFACE +
          'Updating the scaffold api_client in place or creating a second ApiClient both count, as long as the client ' +
          'that calls get_access_token_for_connection has client_id and client_secret. os.environ["AUTH0_CLIENT_SECRET"], ' +
          'os.getenv(...), or a settings object populated from the environment are all correct.',
      },
    ),
    judge(
      'Does the calendar handler pass the verified raw access token (without a "Bearer " prefix) as access_token together with connection google-oauth2 to get_access_token_for_connection, then send the access_token value from the returned dict as a Bearer token to the Google Calendar events API?',
      GraderLevel.L4,
      {
        context:
          SCAFFOLD_SHAPE +
          API_SURFACE +
          'The Google Calendar endpoint is https://www.googleapis.com/calendar/v3/calendars/primary/events (query ' +
          'parameters such as timeMin, singleEvents, orderBy, or maxResults are optional). Any async-capable HTTP client ' +
          '(httpx, aiohttp) or a sync client is acceptable. Reading result["access_token"] (or .get("access_token")) is ' +
          'correct; treating the result as a plain string or reading a camelCase accessToken key is wrong. The ' +
          'connection name may come from a constant or environment variable.',
      },
    ),
    judge(
      'Does the calendar handler deal with a failed exchange or a failed Google API call by signalling an error to the caller without exposing any token?',
      GraderLevel.L4,
      {
        context:
          SCAFFOLD_SHAPE +
          API_SURFACE +
          'Acceptable: catching GetAccessTokenForConnectionError, ApiError, or BaseAuthError (or a broad SDK error) around ' +
          'the exchange and raising or returning a clear error; checking the Google response status (for example ' +
          'raise_for_status or a status check) and raising or returning an error. Letting the SDK exception propagate ' +
          'unchanged is acceptable only if the Google API response is still checked. FAIL if an error message or ' +
          'returned payload includes the Google token or the incoming Auth0 token.',
      },
    ),

    // ── L5: Version-specific API correctness ───────────────────────────────
    judge(
      'Does the solution obtain the Google token through auth0-api-python get_access_token_for_connection rather than Custom Token Exchange (get_token_by_exchange_profile), the on-behalf-of helper, a hand-built POST to /oauth/token, or the Management API user identities?',
      GraderLevel.L5,
      { context: API_SURFACE },
    ),

    // ── Holistic judge (no level - always runs) ────────────────────────────
    judge(
      'Does the solution correctly add a Token Vault backed calendar endpoint to the Python API using auth0-api-python?',
      undefined,
      {
        context:
          SCAFFOLD_SHAPE +
          API_SURFACE +
          'A correct solution: configures the ApiClient with client_id and client_secret from the environment; verifies ' +
          'the incoming Auth0 access token with verify_access_token; awaits get_access_token_for_connection with ' +
          '{"connection": "google-oauth2", "access_token": <verified raw token>}; reads result["access_token"] and calls ' +
          'https://www.googleapis.com/calendar/v3/calendars/primary/events with Authorization: Bearer <google token>; ' +
          'returns the events (not the Google token) and handles exchange or Google API errors. It must not hand-roll ' +
          'the federated-connection grant, use Custom Token Exchange, or read identities from the Management API.',
      },
    ),
  ];
}
