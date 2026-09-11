"""Cookie-backed session and transaction stores."""

from auth0_server_python.auth_types import TransactionData
from auth0_server_python.store import StateStore, TransactionStore


class _CookieStore:
    async def set(self, identifier, state, remove_if_expires=False, options=None):
        # The SDK hands us Pydantic models (TransactionData/StateData); the
        # encryption layer json.dumps() the payload, so serialise to a plain
        # dict first — a raw model would raise "not JSON serializable".
        data = state.model_dump(mode="json") if hasattr(state, "model_dump") else state
        _require(options, "response").set_cookie(
            self.cookie_name, self.encrypt(identifier, data), max_age=self.max_age
        )

    async def get(self, identifier, options=None):
        raw = _require(options, "request").cookies.get(self.cookie_name)
        return self._deserialize(self.decrypt(identifier, raw)) if raw else None

    async def delete(self, identifier, options=None):
        _require(options, "response").delete_cookie(self.cookie_name)

    def _deserialize(self, data):
        # Session/state data is consumed dict-first by the SDK, so leave it as-is.
        return data


class CookieTransactionStore(_CookieStore, TransactionStore):
    max_age = 600

    def __init__(self, secret, cookie_name="_a0_tx"):
        super().__init__({"secret": secret})
        self.cookie_name = cookie_name

    def _deserialize(self, data):
        # Callback processing reads transaction attributes (domain,
        # redirect_uri, code_verifier), so rebuild the model from the dict.
        return TransactionData.model_validate(data)


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
