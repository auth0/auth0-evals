---
id: native_cli_quickstart
name: Native App Quickstart Setup (CLI)
skills: auth0
provision: auth0-tenant
---

## Task

We're starting a Native mobile app quickstart and need the Auth0 side set up first, using the Auth0 CLI.

Create a new Auth0 application for this mobile app. The app registers the custom URL scheme `com.example.quickstart`, so login and logout redirects use that scheme (for example `com.example.quickstart://callback`). Register the appropriate callback and logout URLs for this scheme.

Configure the application so it is ready to use for the quickstart. Name it `Quickstart Native`.

Do not use the Auth0 dashboard or Terraform. Use only the Auth0 CLI. Run commands non-interactively and never print or store secrets.
