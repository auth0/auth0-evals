---
id: hosted_mcp_action_and_form_setup
name: Hosted MCP - Action and Form Setup
category: hosted-mcp
---

## Task

I need to set up progressive profiling for my Auth0 tenant. Please do both of the following:

1. Create a Post-Login action named **Trigger Profile Collection** with this code:
   ```javascript
   exports.onExecutePostLogin = async (event, api) => {
     if (!event.user.user_metadata?.profile_complete) {
       api.redirect.sendUserTo('https://profile.example.com/collect');
     }
   };
   ```
   Deploy the action.

2. Create a form named **Profile Collection Form** with two fields:
   - Department (field key: `department`)
   - Location (field key: `location`)

Confirm back with the action ID and form ID.
