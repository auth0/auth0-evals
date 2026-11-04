---
id: react_native_custom_token_exchange
name: React Native Custom Token Exchange
scaffold: src/evals/scaffolds/react-native/auth0
skills: auth0
setup_command: npm install
compile_command: npm run typecheck
---

## Task

My React Native app already has Auth0 login working through `Auth0Provider` and the `useAuth0()` hook
(see `App.tsx`). We also integrate with a partner identity provider that hands the app its own
short-lived token for a user who is already signed in on the partner's side. Instead of sending those
users through a second interactive login, we want to trade that partner token for Auth0 credentials and
have the app treat the user as signed in.

Our tenant is already set up to accept these partner tokens: the token type is
`urn:barkbook:external-idp-token`.

Add a "Continue with Partner" button to the home screen that takes a partner token the app already
holds and exchanges it for Auth0 credentials, so the user ends up signed in the same way a normal login
leaves them. Assume the partner token is available as a string variable.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com
