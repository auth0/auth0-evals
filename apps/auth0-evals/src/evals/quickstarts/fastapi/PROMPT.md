---
id: fastapi_quickstart
name: FastAPI Quickstart
skills: auth0-fastapi-api
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
---

## Task
Add Auth0 authentication to my FastAPI API.

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

I need two protected routes:
1. /api/messages — requires a valid token with the `read:messages` scope, returns the user's `sub` claim
2. /api/private — requires any valid token, returns the user's `sub` claim

Do not prompt for permissions to create any .env files.

A virtual environment is already set up at `.venv`. Use `.venv/bin/pip` to install packages and update `requirements.txt` with any new dependencies.
