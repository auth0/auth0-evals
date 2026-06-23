---
id: hosted_mcp_update_action_code
name: Hosted MCP - Update Action Code
category: hosted-mcp
---

## Task

The **Add Roles to Token** action in my Auth0 tenant needs its code updated.

Please:
1. Find the **Add Roles to Token** action
2. Update its code to also add a `permissions` claim to the ID token using `event.authorization.permissions`

The updated code should still add `roles` as before, and now also add `permissions`. Keep the same trigger and other settings.

Confirm back with the action ID once updated.
