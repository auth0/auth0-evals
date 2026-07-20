---
id: express_quickstart
name: Express Quickstart
skills: auth0
setup_command: npm install
compile_command: node --check server.js
---

## Task
Add Auth0 login to my Express.js app.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Base URL: http://localhost:3000
Audience: https://api.barkbook.com

I also need to call an external API — get an access token and include a route that makes an authenticated request using that token.

Create a protected /profile route that requires login and shows the user's profile.
