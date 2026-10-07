# Switches the tenant to the classic login experience along with identifier-first.
# breaks: Other login experience settings were not modified
auth0 api patch prompts --data '{"identifier_first":true,"universal_login_experience":"classic"}'

auth0 ul prompts update login-id --data "$(auth0 api get prompts/login-id/custom-text/en | jq -c '.["login-id"].title = "Sign in to Acme"')"

auth0 api get "branding/themes/$SEED_THEME_ID" | jq -c '.colors.primary_button = "#0B5FFF" | del(.themeId)' > theme.json

auth0 api patch "branding/themes/$SEED_THEME_ID" --data @theme.json
