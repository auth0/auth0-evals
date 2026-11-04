"""Barkbook web app. Run with: uvicorn main:app --port 3000"""

from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Form
from fastapi.responses import HTMLResponse, RedirectResponse

from session import clear_session, create_session, require_session
from users import verify_password
from views import dashboard_page, sign_in_page

load_dotenv()

app = FastAPI()


@app.get("/")
async def home():
    return RedirectResponse("/dashboard", status_code=303)


@app.get("/signin", response_class=HTMLResponse)
async def sign_in_form(email: str = "", error: Optional[str] = None):
    # `?email=` pre-fills the form; `?error=invalid` shows the error message.
    return sign_in_page(email=email, error=error)


@app.post("/signin")
async def sign_in(email: str = Form(...), password: str = Form(...)):
    user = verify_password(email, password)
    if not user:
        return RedirectResponse("/signin?error=invalid", status_code=303)
    response = RedirectResponse("/dashboard", status_code=303)
    create_session(response, user)
    return response


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard(user: dict = Depends(require_session)):
    return dashboard_page(name=user["name"], email=user["email"])


@app.get("/signout")
async def sign_out():
    response = RedirectResponse("/signin", status_code=303)
    clear_session(response)
    return response
