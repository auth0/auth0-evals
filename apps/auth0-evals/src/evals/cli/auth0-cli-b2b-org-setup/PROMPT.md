---
id: auth0_cli_b2b_org_setup
name: Auth0 CLI B2B Organization Setup
skills: auth0
provision: auth0-tenant
---

## Task

Configure a B2B (organizations) setup for a SaaS product called **Smoke**, Every name, identifier,
and scope below is exact.

- **API** `Smoke API`, identifier `https://smoke.example.com`, scopes
  `read:reports`, `write:reports`, `manage:members`.
- **Roles** `Org Admin` holding all three scopes, and `Org Member` holding
  `read:reports`.
- **Apps** `Smoke Portal`, a Regular Web Application with callback
  `http://localhost:3000/callback` and logout `http://localhost:3000`; and
  `Smoke Automation`, a Machine-to-Machine application.
- **M2M authorization** letting `Smoke Automation` call `Smoke API` with
  `read:reports` and `manage:members`.
- **Organizations** `acme` displayed as `Acme Inc`, and `globex` displayed as
  `Globex Corp`, each with a database login connection enabled so its members
  can authenticate. Reuse an existing connection or create one.
- **Invitation** into `acme` for `admin@acme.example.com` with the `Org Admin`
  role, through `Smoke Portal`, without sending a real email.

Read the end state back from the tenant to confirm it, then record it as
`smoke-b2b-manifest.json` in the working directory. Copy real values verbatim and
keep this shape:

```json
{
  "api": { "id": "…", "identifier": "…", "scopes": ["…"] },
  "roles": {
    "admin": { "id": "…", "name": "…", "permissions": ["…"] },
    "member": { "id": "…", "name": "…", "permissions": ["…"] }
  },
  "apps": {
    "portal": { "client_id": "…", "name": "…", "type": "regular_web" },
    "automation": { "client_id": "…", "name": "…", "type": "non_interactive" }
  },
  "m2m_grant": { "id": "…", "audience": "…", "scope": ["…"] },
  "connection": { "id": "…", "name": "…" },
  "organizations": {
    "acme": { "id": "…", "name": "…", "display_name": "…", "enabled_connection_id": "…" },
    "globex": { "id": "…", "name": "…", "display_name": "…", "enabled_connection_id": "…" }
  },
  "invitation": { "id": "…", "org": "…", "invitee_email": "…", "role": "…" }
}
```
