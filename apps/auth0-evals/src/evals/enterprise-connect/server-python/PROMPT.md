---
id: server_python_enterprise_connect
name: Python (auth0-server-python) Enterprise Connect Relay Login
skills: auth0
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
compile_command: .venv/bin/python -m compileall -q -x .venv .
---

## System

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_b2b_client_abc123
Client Secret: barkbook_b2b_secret_def456
Base URL: http://localhost:3000
Allowed Callback URLs: http://localhost:3000/auth/callback
Allowed Logout URLs: http://localhost:3000/signin

There is a `.env.example` in the project — create the real `.env` from it with the values above.

## Task

I want to integrate Auth0 Enterprise Connect into my FastAPI app. Users should enter their work email first and sign in through their company's identity provider; everyone else keeps using the existing `/signin` login.
