# server-python scaffold — agent guidance

## Scope

Edit only `app.py`. `auth0_client.py`, `http_helpers.py`, and `stores.py` are pre-configured and correct — do not modify them.

Import the ready-made client and call MFA methods on it; do not create a new `ServerClient`:

```python
from auth0_client import auth0
```

Build store options with the `_opts(req, res)` helper already defined in `app.py` — do not assemble the dict yourself.

## No spelunking

Do not read site-packages, run `pip show`, or `python -c "import ..."` to explore the SDK. The auth0-server-python MFA surface — method signatures, the mfa_token cookie handoff, the scaffold's set_cookie helper, and version support — is documented in the auth0-server-python skill reference. Trust it and build from it.
