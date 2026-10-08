---
id: swift_custom_token_exchange
name: Swift Custom Token Exchange
scaffold: src/evals/scaffolds/swift/auth0
skills: auth0
---

## Task

My iOS app already has Auth0 login working through Universal Login. We also integrate with a partner
identity provider that hands the app its own short-lived token for an already-signed-in user. Instead
of sending those users through a second interactive login, we want to trade that partner token for
Auth0 credentials and store them the usual way, so the app treats the user as signed in.

Our tenant is already set up to accept these partner tokens: the token type is
`urn:barkbook:external-idp-token`. Add a "Continue with Partner" flow that takes the partner token the
app already holds and signs the user in with it.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
