---
id: hosted_mcp_create_and_deploy_action
name: Hosted MCP - Create and Deploy Action
category: hosted-mcp
---

## Task

I need a Post-Login action in my Auth0 tenant that adds the user's roles to the ID token.

Domain: mcptesttenant.tus.auth0.com

Please:
1. Create an action named **Add Roles to Token** that runs on the `post-login` trigger and adds a `roles` claim to the ID token using `event.authorization.roles`
2. Deploy the action so it is active

Confirm back with the action ID once it is deployed.
