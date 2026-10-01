# auth0-api-python scaffold — agent guidance

## Scope

Edit only `app.py`. `auth0_client.py` is pre-configured and correct — do not modify it. Import the
ready-made client and call the exchange method on it; do not construct another `ApiClient`:

```python
from auth0_client import api_client
```

The client is a confidential client (it already holds `client_id` and `client_secret` from the
environment), so it is allowed to authenticate to the token endpoint. You do not need to add a secret
in source — it is already wired through `auth0_client.py`.

## No spelunking

Do not read site-packages, run `pip show`, or `python -c "import ..."` to explore the SDK. The
auth0-api-python token-exchange surface — which method performs a profile exchange versus the
on-behalf-of wrapper, their parameters, the `"Bearer "`-prefix and reserved-`extra` guards, and the
version support — is documented in the auth0-api-python skill reference. Trust it and build from it.
