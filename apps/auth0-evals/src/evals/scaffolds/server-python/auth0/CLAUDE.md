# Server-python scaffold — agent guidance

## Scope

**Edit only `app.py`.** Do not modify `stores.py`, `auth0_client.py`, or `http_helpers.py` — they are pre-configured and correct.

## Pre-configured Auth0 client

`auth0_client.py` exports a ready-to-use `ServerClient` instance named `auth0`:

```python
from auth0_client import auth0
```

Call MFA methods as `auth0.mfa.list_authenticators(...)`, `auth0.mfa.enroll_authenticator(...)`, etc. Do not create a new `ServerClient`.

## Store options

Use the `_opts(req, res)` helper already defined in `app.py` — do not build the dict yourself:

```python
store_opts = _opts(req, res)   # {"request": req, "response": res}
```

## mfa_token cookie handoff

The `mfa_token` between requests is a plain httpOnly cookie — it does NOT use the SDK's transaction/state store:

```python
res.set_cookie("_mfa_token", mfa_token, httponly=True, samesite="lax", max_age=300)
mfa_token = req.cookies.get("_mfa_token")   # on the next request
res.delete_cookie("_mfa_token")              # after successful verify
```

## No spelunking

Do not read `site-packages`, run `pip show`, or run `python -c "import ..."` to explore the SDK. All method signatures and return types are in the skill reference doc (`auth0-server-python.md`).
