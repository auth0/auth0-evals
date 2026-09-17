# nextjs-auth0 scaffold — agent guidance

## Scope

The Auth0 client is in `lib/auth0.ts` — import it directly, do not create a new one:

```ts
import { auth0 } from '@/lib/auth0';
```

Add new files (Server Actions, Route Handlers, pages) as needed. The main flow belongs in a Server Action or Route Handler that calls `auth0.getAccessToken`.

## Key imports

```ts
import { auth0 } from '@/lib/auth0';
import { MfaRequiredError } from '@auth0/nextjs-auth0/server';
```

## getAccessToken signature

```ts
const { token } = await auth0.getAccessToken({
  audience: 'https://api.barkbook.com',
  refresh: true,   // required — without this the cached token is returned without triggering MFA
});
```

## mfa_token cookie handoff

```ts
import { cookies } from 'next/headers';

// After catching MfaRequiredError
(await cookies()).set('mfa_token', error.mfa_token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 300 });
// On the MFA challenge/verify handler
const mfaToken = (await cookies()).get('mfa_token')?.value;
(await cookies()).delete('mfa_token');
```

## jose is available

`jose` is a dependency of `@auth0/nextjs-auth0` and importable — no need to verify its presence in node_modules. Use `decodeJwt` from `jose` to decode the id_token in `beforeSessionSaved`.

## Required approach — server-side only, no redirect

This task requires **Flow 1** (server-side `getAccessToken` → catch `MfaRequiredError`). Do **not** redirect to `/auth/login` with `acr_values` or `max_age` — that is Flow 0 and will not satisfy the graders. Do not use `mfa.challengeWithPopup()` either; use the `auth0.mfa.*` API directly in your Server Action or Route Handler.

## No spelunking

Do not read `node_modules` to verify types. All method signatures are in the skill reference doc (`nextjs-auth0.md`). The types you need:

- `MfaRequiredError` — import from `@auth0/nextjs-auth0/server`; has `.mfa_token: string`
- `auth0.mfa.getAuthenticators({ mfaToken })` → `Authenticator[]`
- `auth0.mfa.enroll({ mfaToken, authenticatorTypes, oobChannels? })` → enrollment response
- `auth0.mfa.challenge({ mfaToken, challengeType, authenticatorId })` → `{ oobCode }`
- `auth0.mfa.verify({ mfaToken, otp? | oobCode? | recoveryCode? })` → `void`
- `BeforeSessionSavedHook` signature: `(session: SessionData, idToken: string) => Promise<SessionData>`
