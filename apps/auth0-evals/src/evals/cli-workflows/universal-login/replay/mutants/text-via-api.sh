# Writes the merged custom text with a raw API call instead of the typed command.
# breaks: Updated the email screen text with `auth0 universal-login prompts update`
auth0 api patch prompts --data '{"identifier_first":true}'

auth0 api get prompts/login-id/custom-text/en | jq -c '.["login-id"].title = "Sign in to Acme"' > text.json

auth0 api put prompts/login-id/custom-text/en --data @text.json

auth0 api get "branding/themes/$SEED_THEME_ID" | jq -c '.colors.primary_button = "#0B5FFF" | del(.themeId)' > theme.json

auth0 api patch "branding/themes/$SEED_THEME_ID" --data @theme.json
