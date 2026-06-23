# Broken Variant: Correct Code, No Tenant Config

**What's broken**: The SDK call and error handling are correct, but the agent never creates a token exchange profile via the Auth0 CLI. Auth0 will reject every exchange with `EXCHANGE_FAILED` — no matching profile exists.

**Expected failure**: L4 — `ranCommand('/api/v2/token-exchange-profiles')` fails (no CLI call in the trace).

```ts
// app/api/exchange-token/route.ts — correct
import { auth0 } from '@/lib/auth0';
import { CustomTokenExchangeError } from '@auth0/nextjs-auth0/errors';

export async function POST(request: Request) {
  const { legacyToken } = await request.json();
  try {
    const result = await auth0.customTokenExchange({
      subjectToken: legacyToken,
      subjectTokenType: 'urn:nexuspay:legacy-token',
      audience: 'https://api.nexuspay.com',
    });
    return Response.json({ accessToken: result.accessToken });
  } catch (error) {
    if (error instanceof CustomTokenExchangeError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}

// BUG: No auth0 api POST /api/v2/token-exchange-profiles command was run.
// Auth0 has no profile configured — every exchange will fail at runtime.
```
