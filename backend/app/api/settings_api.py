"""User settings: profile, encrypted provider API keys, notifications, plan."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import ApiKey, User
from ..security import encrypt_secret
from .deps import get_current_user

router = APIRouter(prefix="/settings", tags=["settings"])

ALLOWED_PROVIDERS = {"polygon", "alpaca", "yahoo", "broker_paper", "ml_endpoint"}


class ProfileIn(BaseModel):
    name: str = Field(max_length=120)


class ApiKeyIn(BaseModel):
    provider: str
    key: str = Field(min_length=4, max_length=512)


class NotificationsIn(BaseModel):
    backtest_complete: bool = True
    paper_fill: bool = True
    weekly_summary: bool = False


class PlanIn(BaseModel):
    plan: str


@router.patch("/profile")
def update_profile(body: ProfileIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.name = body.name
    db.commit()
    return {"ok": True, "name": user.name}


@router.get("/api-keys")
def list_api_keys(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(ApiKey).filter(ApiKey.user_id == user.id).all()
    # Keys are never returned — only provider + last four characters.
    return [
        {"id": k.id, "provider": k.provider, "last_four": k.last_four, "created_at": k.created_at.isoformat()}
        for k in rows
    ]


@router.post("/api-keys", status_code=201)
def add_api_key(body: ApiKeyIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.provider not in ALLOWED_PROVIDERS:
        raise HTTPException(400, f"Provider must be one of: {', '.join(sorted(ALLOWED_PROVIDERS))}")
    # One key per provider: replace existing
    db.query(ApiKey).filter(ApiKey.user_id == user.id, ApiKey.provider == body.provider).delete()
    k = ApiKey(
        user_id=user.id,
        provider=body.provider,
        encrypted_key=encrypt_secret(body.key),  # Fernet, at rest — app/security.py
        last_four=body.key[-4:],
    )
    db.add(k)
    db.commit()
    return {"id": k.id, "provider": k.provider, "last_four": k.last_four}


@router.delete("/api-keys/{key_id}")
def delete_api_key(key_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    k = db.get(ApiKey, key_id)
    if k is None or k.user_id != user.id:
        raise HTTPException(404, "Key not found")
    db.delete(k)
    db.commit()
    return {"ok": True}


@router.get("/notifications")
def get_notifications(user: User = Depends(get_current_user)):
    defaults = NotificationsIn().model_dump()
    return {**defaults, **(user.notification_prefs or {})}


@router.patch("/notifications")
def update_notifications(body: NotificationsIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.notification_prefs = body.model_dump()
    db.commit()
    return user.notification_prefs


@router.post("/plan")
def change_plan(body: PlanIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Subscription switcher.

    PLACEHOLDER[BILLING — STRIPE]: production should create a Stripe Checkout
    session here and change the plan from the webhook on successful payment.
    The local switch keeps tiers testable without billing creds.
    """
    if body.plan not in {"free", "pro", "quant"}:
        raise HTTPException(400, "Plan must be free, pro, or quant")
    user.plan = body.plan
    db.commit()
    return {"ok": True, "plan": user.plan}
