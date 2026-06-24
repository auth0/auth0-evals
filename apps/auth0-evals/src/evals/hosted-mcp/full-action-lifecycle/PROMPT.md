---
id: hosted_mcp_full_action_lifecycle
name: Hosted MCP - Full Action Lifecycle
category: hosted-mcp
---

## Task

I need a brand new Post-Login action set up and ready to go in my Auth0 tenant.

Please:
1. Create an action named **Enrich Token** that runs on the `post-login` trigger with this code:
   ```javascript
   exports.onExecutePostLogin = async (event, api) => {
     api.idToken.setCustomClaim('tenant', event.tenant.id);
   };
   ```
2. Update the action code to also add the user's email as a claim: `api.idToken.setCustomClaim('email', event.user.email)`
3. Deploy the action so it is active

Confirm back with the action ID and its deployed status.
