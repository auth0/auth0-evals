"""Auth0 web app on Python's stdlib http.server."""

import asyncio
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from auth0_client import auth0
from http_helpers import Request, Response

BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:8000")


class AppHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = urlparse(self.path).path
        if route == "/auth/login":
            self._run(self._login)
        elif route == "/auth/callback":
            self._run(self._callback)
        elif route == "/auth/logout":
            self._run(self._logout)
        else:
            self._reply(404, Response(), body={"error": "not_found"})

    def do_POST(self):
        if urlparse(self.path).path == "/transfer":
            self._run(self._transfer)
        else:
            self._reply(404, Response(), body={"error": "not_found"})

    async def _login(self, req, res):
        res.redirect_to = await auth0.start_interactive_login({}, store_options=_opts(req, res))

    async def _callback(self, req, res):
        await auth0.complete_interactive_login(req.url, store_options=_opts(req, res))
        res.redirect_to = "/"

    async def _logout(self, req, res):
        res.redirect_to = await auth0.logout(store_options=_opts(req, res))

    async def _transfer(self, req, res):
        run_transfer()
        return {"status": "transfer complete"}

    def _run(self, handler):
        req = Request(self.path, self.headers, BASE_URL)
        res = Response()
        try:
            body = asyncio.run(handler(req, res))
        except Exception as err:
            self._reply(500, res, body={"error": str(err)})
        else:
            if res.redirect_to:
                self._reply(302, res, location=res.redirect_to)
            else:
                self._reply(200, res, body=body or {"ok": True})

    def _reply(self, status, res, *, body=None, location=None):
        self.send_response(status)
        if location:
            self.send_header("Location", location)
        for cookie in res.set_cookie_headers:
            self.send_header("Set-Cookie", cookie)
        payload = json.dumps(body).encode() if body is not None else b""
        if payload:
            self.send_header("Content-Type", "application/json")
        self.end_headers()
        if payload:
            self.wfile.write(payload)


def _opts(req, res):
    return {"request": req, "response": res}


def run_transfer():
    return True


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    ThreadingHTTPServer(("0.0.0.0", port), AppHandler).serve_forever()
