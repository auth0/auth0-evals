"""Barkbook's user store. A single demo account stands in for the real database."""

import hashlib
import hmac
from typing import Optional

_SALT = b"barkbook-demo-salt"

_USERS = {
    "owner@barkbook.dev": {
        "id": "usr_001",
        "email": "owner@barkbook.dev",
        "name": "Barkbook Owner",
        # pbkdf2_hmac("sha256", b"woof-woof-123", _SALT, 200_000)
        "password_hash": "44763db3ecda3de59def811a0c9b8cd13959da88ce9e814e8d85de3f4af10629",
    },
}


def verify_password(email: str, password: str) -> Optional[dict]:
    record = _USERS.get(email.strip().lower())
    if not record:
        return None
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), _SALT, 200_000).hex()
    if not hmac.compare_digest(candidate, record["password_hash"]):
        return None
    return {"id": record["id"], "email": record["email"], "name": record["name"]}
