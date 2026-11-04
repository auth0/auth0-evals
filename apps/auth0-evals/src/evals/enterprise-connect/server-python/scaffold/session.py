"""Barkbook's own session: a signed "<body>.<signature>" cookie holding the user."""

import base64
import hashlib
import hmac
import json
import os
from typing import Optional

from fastapi import HTTPException, Request
from fastapi.responses import Response

COOKIE_NAME = "barkbook_session"
MAX_AGE_SECONDS = 8 * 60 * 60


def _sign(body: str) -> str:
    secret = os.environ["APP_SESSION_SECRET"].encode()
    return hmac.new(secret, body.encode(), hashlib.sha256).hexdigest()


def create_session(response: Response, user: dict) -> None:
    """Sign the user in. `user` is {"id", "email", "name"}."""
    payload = {"id": user["id"], "email": user["email"], "name": user["name"]}
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    response.set_cookie(
        COOKIE_NAME,
        f"{body}.{_sign(body)}",
        max_age=MAX_AGE_SECONDS,
        httponly=True,
        secure=os.environ.get("ENV") == "production",
        samesite="lax",
        path="/",
    )


def read_session(request: Request) -> Optional[dict]:
    raw = request.cookies.get(COOKIE_NAME)
    if not raw or "." not in raw:
        return None
    body, _, signature = raw.partition(".")
    if not hmac.compare_digest(signature, _sign(body)):
        return None
    try:
        padded = body + "=" * (-len(body) % 4)
        return json.loads(base64.urlsafe_b64decode(padded).decode())
    except ValueError:
        return None


def clear_session(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def require_session(request: Request) -> dict:
    user = read_session(request)
    if not user:
        raise HTTPException(status_code=303, headers={"location": "/signin"})
    return user
