---
id: hosted_mcp_setup_m2m_application
name: Hosted MCP - Set Up M2M Application
category: hosted-mcp
---

## Task

I need to set up a machine-to-machine integration in my Auth0 tenant. Please do the following in order:

1. Create a new API with:
   - Name: **Inventory Service**
   - Identifier (audience): `https://api.inventory.example.com`
   - A scope named `read:inventory` with description "Read inventory data"

2. Create a new Machine to Machine application named **Warehouse Bot**

3. Authorize the **Warehouse Bot** application to call the **Inventory Service** API with the `read:inventory` scope

Domain: mcptesttenant.tus.auth0.com

Confirm back with the Client ID of the Warehouse Bot and the resource server ID of the Inventory Service.
