---
id: oidc_client_net_mfa
name: .NET Desktop (Auth0.OidcClient) MFA Step-Up
scaffold: src/evals/scaffolds/oidc-client-net/auth0
skills: auth0
---

## Task

My .NET desktop app signs users in with the Auth0 OIDC client. Transferring funds is a high-value action: even after a normal sign-in, the user must complete MFA step-up right before a transfer runs. Wire up the "Transfer Funds" button so that:

- When the user clicks it, they are prompted to step up with MFA before the transfer proceeds.
- After step-up, confirm from the returned token that MFA actually happened before performing the transfer — if it did not, do not transfer.
- Regular login (the Login button) stays as it is.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com

Fill in the `Auth0` section of `appsettings.json` with the values above.
