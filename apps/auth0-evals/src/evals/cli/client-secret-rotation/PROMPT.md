---
id: cli_client_secret_rotation
name: Client Secret Rotation (CLI)
category: cli
skills: auth0
provision: auth0-tenant
---

## Task

We rotate credentials whenever someone with access to them leaves the team. A confidential backend service on this tenant needs its client secret rotated as part of offboarding.

Using the Auth0 CLI:

- Create a confidential Regular Web Application named exactly `Backend Service`.
- Rotate that application's client secret so the secret value generated when the app was created is no longer valid.

Handle the secret safely: do not write it to any file, commit it, or otherwise persist it into an artifact that outlives this task.
