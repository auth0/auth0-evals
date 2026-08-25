---
id: cli_log_security_review
name: Log Review & Security Hardening (CLI)
category: cli
skills: auth0
provision: auth0-tenant
---

## Task

We are doing a routine security pass on this tenant before launch.

Using the Auth0 CLI, review and then harden:

- Pull the tenant's recent authentication logs to understand what sign-in activity is happening (for example the event types present, and whether there are any failed-login events).
- Then make sure the tenant's attack-protection defenses are actively turned on. At minimum, brute-force protection and suspicious IP throttling must be enabled, not left off.

Do the log review first, then apply the hardening based on it.
