"""Pre-configured auth0-api-python client — a confidential client (client_id +
client_secret) so it can both verify inbound access tokens and perform token
exchange. Import and use this; do not construct another ApiClient."""

import os

from auth0_api_python import ApiClient, ApiClientOptions

api_client = ApiClient(
    ApiClientOptions(
        domain=os.environ["AUTH0_DOMAIN"],
        audience=os.environ["AUTH0_AUDIENCE"],
        client_id=os.environ["AUTH0_CLIENT_ID"],
        client_secret=os.environ["AUTH0_CLIENT_SECRET"],
    )
)
