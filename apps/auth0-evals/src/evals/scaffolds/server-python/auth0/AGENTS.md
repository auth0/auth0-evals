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
res.set_cookie("_mfa_token", mfa_token, max_age=300)   # httponly/samesite are set automatically
mfa_token = req.cookies.get("_mfa_token")               # on the next request
res.delete_cookie("_mfa_token")                         # after successful verify
```

**Do not pass `httponly`, `samesite`, or `secure` to `set_cookie`.** The helper only accepts `(key, value, max_age)` — those flags are always set internally.

## Write app.py completely

When you write `app.py`, always write the **complete file** in a single operation — never write a partial snippet that replaces the existing content. Each Write tool call overwrites the entire file; a partial write destroys everything that came before it.

## Call verify inline — not via a variable

Always pass `mfa_token` directly inside the `verify(...)` call, not through an intermediate variable:

```python
# Correct
result = await auth0.mfa.verify(
    {"mfa_token": mfa_token, "otp": otp_code, "persist": True},
    store_options=store_opts,
)

# Wrong — builds options dict first, then passes variable
options = {"mfa_token": mfa_token, ...}
result = await auth0.mfa.verify(options, ...)
```

## After verify — return success, not raw tokens

After `verify()` succeeds, do **not** return `access_token`, `id_token`, `refresh_token`, or `mfa_token` in the HTTP response. Handlers return a plain dict that the framework serialises to JSON — return a simple success body:

```python
return {"status": "transfer complete"}
```

## No spelunking

Do not read `site-packages`, run `pip show`, or run `python -c "import ..."` to explore the SDK. All method signatures and return types are in the auth0-server-python skill reference.
