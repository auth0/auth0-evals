---
id: hosted_mcp_setup_spa_with_api
name: Hosted MCP - Set Up SPA with API Access
category: hosted-mcp
---

## Task

I need to set up a complete web application integration in my Auth0 tenant. Please do the following in order:

1. Create a new API with:
   - Name: **Analytics Service**
   - Identifier (audience): `https://api.analytics.example.com`
   - A scope named `read:analytics` with description "Read analytics data"

2. Create a Single Page Application named **Analytics Dashboard**

3. Authorize the **Analytics Dashboard** to call the **Analytics Service** API with the `read:analytics` scope

4. Update the **Analytics Dashboard** application to add `https://analytics.example.com/callback` as an allowed callback URL

Confirm back with the Client ID of the Analytics Dashboard and the audience of the Analytics Service.
