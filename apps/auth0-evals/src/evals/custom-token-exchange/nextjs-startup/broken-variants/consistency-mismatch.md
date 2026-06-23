# Broken Variant: Token Type Mismatch (Code ↔ Config)

**What's broken**: The code uses `urn:nexuspay:legacy-token-v2` as `subjectTokenType`, but the CLI command configures the token exchange profile with `urn:nexuspay:legacy-token`. Auth0 cannot find a matching profile and returns `EXCHANGE_FAILED` at runtime — no compile-time error, no startup warning.

**Expected failure**: L5 — consistency judge fails (the token type URI in the code does not match the one in the CLI command).

```ts
// app/api/exchange-token/route.ts
import { auth0 } from '@/lib/auth0';
import { CustomTokenExchangeError } from '@auth0/nextjs-auth0/errors';

export async function POST(request: Request) {
  const { legacyToken } = await request.json();
  try {
    const result = await auth0.customTokenExchange({
      subjectToken: legacyToken,
      subjectTokenType: 'urn:nexuspay:legacy-token-v2',  // BUG: -v2 suffix not in profile
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
```

```bash
# Profile configured with the original type (no -v2):
auth0 api POST /api/v2/token-exchange-profiles \
  --data '{"name":"legacy-migration","subject_token_type":"urn:nexuspay:legacy-token","action_id":"...","type":"custom_authentication"}'
```
