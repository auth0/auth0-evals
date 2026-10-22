---
id: enterprise_connect_cli
name: Enterprise Connect Custom Authorization Server (CLI)
category: enterprise-connect
skills: auth0
provision: auth0-tenant
---

## Task

We run our own OIDC authorization server at `https://auth.barkbook.com` and want to add enterprise SSO for our B2B customers with Auth0 B2B Connect – Enterprise, as a Custom Authorization Server integration. Our server's callback for Auth0 is `https://auth.barkbook.com/oauth2/callback/auth0`.

Then onboard our first customer, Acme Corp (`acme-corp`, display name "Acme Corp"), and give me a setup link their IT admin can use to connect their identity provider. Name the connection `acme-corp-sso`.
