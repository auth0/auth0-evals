---
skills: auth0-express
---

## Task
Add Auth0 authentication to an Express.js application using the express-openid-connect SDK.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Base URL: http://localhost:3000

Also get an Access Token to call an external API with audience https://api.barkbook.com and include a route that makes an authenticated API request using that token.

Create a protected /profile route that requires authentication and displays the logged-in user's profile information.

Do not prompt for permissions to create any .env or .env.local files.
