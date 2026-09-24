---
id: regular_web_cli_quickstart
name: Regular Web App Quickstart Setup (CLI)
skills: auth0
provision: auth0-tenant
---

## Task

We're starting a Regular Web Application quickstart (a server-rendered Express app) and need the Auth0 side set up first, using the Auth0 CLI.

Create a new Auth0 application for this web app. It runs locally during development at `http://localhost:3000`. After login, Auth0 should redirect back to `http://localhost:3000/callback`, and after logout it should return to `http://localhost:3000`.

Configure the application so it is ready to use for the quickstart. Name it `Quickstart Web App`.

Do not use the Auth0 dashboard or Terraform. Use only the Auth0 CLI. Run commands non-interactively and never print or store secrets.
