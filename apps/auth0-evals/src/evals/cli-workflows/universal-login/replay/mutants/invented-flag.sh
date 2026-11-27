# Runs `auth0 ul show` with a flag the CLI does not have, then makes the correct changes.
# breaks: The CLI accepted every command and flag the agent used
auth0 ul show --not-a-flag

auth0 api patch prompts --data '{"identifier_first":true}'

auth0 ul prompts update login-id --data "$(auth0 api get prompts/login-id/custom-text/en | jq -c '.["login-id"].title = "Sign in to Acme"')"

auth0 api get "branding/themes/$SEED_THEME_ID" | jq -c '.colors.primary_button = "#0B5FFF" | del(.themeId)' > theme.json

auth0 api patch "branding/themes/$SEED_THEME_ID" --data @theme.json
