# auth0-server-js scaffold — agent guidance

## Scope

**Edit only `src/index.ts`.** Do not modify `src/auth0.ts`, `src/types.ts`, or `src/store/`.

## Pre-configured client

`src/auth0.ts` exports `serverClient` (a `ServerClient`) and `appBaseUrl`. Import them:

```ts
import { serverClient, appBaseUrl } from './auth0.js';
import { isMfaRequiredError } from '@auth0/auth0-server-js';
```

## The /transfers route already calls getAccessToken

`src/index.ts` already has:

```ts
app.post('/transfers', async (request, response) => {
  const tokenSet = await serverClient.getAccessToken({ request, response });
  // ...
});
```

`getAccessToken` throws `MfaRequiredError` when MFA is required. Wrap it in try/catch and handle MFA — do not replace the existing call.

## Store options

Always pass `{ request, response }` as the store options object for all SDK calls.

## mfa_token cookie handoff

```ts
// After catching MfaRequiredError
response.cookie('_mfa_token', err.cause.mfa_token, { httpOnly: true, sameSite: 'lax', maxAge: 300000 });
// On the MFA challenge/verify handler
const mfaToken = request.cookies['_mfa_token'];
response.clearCookie('_mfa_token');
```

## Branch on listAuthenticators before calling verify

Always call `listAuthenticators` first and branch:
- No enrolled authenticators → call `enrollAuthenticator` first, then `verify`
- Enrolled authenticators → call `challengeAuthenticator` (for SMS/OOB), then `verify`

For SMS: challengeAuthenticator first, then verify with the bindingCode the user entered.

## verify: store options go as the second argument

```ts
// Correct — storeOptions is the second argument
await serverClient.mfa.verify(
  { mfaToken, factorType: 'otp', otp },
  { request, response }
);

// Wrong — do not put request/response inside the first options object
await serverClient.mfa.verify({ mfaToken, factorType: 'otp', otp, request, response });
```

## No spelunking

Do not read `node_modules` to verify types. All method signatures are in the skill reference doc (`auth0-server-js.md`). The types you need:

- `isMfaRequiredError(err)` — type guard, import from `@auth0/auth0-server-js`
- `err.cause.mfa_token: string` — the MFA token
- `serverClient.mfa.listAuthenticators({ mfaToken })` → `Authenticator[]`
- `serverClient.mfa.enrollAuthenticator({ mfaToken, authenticatorTypes, oobChannels? })` → enrollment response
- `serverClient.mfa.challengeAuthenticator({ mfaToken, challengeType, authenticatorId })` → `{ oobCode }`
- `serverClient.mfa.verify({ mfaToken, factorType, otp? | oobCode? | recoveryCode? }, { request, response })`
