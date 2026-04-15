---
skills: auth0-spa-js
---

## Task
Add Auth0 authentication to a plain JavaScript single-page application.

Domain: dev-playground.us.auth0.com
Client ID: playground_client_abc123xyz
Audience: https://api.playground.com

- Display the authenticated user's name and email when logged in
- Get an access token silently using getTokenSilently and include a function that makes an authenticated fetch request to https://api.playground.com/data using that token as a Bearer token in the Authorization header
