"""Auth0 client."""

import os

from auth0_server_python.auth_server.server_client import ServerClient

from stores import CookieStateStore, CookieTransactionStore

AUTH0_SECRET = os.environ["AUTH0_SECRET"]

auth0 = ServerClient(
    domain=os.environ["AUTH0_DOMAIN"],
    client_id=os.environ["AUTH0_CLIENT_ID"],
    client_secret=os.environ["AUTH0_CLIENT_SECRET"],
    secret=AUTH0_SECRET,
    transaction_store=CookieTransactionStore(secret=AUTH0_SECRET),
    state_store=CookieStateStore(secret=AUTH0_SECRET),
    authorization_params={
        "redirect_uri": os.environ["AUTH0_REDIRECT_URI"],
        "audience": os.environ.get("AUTH0_AUDIENCE"),
        "scope": "openid profile email",
    },
)
