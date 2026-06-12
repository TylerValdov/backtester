"""Shared API dependencies: session auth, plan limit enforcement."""
from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Strategy, User
from ..security import decode_token

settings = get_settings()

SESSION_COOKIE = "session"

PLAN_LIMITS = {
    # Free: 2 strategies, 2 years of history, no ML signals
    "free": {"max_strategies": settings.free_max_strategies, "history_years": settings.free_history_years, "ml": False},
    # Pro: unlimited strategies, full history, ML hooks
    "pro": {"max_strategies": None, "history_years": None, "ml": True},
    # Quant: Pro + team access + API (team/API surfaces are placeholders)
    "quant": {"max_strategies": None, "history_years": None, "ml": True},
}


def get_current_user(
    session: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not session:
        raise HTTPException(401, "Not signed in")
    user_id = decode_token(session, purpose="session")
    if not user_id:
        raise HTTPException(401, "Session expired — sign in again")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(401, "Account not found")
    return user


def limits_for(user: User) -> dict:
    return PLAN_LIMITS.get(user.plan, PLAN_LIMITS["free"])


def enforce_strategy_quota(user: User, db: Session) -> None:
    cap = limits_for(user)["max_strategies"]
    if cap is None:
        return
    count = db.query(Strategy).filter(Strategy.user_id == user.id).count()
    if count >= cap:
        raise HTTPException(
            402,
            f"The Free plan includes {cap} strategies. Upgrade to Pro for unlimited strategies.",
        )


def enforce_ml_access(user: User, signal_type: str, ml_filter: dict | None = None) -> None:
    uses_ml = signal_type in ("ml_model", "ml_trained") or bool((ml_filter or {}).get("enabled"))
    if uses_ml and not limits_for(user)["ml"]:
        raise HTTPException(402, "ML signals and the ML trade filter are a Pro feature. Upgrade to use them.")
