---
id: hosted_mcp_complete_developer_onboarding
name: Hosted MCP - Complete Developer Onboarding
category: hosted-mcp
---

## Task

I need to onboard a new service into my Auth0 tenant. Please set everything up in order:

1. Create an API (resource server) with:
   - Name: **Notifications Service**
   - Identifier: `https://api.notifications.example.com`
   - Scope: `send:notifications` with description "Send notifications"

2. Create a Machine to Machine application named **Notifications Worker**

3. Authorize **Notifications Worker** to call **Notifications Service** with the `send:notifications` scope

4. Create a Post-Login action named **Log Notification Events** with this code:
   ```javascript
   exports.onExecutePostLogin = async (event, api) => {
     api.idToken.setCustomClaim('notification_enabled', true);
   };
   ```

5. Deploy the **Log Notification Events** action

Confirm back with the Client ID of the Notifications Worker and the action ID.
