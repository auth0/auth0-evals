"""Barkbook API on Python's stdlib http.server.

`/api/balance` is a protected endpoint that verifies the caller's Auth0 access
token. `/api/partner-exchange` is where the partner-token exchange goes."""

import asyncio
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from auth0_client import api_client


class AppHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if urlparse(self.path).path == "/api/balance":
            self._run(self._balance)
        else:
            self._reply(404, {"error": "not_found"})

    def do_POST(self):
        if urlparse(self.path).path == "/api/partner-exchange":
            self._run(self._partner_exchange)
        else:
            self._reply(404, {"error": "not_found"})

    async def _balance(self):
        token = self._bearer_token()
        if not token:
            return 401, {"error": "missing_token"}
        try:
            claims = await api_client.verify_access_token(access_token=token)
        except Exception:
            return 401, {"error": "invalid_token"}
        return 200, {"balance": 4200, "sub": claims["sub"]}

    async def _partner_exchange(self):
        body = self._read_body()
        if body is None:
            return 400, {"error": "invalid_json"}
        partner_token = body.get("partner_token")
        if not partner_token:
            return 400, {"error": "missing_partner_token"}
        # TODO: exchange the partner token (type urn:barkbook:external-idp-token)
        # for an Auth0 access token for https://api.barkbook.com and return it.
        return 501, {"error": "not_implemented"}

    def _bearer_token(self):
        header = self.headers.get("Authorization", "")
        if not header.lower().startswith("bearer "):
            return None
        return header[len("bearer ") :].strip()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return None

    def _run(self, handler):
        try:
            status, body = asyncio.run(handler())
        except Exception as err:
            status, body = 500, {"error": str(err)}
        self._reply(status, body)

    def _reply(self, status, body):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3001"))
    ThreadingHTTPServer(("0.0.0.0", port), AppHandler).serve_forever()
