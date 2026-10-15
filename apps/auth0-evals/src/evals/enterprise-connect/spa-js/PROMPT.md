---
id: spa_js_enterprise_connect
name: SPA JS (@auth0/auth0-spa-js) Enterprise Connect Login
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task

Barkbook is our vanilla JavaScript single-page app. It has its own email + password sign-in at `/signin`, backed by our own API and session (`src/api.js`), and `/dashboard` is only for signed-in users. We don't use Auth0 for login today. `@auth0/auth0-spa-js` is installed but not wired up yet.

We are onboarding B2B enterprise customers who each bring their own identity provider, so we're adding Auth0 Enterprise Connect. We have already created a B2B Connect integration in the Auth0 Dashboard, and its domain and client ID are in `.env.example` (copy them into `.env`).

Put an enterprise sign-in in front of our existing login. A user enters their work email first:

- If the email domain belongs to an enterprise customer, send them through Auth0 to their company's identity provider and bring them back signed in, so they can use `/dashboard`.
- Otherwise, they continue to our existing password sign-in at `/signin`, which must keep working exactly as it does today. Pre-fill their email there.

Signing out of an enterprise account should also end the session at the enterprise identity provider.

The B2B Connect integration has these URLs registered:

- Allowed Callback URLs and Allowed Web Origins: `http://localhost:3000`
- Allowed Logout URLs: `http://localhost:3000/signin`
