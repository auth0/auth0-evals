---
id: server_python_enterprise_connect
name: Python (auth0-server-python) Enterprise Connect Relay Login
skills: auth0
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
compile_command: .venv/bin/python -m compileall -q -x .venv .
---

## Task

Barkbook is our FastAPI web app. It has its own email + password sign-in at `/signin` and its own signed session cookie: `/dashboard` is only for signed-in users, and `/signout` signs them out. We don't use Auth0 for login today. `auth0-server-python` is installed but not wired up yet.

We are onboarding B2B enterprise customers who each bring their own identity provider, so we're adding Auth0 Enterprise Connect. We have already created a B2B Connect integration in the Auth0 Dashboard, and its credentials are in `.env.example` (copy them into `.env`).

Put an enterprise sign-in in front of our existing login. A user enters their work email first:

- If the email domain belongs to an enterprise customer, send them through Auth0 to their company's identity provider and bring them back signed in to Barkbook on `/dashboard`.
- Otherwise, they continue to our existing password sign-in at `/signin`, which must keep working exactly as it does today. Pre-fill their email there.

Signing out of an enterprise account should also end the session at the enterprise identity provider.

The B2B Connect integration has these URLs registered:

- Allowed Callback URLs: `http://localhost:3000/auth/callback`
- Allowed Logout URLs: `http://localhost:3000/signin`
