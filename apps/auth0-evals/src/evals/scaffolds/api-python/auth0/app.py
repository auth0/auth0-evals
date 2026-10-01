"""Minimal Auth0-protected API using auth0-api-python.

Base auth is already working: `verify_token` validates an incoming Auth0 access
token and returns its claims. The `/api/balance` handler reads the `sub` claim
from the verified token. Domain and audience are read from the environment.
"""

import os

from auth0_api_python import ApiClient, ApiClientOptions

api_client = ApiClient(
    ApiClientOptions(
        domain=os.environ["AUTH0_DOMAIN"],
        audience=os.environ["AUTH0_AUDIENCE"],
    )
)


async def verify_token(access_token: str) -> dict:
    """Validate an Auth0 access token and return its claims."""
    return await api_client.verify_access_token(access_token=access_token)


async def balance(access_token: str) -> dict:
    """A protected endpoint: requires a valid Auth0 access token."""
    claims = await verify_token(access_token)
    return {"balance": 4200, "sub": claims["sub"]}
