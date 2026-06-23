terraform {
  required_providers {
    auth0 = {
      source  = "auth0/auth0"
      version = "~> 1.0"
    }
  }
}

provider "auth0" {
  domain        = var.auth0_domain
  client_id     = var.auth0_client_id
  client_secret = var.auth0_client_secret
}

resource "auth0_tenant" "main" {
  friendly_name = "Meridian Financial"
}

# Token exchange profile stub — extend this for partner integrations
# resource "auth0_action" "cte_validator" {
#   name   = "cte-validator"
#   code   = "exports.onExecuteCustomTokenExchange = async (event, api) => { /* validate subject_token and call api.authentication.setUserByConnection() */ };"
#   deploy = true
#   supported_triggers {
#     id      = "custom-token-exchange"
#     version = "v1"
#   }
# }
#
# resource "auth0_token_exchange_profile" "partner" {
#   name               = "partner-exchange"
#   subject_token_type = "urn:partner:sso-token"
#   action_id          = auth0_action.cte_validator.id
#   type               = "custom_authentication"
# }
