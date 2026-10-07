# Writes a full theme body that resets the page background instead of keeping it.
# breaks: Other theme settings were not modified
auth0 api patch prompts --data '{"identifier_first":true}'

auth0 ul prompts update login-id --data "$(auth0 api get prompts/login-id/custom-text/en | jq -c '.["login-id"].title = "Sign in to Acme"')"

auth0 api get "branding/themes/$SEED_THEME_ID" | jq -c '.colors.primary_button = "#0B5FFF" | .page_background.background_color = "#000000" | del(.themeId)' > theme.json

auth0 api patch "branding/themes/$SEED_THEME_ID" --data @theme.json
