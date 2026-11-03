---
id: angular_enterprise_connect
name: Angular (@auth0/auth0-angular) Enterprise Connect Login
skills: auth0
setup_command: npm install
compile_command: npm run build
---

## System

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_b2b_client_abc123
Allowed Callback URLs and Web Origins: http://localhost:3000
Allowed Logout URLs: http://localhost:3000/signin

Put the domain and client ID in `src/environments/environment.ts`.

## Task

I want to integrate Auth0 Enterprise Connect into my Angular app. Users should enter their work email first and sign in through their company's identity provider; everyone else keeps using the existing `/signin` login.
