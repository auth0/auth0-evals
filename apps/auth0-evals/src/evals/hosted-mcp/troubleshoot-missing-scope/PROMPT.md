---
id: hosted_mcp_troubleshoot_missing_scope
name: Hosted MCP - Troubleshoot Missing Scope
category: hosted-mcp
---

## Task

My **Warehouse Bot** application is supposed to call the **Inventory Service** API with the `read:inventory` scope, but it is not receiving that scope in its tokens.

Please investigate:
1. Find the **Inventory Service** resource server and confirm what scopes it has defined
2. Find the **Warehouse Bot** application and check what grants it has
3. Identify whether the grant exists and includes the `read:inventory` scope

Tell me what you find and whether the configuration looks correct.
