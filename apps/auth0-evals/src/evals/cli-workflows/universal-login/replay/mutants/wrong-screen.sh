# Changes the heading on the classic login screen, which identifier-first does not show.
# The new title is picked to differ from the current one, so the screen text changes on any tenant.
# breaks: Email screen heading is "Sign in to Acme"
# breaks: Password and classic login screen text was not modified
# breaks: Updated the email screen text with `auth0 universal-login prompts update`
auth0 api patch prompts --data '{"identifier_first":true}'

auth0 ul prompts update login --data "$(auth0 api get prompts/login/custom-text/en | jq -c '.login.title = (if .login.title == "Sign in to Acme" then "Log in to Acme" else "Sign in to Acme" end)')"

auth0 api get "branding/themes/$SEED_THEME_ID" | jq -c '.colors.primary_button = "#0B5FFF" | del(.themeId)' > theme.json

auth0 api patch "branding/themes/$SEED_THEME_ID" --data @theme.json
