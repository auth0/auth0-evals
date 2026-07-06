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

variable "auth0_domain" {}
variable "auth0_client_id" {}
variable "auth0_client_secret" {
  sensitive = true
}

resource "auth0_client" "app" {
  name     = "Barkbook App"
  app_type = "spa"
  callbacks = [
    "http://localhost:5173",
  ]
  allowed_logout_urls = [
    "http://localhost:5173",
  ]
  web_origins = [
    "http://localhost:5173",
  ]
}

resource "auth0_resource_server" "api" {
  name       = "Barkbook API"
  identifier = "https://api.barkbook.com"
}
