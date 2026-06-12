"""Strategies + versioning: CRUD, fork, version diff."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Backtest, Strategy, StrategyVersion, User
from .deps import enforce_ml_access, enforce_strategy_quota, get_current_user

router = APIRouter(prefix="/strategies", tags=["strategies"])


class VersionIn(BaseModel):
    label: str = ""
    signal_type: str
    params: dict = Field(default_factory=dict)
    code: str = ""
    universe: list[str] = Field(default_factory=list)
    rebalance: str = "daily"
    position_mode: str = "long_top"
    top_n: int = 5
    slippage: dict = Field(default_factory=dict)
    ml_filter: dict = Field(default_factory=dict)


class StrategyIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    category: str = "momentum"
    version: VersionIn


def _version_payload(v: StrategyVersion) -> dict:
    return {
        "id": v.id, "version_number": v.version_number, "label": v.label,
        "signal_type": v.signal_type, "params": v.params, "code": v.code,
        "universe": v.universe, "rebalance": v.rebalance,
        "position_mode": v.position_mode, "top_n": v.top_n,
        "slippage": v.slippage, "ml_filter": v.ml_filter, "parent_version_id": v.parent_version_id,
        "created_at": v.created_at.isoformat(),
    }


def _strategy_payload(s: Strategy, db: Session, with_versions: bool = False) -> dict:
    latest = s.versions[-1] if s.versions else None
    last_bt = None
    if latest:
        version_ids = [v.id for v in s.versions]
        last_bt = (
            db.query(Backtest)
            .filter(Backtest.strategy_version_id.in_(version_ids), Backtest.status == "done")
            .order_by(Backtest.created_at.desc())
            .first()
        )
    out = {
        "id": s.id, "name": s.name, "description": s.description,
        "category": s.category, "starred": s.starred,
        "forked_from_id": s.forked_from_id, "created_at": s.created_at.isoformat(),
        "version_count": len(s.versions),
        "latest_version": _version_payload(latest) if latest else None,
        "last_metrics": (last_bt.result or {}).get("metrics") if last_bt else None,
        "last_backtest_id": last_bt.id if last_bt else None,
    }
    if with_versions:
        out["versions"] = [_version_payload(v) for v in s.versions]
    return out


def _owned(strategy_id: str, user: User, db: Session) -> Strategy:
    s = db.get(Strategy, strategy_id)
    if s is None or s.user_id != user.id:
        raise HTTPException(404, "Strategy not found")
    return s


@router.get("")
def list_strategies(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Strategy).filter(Strategy.user_id == user.id).order_by(Strategy.created_at.desc()).all()
    return [_strategy_payload(s, db) for s in rows]


@router.post("", status_code=201)
def create_strategy(body: StrategyIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    enforce_strategy_quota(user, db)
    enforce_ml_access(user, body.version.signal_type, body.version.ml_filter)
    s = Strategy(user_id=user.id, name=body.name, description=body.description, category=body.category)
    db.add(s)
    db.flush()
    v = StrategyVersion(strategy_id=s.id, version_number=1, **body.version.model_dump())
    db.add(v)
    db.commit()
    return _strategy_payload(s, db, with_versions=True)


@router.get("/{strategy_id}")
def get_strategy(strategy_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _strategy_payload(_owned(strategy_id, user, db), db, with_versions=True)


@router.post("/{strategy_id}/versions", status_code=201)
def add_version(strategy_id: str, body: VersionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = _owned(strategy_id, user, db)
    enforce_ml_access(user, body.signal_type, body.ml_filter)
    latest = s.versions[-1] if s.versions else None
    v = StrategyVersion(
        strategy_id=s.id,
        version_number=(latest.version_number + 1) if latest else 1,
        parent_version_id=latest.id if latest else None,
        **body.model_dump(),
    )
    db.add(v)
    db.commit()
    return _version_payload(v)


@router.post("/{strategy_id}/fork", status_code=201)
def fork_strategy(strategy_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    src = _owned(strategy_id, user, db)
    enforce_strategy_quota(user, db)
    latest = src.versions[-1] if src.versions else None
    if latest is None:
        raise HTTPException(400, "Strategy has no versions to fork")
    fork = Strategy(
        user_id=user.id, name=f"{src.name} (fork)", description=src.description,
        category=src.category, forked_from_id=src.id,
    )
    db.add(fork)
    db.flush()
    db.add(StrategyVersion(
        strategy_id=fork.id, version_number=1, label=f"forked from {src.name} v{latest.version_number}",
        signal_type=latest.signal_type, params=latest.params, code=latest.code,
        universe=latest.universe, rebalance=latest.rebalance,
        position_mode=latest.position_mode, top_n=latest.top_n,
        slippage=latest.slippage, parent_version_id=latest.id,
    ))
    db.commit()
    return _strategy_payload(fork, db, with_versions=True)


@router.patch("/{strategy_id}")
def update_strategy(strategy_id: str, body: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = _owned(strategy_id, user, db)
    for field in ("name", "description", "starred", "category"):
        if field in body:
            setattr(s, field, body[field])
    db.commit()
    return _strategy_payload(s, db)


@router.delete("/{strategy_id}")
def delete_strategy(strategy_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = _owned(strategy_id, user, db)
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.get("/{strategy_id}/diff")
def diff_versions(
    strategy_id: str, a: str, b: str,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """Side-by-side comparison of two versions: params + latest backtest metrics."""
    s = _owned(strategy_id, user, db)
    versions = {v.id: v for v in s.versions}
    va, vb = versions.get(a), versions.get(b)
    if va is None or vb is None:
        raise HTTPException(404, "Version not found on this strategy")

    def latest_metrics(v: StrategyVersion) -> dict | None:
        bt = (
            db.query(Backtest)
            .filter(Backtest.strategy_version_id == v.id, Backtest.status == "done")
            .order_by(Backtest.created_at.desc())
            .first()
        )
        return (bt.result or {}).get("metrics") if bt else None

    def flat_config(v: StrategyVersion) -> dict:
        return {
            "signal_type": v.signal_type, "rebalance": v.rebalance,
            "position_mode": v.position_mode, "top_n": v.top_n,
            "universe": ", ".join(v.universe),
            **{f"param.{k}": val for k, val in (v.params or {}).items()},
            **{f"slippage.{k}": val for k, val in (v.slippage or {}).items()},
        }

    ca, cb = flat_config(va), flat_config(vb)
    keys = sorted(set(ca) | set(cb))
    return {
        "a": _version_payload(va), "b": _version_payload(vb),
        "param_diff": [
            {"key": k, "a": ca.get(k), "b": cb.get(k), "changed": ca.get(k) != cb.get(k)}
            for k in keys
        ],
        "metrics_a": latest_metrics(va),
        "metrics_b": latest_metrics(vb),
        "code_changed": va.code != vb.code,
        "code_a": va.code, "code_b": vb.code,
    }
