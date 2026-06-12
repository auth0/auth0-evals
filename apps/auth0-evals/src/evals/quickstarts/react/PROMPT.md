---
id: react_quickstart
name: React Quickstart
scaffold: src/evals/scaffolds/react/basic
skills: auth0-react
setup_command: npm install
serve_command: npm run dev
serve_port: 5173
runtime_swap: dev-barkbook.us.auth0.com=$RUNTIME_AUTH0_DOMAIN, barkbook_client_abc123xyz=$RUNTIME_AUTH0_CLIENT_ID, https://api.barkbook.com=$RUNTIME_AUTH0_AUDIENCE
---

## Task
Add Auth0 login to my React app.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Audience: https://api.barkbook.com

I also need to call an external API — get an access token and include a function that makes an authenticated request using that token.

For testing, add these attributes to the UI:
- `data-testid="login"` on the login button
- `data-testid="logout"` on the logout button
- `data-testid="profile"` on the element that displays the logged-in user's name
