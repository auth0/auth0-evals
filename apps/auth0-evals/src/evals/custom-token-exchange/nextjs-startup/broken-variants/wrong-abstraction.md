# Broken Variant: Wrong Abstraction

**What's broken**: Uses `auth0.getAccessToken()` to fetch the current session's access token rather than calling `auth0.customTokenExchange()` to exchange a legacy token. The code also omits `CustomTokenExchangeError` entirely.

**Expected failure**: L1 — `customTokenExchange` and `CustomTokenExchangeError` graders fail (neither is present).

```ts
// app/api/exchange-token/route.ts
import { auth0 } from '@/lib/auth0';

export async function POST(request: Request) {
  const { legacyToken } = await request.json();

  // BUG: getAccessToken() returns the current session's access token —
  // it does NOT exchange the legacyToken for a new one.
  try {
    const { token } = await auth0.getAccessToken();
    return Response.json({ accessToken: token });
  } catch (error) {
    return Response.json({ error: 'Failed' }, { status: 401 });
  }
}
```
