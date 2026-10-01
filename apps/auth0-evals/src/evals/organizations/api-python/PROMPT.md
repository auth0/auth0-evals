---
id: api_python_organizations
name: Python API (auth0-api-python) Organizations
scaffold: src/evals/scaffolds/api-python/auth0
skills: auth0
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
compile_command: .venv/bin/python -m compileall -q -x .venv .
---

## Task

My Python API is already protected with `auth0-api-python`. Add Auth0 Organizations support:

1. Restrict `GET /api/org/members` to users in the "Acme" org (`org_barkbook_acme`)
2. Add `GET /api/org/profile` that returns the organization the signed-in user belongs to

Domain: dev-barkbook.us.auth0.com
Audience: https://api.barkbook.com
