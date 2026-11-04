"""HTML for Barkbook's pages."""

from html import escape
from typing import Optional


def sign_in_page(email: str = "", error: Optional[str] = None) -> str:
    alert = '<p role="alert">Invalid email or password.</p>' if error else ""
    return f"""<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Sign in · Barkbook</title></head>
  <body>
    <h1>Sign in to Barkbook</h1>
    {alert}
    <form method="POST" action="/signin">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" value="{escape(email)}" required />
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required />
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>"""


def dashboard_page(name: str, email: str) -> str:
    return f"""<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Dashboard · Barkbook</title></head>
  <body>
    <h1>Welcome, {escape(name)}</h1>
    <p>{escape(email)}</p>
    <a href="/signout">Sign out</a>
  </body>
</html>"""
