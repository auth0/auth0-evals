# Renames the tenant to a name that differs from the current one, so the setting changes on any tenant.
# breaks: Tenant settings were not modified
auth0 api patch prompts --data '{"identifier_first":true}'

auth0 ul prompts update login-id --data "$(auth0 api get prompts/login-id/custom-text/en | jq -c '.["login-id"].title = "Sign in to Acme"')"

auth0 api get "branding/themes/$SEED_THEME_ID" | jq -c '.colors.primary_button = "#0B5FFF" | del(.themeId)' > theme.json

auth0 api patch "branding/themes/$SEED_THEME_ID" --data @theme.json

auth0 api patch tenants/settings --data "$(auth0 api get tenants/settings | jq -c '{friendly_name: (if .friendly_name == "Acme Supplier Network" then "Acme Supplier Hub" else "Acme Supplier Network" end)}')"
