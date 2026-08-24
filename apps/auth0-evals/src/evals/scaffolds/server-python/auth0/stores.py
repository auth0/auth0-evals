"""Cookie-backed session and transaction stores."""

from auth0_server_python.store import StateStore, TransactionStore


class _CookieStore:
    async def set(self, identifier, state, remove_if_expires=False, options=None):
        _require(options, "response").set_cookie(
            self.cookie_name, self.encrypt(identifier, state), max_age=self.max_age
        )

    async def get(self, identifier, options=None):
        raw = _require(options, "request").cookies.get(self.cookie_name)
        return self.decrypt(identifier, raw) if raw else None

    async def delete(self, identifier, options=None):
        _require(options, "response").delete_cookie(self.cookie_name)


class CookieTransactionStore(_CookieStore, TransactionStore):
    max_age = 600

    def __init__(self, secret, cookie_name="_a0_tx"):
        super().__init__({"secret": secret})
        self.cookie_name = cookie_name


class CookieStateStore(_CookieStore, StateStore):
    max_age = 86400

    def __init__(self, secret, cookie_name="_a0_session"):
        super().__init__({"secret": secret})
        self.cookie_name = cookie_name

    async def delete_by_logout_token(self, claims, options=None):
        return None


def _require(options, key):
    if not options or key not in options:
        raise ValueError(f"store_options['{key}'] is required")
    return options[key]
