---
id: flask_quickstart
name: Flask Quickstart
skills: auth0-flask
setup_command: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
compile_command: .venv/bin/python -m py_compile app.py
---

## Task
Add Auth0 login to my Flask app.

Domain: dev-barkbook.us.auth0.com
Client ID: barkbook_client_abc123xyz
Client Secret: barkbook_secret_def456uvw
Base URL: http://localhost:5000
Audience: https://api.barkbook.com

I also need to call an external API — get an access token and include a route that makes an authenticated request using that token.

Create a protected /profile route that requires login and shows the user's profile.

Do not prompt for permissions to create any .env files.

A virtual environment is already set up at `.venv`. Use `.venv/bin/pip` to install packages and update `requirements.txt` with any new dependencies.
