---
name: React Quickstart
category: quickstarts
task_description: React — Auth0 Authentication Integration
provider_name: Auth0
provider_url: auth0.com
---

Add Auth0 authentication to a React application using the @auth0/auth0-react SDK.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz

Requirements:
- Wrap the app with Auth0Provider configured with domain and clientId
- Add a login button that calls loginWithRedirect()
- Add a logout button that calls logout()
- Display the authenticated user's name and email from the useAuth0 hook
- Protect content so it only shows when the user is authenticated (isAuthenticated)
