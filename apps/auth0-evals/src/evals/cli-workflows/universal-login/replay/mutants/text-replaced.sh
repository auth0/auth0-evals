# Sends only the new title, which replaces the rest of the email screen text.
# breaks: Other email screen text was kept
auth0 api patch prompts --data '{"identifier_first":true}'

auth0 ul prompts update login-id --data '{"login-id":{"title":"Sign in to Acme"}}'

auth0 api get "branding/themes/$SEED_THEME_ID" | jq -c '.colors.primary_button = "#0B5FFF" | del(.themeId)' > theme.json

auth0 api patch "branding/themes/$SEED_THEME_ID" --data @theme.json
