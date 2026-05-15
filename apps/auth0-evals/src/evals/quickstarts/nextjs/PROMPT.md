---
id: nextjs_quickstart
name: Next.js App Router Quickstart
skills: auth0-nextjs
setup_command: npm install
---

## Task
Add Auth0 login to my Next.js app using the App Router.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw

The /dashboard page should be behind a login — if the user is not authenticated, redirect them to log in.

Also get an Access Token to call an external API with audience https://api.playground.com and include a function that makes an authenticated API request using that token.

Do not prompt for permissions to create any .env or .env.local files.

