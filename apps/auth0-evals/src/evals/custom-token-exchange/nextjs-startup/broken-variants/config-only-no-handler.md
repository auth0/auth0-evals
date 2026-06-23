# Broken Variant: Config Created, No SDK Call

**What's broken**: The agent configures Auth0 with the CLI (profile created, action deployed) but never calls `auth0.customTokenExchange()` in the application code. The endpoint exists but returns a session token instead of performing an exchange.

**Expected failure**: L1 — `customTokenExchange` and `CustomTokenExchangeError` graders fail (neither is present in the code).

```bash
# The CLI commands ran correctly:
auth0 api POST /api/v2/actions --data '{"name":"cte-validator",...}'
auth0 api POST /api/v2/actions/{id}/deploy
auth0 api POST /api/v2/token-exchange-profiles --data '{...,"subject_token_type":"urn:nexuspay:legacy-token",...}'
```

```ts
// app/api/exchange-token/route.ts — BUG: missing customTokenExchange
import { auth0 } from '@/lib/auth0';

export async function POST(request: Request) {
  // BUG: gets the current session token, completely ignores the legacyToken in the body
  const { token } = await auth0.getAccessToken();
  return Response.json({ accessToken: token });
}
```
