"""Auth: email/password with confirmation, sessions, Google OAuth."""
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..email_service import send_email
from ..models import User
from ..security import create_token, decode_token, hash_password, verify_password
from .deps import SESSION_COOKIE, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(default="", max_length=120)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


def _set_session(response: Response, user_id: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        create_token(user_id, "session"),
        httponly=True,
        samesite="lax",
        max_age=settings.session_ttl_hours * 3600,
        path="/",
        # secure=True in production behind HTTPS
    )


def _user_payload(user: User) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name, "plan": user.plan, "confirmed": user.confirmed}


@router.post("/signup", status_code=201)
def signup(body: SignupIn, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == body.email.lower()).first():
        raise HTTPException(409, "An account with that email already exists. Sign in instead.")
    user = User(email=body.email.lower(), name=body.name, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()

    confirm_token = create_token(user.id, purpose="confirm", ttl_hours=48)
    confirm_url = f"{settings.frontend_origin}/confirm?token={confirm_token}"
    sent = send_email(
        user.email,
        "Confirm your Backtester account",
        f'<p>Confirm your account to start running backtests:</p><p><a href="{confirm_url}">{confirm_url}</a></p>',
    )
    out: dict = {"ok": True, "email": user.email}
    if not sent:
        # No email provider configured (dev): hand the link back so the flow stays testable.
        out["dev_confirmation_url"] = confirm_url
    return out


@router.post("/confirm")
def confirm(token: str, response: Response, db: Session = Depends(get_db)):
    user_id = decode_token(token, purpose="confirm")
    if not user_id:
        raise HTTPException(400, "That confirmation link is invalid or expired. Sign up again to get a new one.")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(400, "Account not found")
    user.confirmed = True
    db.commit()
    _set_session(response, user.id)
    return _user_payload(user)


@router.post("/login")
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower()).first()
    if user is None or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Email or password is incorrect.")
    if not user.confirmed:
        raise HTTPException(403, "Confirm your email first — check your inbox for the link.")
    _set_session(response, user.id)
    return _user_payload(user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return _user_payload(user)


# ── Google OAuth ──────────────────────────────────────────────────────────────
# PLACEHOLDER[GOOGLE OAUTH]: full authorization-code flow. Works as soon as
# GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are set in backend/.env
# and http://localhost:3000/api/auth/google/callback is registered as a
# redirect URI in the Google Cloud console.

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


@router.get("/google")
def google_start():
    if not settings.google_oauth_client_id:
        raise HTTPException(
            501,
            "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and "
            "GOOGLE_OAUTH_CLIENT_SECRET in backend/.env (see .env.example).",
        )
    redirect_uri = f"{settings.frontend_origin}/api/auth/google/callback"
    url = (
        f"{GOOGLE_AUTH_URL}?client_id={settings.google_oauth_client_id}"
        f"&redirect_uri={redirect_uri}&response_type=code&scope=openid%20email%20profile"
    )
    return {"authorize_url": url}


@router.get("/google/callback")
def google_callback(code: str, db: Session = Depends(get_db)):
    if not settings.google_oauth_client_secret:
        raise HTTPException(501, "Google OAuth is not configured.")
    import httpx

    redirect_uri = f"{settings.frontend_origin}/api/auth/google/callback"
    token_resp = httpx.post(GOOGLE_TOKEN_URL, data={
        "code": code,
        "client_id": settings.google_oauth_client_id,
        "client_secret": settings.google_oauth_client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    })
    token_resp.raise_for_status()
    access_token = token_resp.json()["access_token"]
    info = httpx.get(GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}).json()

    user = db.query(User).filter(User.google_sub == info["sub"]).first()
    if user is None:
        user = db.query(User).filter(User.email == info["email"].lower()).first()
    if user is None:
        user = User(email=info["email"].lower(), name=info.get("name", ""), google_sub=info["sub"], confirmed=True)
        db.add(user)
    else:
        user.google_sub = info["sub"]
        user.confirmed = True
    db.commit()
    # Land the user in the app with the session cookie attached.
    redirect = RedirectResponse(f"{settings.frontend_origin}/build", status_code=303)
    _set_session(redirect, user.id)
    return redirect


@router.get("/ws-token")
def ws_token(user: User = Depends(get_current_user)):
    """Short-lived token for authenticating WebSocket connections."""
    return {"token": create_token(user.id, purpose="ws", ttl_hours=1)}
