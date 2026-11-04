---
id: auth0_express_enterprise_connect
name: Express (@auth0/auth0-express) Enterprise Connect Relay Login
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## System

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_b2b_client_abc123
Client Secret: barkbook_b2b_secret_def456
Base URL: http://localhost:3000
Allowed Callback URLs: http://localhost:3000/auth/callback
Allowed Logout URLs: http://localhost:3000/signin

There is a `.env.example` in the project — create the real `.env` from it with the values above.

## Task

I want to integrate Auth0 Enterprise Connect into my Express app. Users should enter their work email first and sign in through their company's identity provider; everyone else keeps using the existing `/signin` login.
