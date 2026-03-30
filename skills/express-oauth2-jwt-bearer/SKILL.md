---
name: express-oauth2-jwt-bearer
description: Use when securing Express.js API endpoints with JWT Bearer token validation, scope/permission checks, or stateless auth - integrates express-oauth2-jwt-bearer for REST APIs receiving access tokens from SPAs, mobile apps, or other clients.
---

# Auth0 Express API Integration

Protect Express.js API endpoints with JWT access token validation using `express-oauth2-jwt-bearer`.

---

## Prerequisites

- Express.js API application
- Auth0 API resource configured (not an Application — must be an API)
- If you don't have Auth0 set up yet, use the `auth0-quickstart` skill first

## When NOT to Use

- **Server-rendered web applications** — Use `express-openid-connect` for session-based login/logout flows
- **Single Page Applications** — Use `auth0-react`, `auth0-vue`, or `auth0-angular` for client-side auth
- **Next.js applications** — Use `auth0-nextjs`
- **Mobile applications** — Use `auth0-react-native`

---

## Quick Start Workflow

### 1. Install SDK

```bash
npm install express-oauth2-jwt-bearer dotenv
```

### 2. Configure Environment

Create `.env`:

```bash
ISSUER_BASE_URL=https://your-tenant.us.auth0.com
AUDIENCE=https://your-api.example.com
```

`ISSUER_BASE_URL` is the full URL of your Auth0 tenant. `AUDIENCE` is the API identifier you set when creating the API resource in Auth0.

### 3. Configure Auth Middleware

```javascript
require('dotenv').config();
const express = require('express');
const { auth, requiredScopes } = require('express-oauth2-jwt-bearer');

const app = express();
app.use(express.json());

// Validate JWT Bearer tokens on every request
app.use(
  auth({
    issuerBaseURL: process.env.ISSUER_BASE_URL,
    audience: process.env.AUDIENCE,
  }),
);
```

Registering `auth()` globally with `app.use()` protects all routes beneath it. Requests without a valid Bearer token receive **401**. Never hardcode the domain or audience — always use environment variables.

### 4. Protect Routes with Scope Checks

```javascript
// Requires the read:messages scope
app.get('/api/messages', requiredScopes('read:messages'), (req, res) => {
  res.json({ messages: [] });
});

// Requires the write:messages scope
app.post('/api/messages', requiredScopes('write:messages'), (req, res) => {
  res.json({ created: true });
});
```

`requiredScopes()` checks the `scope` claim in the JWT. Missing scopes return **403**.

### 5. Access Token Claims

The decoded JWT is available at `req.auth` after the middleware runs:

```javascript
app.get('/api/profile', (req, res) => {
  const { payload } = req.auth;   // decoded JWT claims
  res.json({
    sub: payload.sub,             // user ID
    scope: payload.scope,         // granted scopes
  });
});
```

Key properties:
- `req.auth.payload` — decoded JWT claims (sub, scope, custom claims, etc.)
- `req.auth.token` — raw JWT string
- `req.auth.header` — decoded JWT header

### 6. Test the API

```bash
# No token — expect 401
curl http://localhost:3000/api/messages

# With a valid access token
curl http://localhost:3000/api/messages \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using `express-openid-connect` instead of `express-oauth2-jwt-bearer` | `express-openid-connect` is for session-based web apps; use `express-oauth2-jwt-bearer` for stateless APIs |
| Hardcoding `issuerBaseURL` or `audience` in source | Always read from `process.env` — never embed credentials in code |
| Using `passport` for JWT validation | Not needed; `express-oauth2-jwt-bearer` handles all validation |
| Manually parsing `req.headers.authorization` | The SDK extracts and validates the token automatically — never parse the header yourself |
| Calling `jwt.verify()` manually | The SDK handles verification against the JWKS endpoint — do not verify tokens yourself |
| Accessing `req.user` instead of `req.auth` | This SDK sets `req.auth`, not `req.user` (that's a Passport convention) |
| Checking scopes manually from `req.auth.payload.scope` | Use `requiredScopes()` middleware — it handles the scope check and returns the correct 403 error |
| Created an Application instead of an API in Auth0 | Must create an **API** resource (Applications → APIs) — an Application doesn't issue access tokens with the right audience |

---

## Related Skills

- `auth0-express` — For server-rendered Express web apps with login/logout sessions
- `auth0-fastify-api` — Same pattern for Fastify instead of Express

---

## Quick Reference

**Middleware configuration:**
```javascript
auth({
  issuerBaseURL: process.env.ISSUER_BASE_URL,  // required
  audience: process.env.AUDIENCE,              // required
})
```

**Scope enforcement:**
```javascript
requiredScopes('read:resource')                     // single scope
requiredScopes('read:resource', 'write:resource')   // all scopes required
```

**JWT claims in handlers:**
```javascript
req.auth.payload        // full decoded payload
req.auth.payload.sub    // user/client ID
req.auth.payload.scope  // space-separated scopes
req.auth.token          // raw JWT string
```

**Environment variables:**
- `ISSUER_BASE_URL` — your Auth0 tenant base URL (e.g. `https://tenant.us.auth0.com`)
- `AUDIENCE` — your API identifier (e.g. `https://api.example.com`)

---

## References

- [express-oauth2-jwt-bearer on npm](https://www.npmjs.com/package/express-oauth2-jwt-bearer)
- [Auth0 Express API Quickstart](https://auth0.com/docs/quickstart/backend/nodejs)
- [SDK GitHub Repository](https://github.com/auth0/node-oauth2-jwt-bearer)
