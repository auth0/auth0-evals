---
id: auth0_cli_b2b_org_setup
name: Auth0 CLI B2B Organization Setup
skills: auth0
---

## Task

You are working in a shell that is already authenticated to an Auth0 tenant
through the `auth0` CLI (a prior `auth0 login` has run, and the tenant is the
active one). Do not run `auth0 login` yourself, and do not hardcode any
domain, client ID, or secret.

Your job is to configure a realistic **B2B (multi-tenant, organizations)** setup
for a fictional SaaS product called **Smoke**, using only the `auth0` CLI. Work
out the commands yourself. Run everything non-interactively (no interactive
prompts should block you). If a command errors, read the message and adjust.
Never print or store any client secret.

Configure the following end state. Every named value below is a hard
requirement; get the names, identifiers, scopes, and URLs exactly right.

1. **A protected API** named `Smoke API`, identifier `https://smoke.example.com`,
   exposing the scopes `read:reports`, `write:reports`, and `manage:members`.

2. **Two roles**, each granted permissions from that API:
   - `Org Admin` with `read:reports`, `write:reports`, and `manage:members`
   - `Org Member` with `read:reports`

3. **Two applications**:
   - `Smoke Portal`, a Regular Web Application with callback URL
     `http://localhost:3000/callback` and logout URL `http://localhost:3000`.
   - `Smoke Automation`, a Machine-to-Machine application.

4. **A machine-to-machine authorization** so that `Smoke Automation` is allowed
   to call `Smoke API` with the scopes `read:reports` and `manage:members`.

5. **Two customer organizations**:
   - `acme` with display name `Acme Inc`
   - `globex` with display name `Globex Corp`

6. **A login connection enabled on both organizations**, so members of each org
   can authenticate. Use a database connection for this (reuse an existing one
   if the tenant already has it, otherwise create one).

7. **An invitation** for an administrator into the `acme` organization: invitee
   email `admin@acme.example.com`, granted the `Org Admin` role, using
   `Smoke Portal` as the application, and without sending a real email.

8. **Verify** your work by listing/showing the tenant's applications, APIs,
   roles, and organizations, and confirm everything above is present and wired
   together.

9. **Write a manifest.** Using your file-writing tool (create the file directly,
   do not use a shell redirect), write `smoke-b2b-manifest.json` in the current
   working directory. It must be a single JSON object with the real values you
   captured, shaped exactly like this (copy IDs verbatim, never include a
   secret):

   ```json
   {
     "api": {
       "id": "...",
       "identifier": "https://smoke.example.com",
       "scopes": ["read:reports", "write:reports", "manage:members"]
     },
     "roles": {
       "admin":  { "id": "...", "name": "Org Admin",  "permissions": ["read:reports", "write:reports", "manage:members"] },
       "member": { "id": "...", "name": "Org Member", "permissions": ["read:reports"] }
     },
     "apps": {
       "portal":     { "client_id": "...", "name": "Smoke Portal",     "type": "regular_web" },
       "automation": { "client_id": "...", "name": "Smoke Automation", "type": "non_interactive" }
     },
     "m2m_grant": { "id": "...", "audience": "https://smoke.example.com", "scope": ["read:reports", "manage:members"] },
     "connection": { "id": "...", "name": "..." },
     "organizations": {
       "acme":   { "id": "...", "name": "acme",   "display_name": "Acme Inc",    "enabled_connection_id": "..." },
       "globex": { "id": "...", "name": "globex", "display_name": "Globex Corp", "enabled_connection_id": "..." }
     },
     "invitation": { "id": "...", "org": "acme", "invitee_email": "admin@acme.example.com", "role": "Org Admin" }
   }
   ```

   Copy real field values from the CLI output; do not invent or reformat them,
   and do not include any client secret.
