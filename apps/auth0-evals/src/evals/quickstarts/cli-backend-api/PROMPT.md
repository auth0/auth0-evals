---
id: backend_api_cli_quickstart
name: Backend API Quickstart Setup (CLI)
skills: auth0
provision: auth0-tenant
---

## Task

We're starting a Backend API quickstart (an Express API that validates Auth0 access tokens) and need the Auth0 side set up first.

Register a new API in Auth0 so our backend can accept and validate access tokens issued for it. Use `https://quickstart-api.example.com` as the API identifier (audience) and name it `Quickstart API`. The API exposes two permissions that clients can request: `read:messages` and `write:messages`.
