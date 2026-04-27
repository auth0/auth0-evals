---
skills: auth0-nuxt
setup_command: npm install
---

## Task
Add Auth0 authentication to a Nuxt application using the @auth0/auth0-nuxt SDK.

Domain: dev-playground.us.auth0.com
Client ID: playground_client_abc123xyz
Client Secret: playground_secret_def456uvw

Set up the Auth0 module in nuxt.config.ts, implement login and logout, display the authenticated user's name and profile picture, and protect a /profile route so only logged-in users can access it.

Also get an Access Token to call an external API with audience https://api.playground.com and include a function that makes an authenticated API request using that token.

Do not prompt for permissions to create any .env or .env.local files.
