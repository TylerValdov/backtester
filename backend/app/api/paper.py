"""Paper trading sessions + the live WebSocket endpoint."""
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import SessionLocal, get_db
from ..models import PaperOrder, PaperPosition, PaperSession, Strategy, StrategyVersion, User
from ..paper import engine, manager
from ..security import decode_token
from .deps import SESSION_COOKIE, get_current_user

router = APIRouter(prefix="/paper", tags=["paper"])


class PaperSessionIn(BaseModel):
    strategy_version_id: str
    name: str = ""
    initial_capital: float = 100_000.0


def _owned_session(session_id: str, user: User, db: Session) -> PaperSession:
    s = db.get(PaperSession, session_id)
    if s is None or s.user_id != user.id:
        raise HTTPException(404, "Paper session not found")
    return s


def _payload(s: PaperSession, db: Session) -> dict:
    version = db.get(StrategyVersion, s.strategy_version_id)
    strategy = db.get(Strategy, version.strategy_id) if version else None
    positions = db.query(PaperPosition).filter(PaperPosition.session_id == s.id).all()
    return {
        "id": s.id, "name": s.name or (strategy.name if strategy else "Session"),
        "status": s.status, "initial_capital": s.initial_capital,
        "cash": round(s.cash, 2), "equity": round(s.equity, 2),
        "pnl": round(s.equity - s.initial_capital, 2),
        "strategy": {"id": strategy.id, "name": strategy.name} if strategy else None,
        "version_number": version.version_number if version else None,
        "signal_type": version.signal_type if version else None,
        "universe": version.universe if version else [],
        "started_at": s.started_at.isoformat(),
        "positions": [
            {"symbol": p.symbol, "qty": p.qty, "avg_price": p.avg_price, "last_price": p.last_price}
            for p in positions if abs(p.qty) > 1e-9
        ],
    }


@router.get("/sessions")
def list_sessions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(PaperSession).filter(PaperSession.user_id == user.id).order_by(PaperSession.started_at.desc()).all()
    return [_payload(s, db) for s in rows]


@router.post("/sessions", status_code=201)
def create_session(body: PaperSessionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    version = db.get(StrategyVersion, body.strategy_version_id)
    if version is None:
        raise HTTPException(404, "Strategy version not found")
    strategy = db.get(Strategy, version.strategy_id)
    if strategy is None or strategy.user_id != user.id:
        raise HTTPException(404, "Strategy version not found")
    s = PaperSession(
        user_id=user.id, strategy_version_id=version.id, name=body.name,
        initial_capital=body.initial_capital, cash=body.initial_capital, equity=body.initial_capital,
    )
    db.add(s)
    db.commit()
    engine.add_session(s, version)
    return _payload(s, db)


@router.post("/sessions/{session_id}/stop")
def stop_session(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = _owned_session(session_id, user, db)
    s.status = "stopped"
    db.commit()
    engine.remove_session(s.id)
    return _payload(s, db)


@router.post("/sessions/{session_id}/resume")
def resume_session(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = _owned_session(session_id, user, db)
    version = db.get(StrategyVersion, s.strategy_version_id)
    s.status = "running"
    db.commit()
    engine.add_session(s, version)
    # restore persisted positions into the runtime
    rt = engine.sessions.get(s.id)
    if rt is not None:
        rt.cash = s.cash
        for p in db.query(PaperPosition).filter(PaperPosition.session_id == s.id):
            if abs(p.qty) > 1e-9:
                rt.positions[p.symbol] = {"qty": p.qty, "avg_price": p.avg_price}
    return _payload(s, db)


@router.get("/sessions/{session_id}")
def get_session(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = _owned_session(session_id, user, db)
    out = _payload(s, db)
    live = engine.snapshot(s.id)
    if live:
        out["live"] = live
    return out


@router.get("/sessions/{session_id}/orders")
def list_orders(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _owned_session(session_id, user, db)
    rows = (
        db.query(PaperOrder).filter(PaperOrder.session_id == session_id)
        .order_by(PaperOrder.created_at.desc()).limit(200).all()
    )
    return [
        {
            "id": o.id, "symbol": o.symbol, "side": o.side, "qty": o.qty,
            "fill_price": o.fill_price, "slippage_cost": o.slippage_cost,
            "status": o.status, "ts": o.created_at.isoformat(),
        }
        for o in rows
    ]


# ── WebSocket: live ticks for one session ─────────────────────────────────────
# Auth: session cookie (same-host on localhost, ports are cookie-agnostic) or
# ?token= from GET /api/auth/ws-token.
async def _ws_user_id(ws: WebSocket) -> str | None:
    token = ws.query_params.get("token")
    if token:
        return decode_token(token, purpose="ws")
    cookie = ws.cookies.get(SESSION_COOKIE)
    if cookie:
        return decode_token(cookie, purpose="session")
    return None


async def paper_ws(ws: WebSocket, session_id: str) -> None:
    user_id = await _ws_user_id(ws)
    if user_id is None:
        await ws.close(code=4401)
        return
    db = SessionLocal()
    try:
        s = db.get(PaperSession, session_id)
        if s is None or s.user_id != user_id:
            await ws.close(code=4404)
            return
    finally:
        db.close()

    await manager.connect(session_id, ws)
    snap = engine.snapshot(session_id)
    if snap:
        import json
        await ws.send_text(json.dumps(snap))
    try:
        while True:
            await ws.receive_text()  # keepalive; client doesn't need to send anything
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(session_id, ws)
