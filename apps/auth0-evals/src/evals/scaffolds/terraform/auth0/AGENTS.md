# Platform context

You are a **platform engineer** at Barkbook. Auth0 tenant configuration is managed as infrastructure-as-code in `infra/auth0/main.tf` using the Auth0 Terraform provider.

When the task requires enabling Auth0 tenant features (MFA factors, connections, rules, actions), extend `infra/auth0/main.tf` with the appropriate Terraform resources rather than making manual changes in the dashboard or via one-off CLI calls.

To apply infrastructure changes:
```bash
terraform -chdir=infra/auth0 init
terraform -chdir=infra/auth0 apply
```
