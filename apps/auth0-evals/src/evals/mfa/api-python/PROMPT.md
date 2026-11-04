---
id: api_python_mfa
name: Python API (auth0-api-python) MFA Step-Up
scaffold: src/evals/mfa/api-python/scaffold
skills: auth0
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
compile_command: .venv/bin/python -m py_compile server.py
---

## System

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com

There is a `.env.example` in the project — create the real `.env` from it with the values above.

## Task

My Python API validates Auth0 JWT access tokens with `auth0-api-python`. Transfers are a high-value action, so my tenant is configured to issue the `transfer:funds` scope only after the user completes MFA step-up. The API does not run MFA itself — its job is to enforce that only stepped-up callers can transfer, by requiring that scope.

Requirements:
- Gate `POST /api/transfers` on the `transfer:funds` scope so that a caller whose token lacks it is rejected with a 403. This is the step-up gate.
- Keep the existing `write:transfers` scope check on `POST /api/transfers`.
- Keep the existing `read:balance` scope check on `GET /api/balance` working.
