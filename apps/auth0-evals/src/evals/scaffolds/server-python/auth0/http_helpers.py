"""Request/Response adapters for http.server."""

from http.cookies import SimpleCookie


class Request:
    def __init__(self, path, headers, base_url):
        self.url = base_url.rstrip("/") + path
        self.cookies = _parse_cookies(headers.get("Cookie", ""))


class Response:
    def __init__(self):
        self.set_cookie_headers = []
        self.redirect_to = None

    def set_cookie(self, key, value, max_age=None):
        cookie = SimpleCookie()
        cookie[key] = value
        morsel = cookie[key]
        morsel["path"] = "/"
        morsel["httponly"] = True
        morsel["samesite"] = "Lax"
        if max_age is not None:
            morsel["max-age"] = max_age
        self.set_cookie_headers.append(morsel.OutputString())

    def delete_cookie(self, key):
        cookie = SimpleCookie()
        cookie[key] = ""
        morsel = cookie[key]
        morsel["path"] = "/"
        morsel["max-age"] = 0
        self.set_cookie_headers.append(morsel.OutputString())


def _parse_cookies(header):
    jar = SimpleCookie()
    jar.load(header)
    return {key: morsel.value for key, morsel in jar.items()}
