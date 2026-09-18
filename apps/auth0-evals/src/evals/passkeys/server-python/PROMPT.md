---
id: server_python_passkeys
name: Python (auth0-server-python) Passkey Sign-Up & Sign-In
scaffold: src/evals/scaffolds/server-python/auth0
skills: auth0
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
compile_command: .venv/bin/python -m compileall -q -x .venv .
---

## Task

My Python web app already has Auth0 login working with the `auth0-server-python` SDK. I want people to use passkeys — Face ID, Touch ID, or their device screen lock — instead of a password. A new visitor should be able to sign up and register a passkey, and a returning user should be able to sign in with theirs. Add both the passkey sign-up and the passkey sign-in options to the app. The tenant and connection are already configured for passkeys.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Base URL: http://localhost:8000
Audience: https://api.barkbook.com
