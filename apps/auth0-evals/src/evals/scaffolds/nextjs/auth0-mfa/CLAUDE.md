# nextjs-auth0 scaffold — agent guidance

## What to build

1. A Server Action or Route Handler that calls `auth0.getAccessToken({ audience: 'https://api.barkbook.com', refresh: true })` and catches `MfaRequiredError`.
2. When `MfaRequiredError` is caught, drive the user through MFA — either via `mfa.challengeWithPopup()` from a client component, OR by storing `error.mfa_token` in a cookie and redirecting to an `/mfa-challenge` route.
3. Gate the Transfer Funds action behind the completed MFA.

Do **not** implement a `beforeSessionSaved` hook. Do **not** check `amr` claims. Do **not** use `acr_values` redirect (Flow 0) — that's a different flow not needed here.

## Auth0 client

Already configured in `lib/auth0.ts` — import it, do not create a new one:

```ts
import { auth0 } from '@/lib/auth0';
import { MfaRequiredError } from '@auth0/nextjs-auth0/server';
```

## getAccessToken — always use refresh: true

```ts
const { token } = await auth0.getAccessToken({
  audience: 'https://api.barkbook.com',
  refresh: true,   // required — without this the cached token is returned without triggering MFA
});
```

## Option A — popup (client component)

```tsx
"use client";
import { mfa } from '@auth0/nextjs-auth0/client';

async function handleTransfer() {
  const { token } = await mfa.challengeWithPopup({ audience: 'https://api.barkbook.com' });
  // call transfer API with token
}
```

## Option B — redirect to /mfa-challenge (cookie handoff)

```ts
import { cookies } from 'next/headers';

// After catching MfaRequiredError in the Server Action
(await cookies()).set('mfa_token', error.mfa_token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 300 });
redirect('/mfa-challenge');

// On the /mfa-challenge page — read it back
const mfaToken = (await cookies()).get('mfa_token')?.value;
(await cookies()).delete('mfa_token');
```

## No spelunking

Do **not** read `node_modules` to verify types. Do **not** look up `BeforeSessionSavedHook`, `SessionData`, or `jose` — they are not needed for this task. All method signatures are in the skill reference doc (`nextjs-auth0.md`). Types you need:

- `MfaRequiredError` — import from `@auth0/nextjs-auth0/server`; has `.mfa_token: string`
- `auth0.mfa.getAuthenticators({ mfaToken })` → `Authenticator[]`
- `auth0.mfa.enroll({ mfaToken, authenticatorTypes, oobChannels? })` → enrollment response
- `auth0.mfa.challenge({ mfaToken, challengeType, authenticatorId })` → `{ oobCode }`
- `auth0.mfa.verify({ mfaToken, otp? | oobCode? | recoveryCode? })` → `void`
