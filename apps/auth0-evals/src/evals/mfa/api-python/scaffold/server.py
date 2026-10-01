import os

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from auth0_api_python import ApiClient, ApiClientOptions, VerifyAccessTokenError

load_dotenv()

app = FastAPI()

# Validates JWT access tokens. Domain and audience are read from the
# AUTH0_DOMAIN and AUTH0_AUDIENCE environment variables.
client = ApiClient(
    ApiClientOptions(
        domain=os.environ["AUTH0_DOMAIN"],
        audience=os.environ["AUTH0_AUDIENCE"],
    )
)


@app.get("/api/balance")
async def get_balance(request: Request):
    try:
        claims = await client.verify_request(dict(request.headers))
    except VerifyAccessTokenError as exc:
        return JSONResponse(status_code=exc.get_status_code(), content={"error": str(exc)})

    scopes = claims.get("scope", "").split()
    if "read:balance" not in scopes:
        return JSONResponse(status_code=403, content={"error": "insufficient_scope"})

    return {"balance": 4200, "sub": claims.get("sub")}


@app.post("/api/transfers")
async def post_transfers(request: Request):
    try:
        claims = await client.verify_request(dict(request.headers))
    except VerifyAccessTokenError as exc:
        return JSONResponse(status_code=exc.get_status_code(), content={"error": str(exc)})

    scopes = claims.get("scope", "").split()
    if "write:transfers" not in scopes:
        return JSONResponse(status_code=403, content={"error": "insufficient_scope"})

    # TODO: add step-up scope gate here

    body = await request.json()
    return JSONResponse(status_code=201, content={"transferred": body.get("amount"), "sub": claims.get("sub")})
