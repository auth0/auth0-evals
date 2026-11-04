# Sets the classic branding accent color, which the theme overrides on the login page.
# breaks: Login button color is #0B5FFF
# breaks: Classic branding settings were not modified
auth0 api patch prompts --data '{"identifier_first":true}'

auth0 ul prompts update login-id --data "$(auth0 api get prompts/login-id/custom-text/en | jq -c '.["login-id"].title = "Sign in to Acme"')"

auth0 ul update --accent "#0B5FFF" --no-input
