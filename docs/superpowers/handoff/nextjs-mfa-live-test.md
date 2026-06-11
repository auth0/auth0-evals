# Manual live-test: Next.js MFA step-up

Use this after generating an app with:

```bash
npm run evals -- --eval nextjs_mfa --mode agent --tools skills --model claude-sonnet-4-6 --keep-workspace
```

## 1. Auth0 tenant configuration

- [ ] **Application**: a Regular Web Application. Note its Domain, Client ID, Client Secret.
- [ ] **Allowed Callback URLs**: `http://localhost:3000/auth/callback`
- [ ] **Allowed Logout URLs**: `http://localhost:3000`
- [ ] **API**: an API with identifier (audience) `https://api.barkbook.com` (or your own — update the eval/app accordingly).
- [ ] **MFA factors**: enable at least one factor (e.g. One-Time Password / TOTP) under
      Security → Multi-factor Auth, and enroll your test user.
- [ ] **Tenant MFA policy**: set to **Adaptive** or **Never** (NOT "Always" — that blocks the
      background refresh the SDK relies on).
- [ ] **Post-login Action** that enforces MFA only when the protected audience is requested.
      Without this, `getAccessToken` succeeds and step-up never triggers. Example:

```js
exports.onExecutePostLogin = async (event, api) => {
  const audience = event.request?.query?.audience || event.resource_server?.identifier;
  const protectedApi = 'https://api.barkbook.com';
  if (audience === protectedApi) {
    const enrolled = (event.user.multifactor || []).length > 0;
    if (enrolled) {
      api.authentication.challengeWithAny([{ type: 'otp' }]);
    } else {
      api.authentication.enrollWithAny([{ type: 'otp' }]);
    }
  }
};
```

Attach the Action to the **Login** flow.

## 2. Fill in env vars

In the kept workspace, edit `.env.local`:

- [ ] `AUTH0_DOMAIN` = your tenant domain (e.g. `your-tenant.us.auth0.com`)
- [ ] `AUTH0_CLIENT_ID` = your app's Client ID
- [ ] `AUTH0_CLIENT_SECRET` = your app's Client Secret
- [ ] `AUTH0_SECRET` = output of `openssl rand -hex 32`
- [ ] `APP_BASE_URL` = `http://localhost:3000`

## 3. Run and verify

- [ ] `npm install` (if not already), then `npm run dev`.
- [ ] Visit `http://localhost:3000`, log in.
- [ ] Trigger the Transfer Funds action.
- [ ] Expect a **popup** (Auth0 Universal Login MFA), not a full-page redirect.
- [ ] Complete the MFA challenge in the popup; it closes automatically.
- [ ] The transfer completes after MFA.
- [ ] Confirm in browser devtools that the access token for `https://api.barkbook.com` is
      **never** present in any client-side network response, JS variable, or storage — the
      token call happens server-side only.
