---
id: server_python_token_vault
name: Python (auth0-server-python) Token Vault — Google Calendar
scaffold: src/evals/scaffolds/server-python/auth0
skills: auth0
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
compile_command: .venv/bin/python -m compileall -q -x .venv .
---

## System

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Base URL: http://localhost:8000
Audience: https://api.barkbook.com

The tenant is already configured: Token Vault is enabled for the `google-oauth2` connection (Connected Accounts, offline access), and the application is allowed to perform the Token Vault exchange.

## Task

My Python web app already has Auth0 login set up using the `auth0-server-python` SDK. I want signed-in users to see their upcoming Google Calendar events. Add a "Connect Google Calendar" action that lets a signed-in user connect their Google account (connection `google-oauth2`) through Auth0 Token Vault and brings them back to the app, then add a `/calendar` route that returns that user's upcoming events from `https://www.googleapis.com/calendar/v3/calendars/primary/events`. The app itself shouldn't store any Google tokens.
