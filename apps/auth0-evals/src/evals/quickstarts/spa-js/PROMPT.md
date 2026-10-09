---
id: spa_js_quickstart
name: SPA JS Quickstart
displayable_prompt: Add Auth0 login to a plain JavaScript SPA using @auth0/auth0-spa-js, display user profile info, and make authenticated API requests with a silently acquired token.
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## Task
Add Auth0 authentication to a plain JavaScript single-page application.

Domain: dev-playground.us.auth0.com
Client ID: playground_client_abc123xyz
Audience: https://api.playground.com

- Display the authenticated user's name and email when logged in
- Get an access token silently using getTokenSilently and include a function that makes an authenticated fetch request to https://api.playground.com/data using that token as a Bearer token in the Authorization header
