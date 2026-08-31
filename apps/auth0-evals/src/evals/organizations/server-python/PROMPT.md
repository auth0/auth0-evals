---
id: server_python_organizations
name: Python (auth0-server-python) Organizations Login
scaffold: src/evals/scaffolds/server-python/auth0
skills: auth0
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
compile_command: .venv/bin/python -m compileall -q -x .venv .
---

## Task

My Python web app already has Auth0 login set up using the `auth0-server-python` SDK. Add Auth0 Organizations support: log users in to our "Acme" org (`org_barkbook_acme`), accept organization invitation links, and show which organization the signed-in user belongs to.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Base URL: http://localhost:8000
Audience: https://api.barkbook.com
