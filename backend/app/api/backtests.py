"""Backtest lifecycle: submit, poll progress, fetch results, CSV export."""
import csv
import io
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Backtest, Strategy, StrategyVersion, User
from ..tasks import submit_backtest
from .deps import get_current_user, limits_for

router = APIRouter(prefix="/backtests", tags=["backtests"])


class BacktestIn(BaseModel):
    strategy_version_id: str
    start_date: str
    end_date: str
    initial_capital: float = 100_000.0


def _owned_bt(backtest_id: str, user: User, db: Session) -> Backtest:
    bt = db.get(Backtest, backtest_id)
    if bt is None or bt.user_id != user.id:
        raise HTTPException(404, "Backtest not found")
    return bt


def _summary(bt: Backtest) -> dict:
    return {
        "id": bt.id, "status": bt.status, "progress": bt.progress, "error": bt.error,
        "strategy_version_id": bt.strategy_version_id,
        "start_date": bt.start_date, "end_date": bt.end_date,
        "initial_capital": bt.initial_capital,
        "metrics": (bt.result or {}).get("metrics") if bt.status == "done" else None,
        "created_at": bt.created_at.isoformat(),
    }


@router.post("", status_code=202)
def create_backtest(body: BacktestIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    version = db.get(StrategyVersion, body.strategy_version_id)
    if version is None:
        raise HTTPException(404, "Strategy version not found")
    strategy = db.get(Strategy, version.strategy_id)
    if strategy is None or strategy.user_id != user.id:
        raise HTTPException(404, "Strategy version not found")

    # Free plan: history window capped (see PLAN_LIMITS in deps.py)
    years_cap = limits_for(user)["history_years"]
    if years_cap is not None:
        earliest = date.today() - timedelta(days=365 * years_cap)
        if date.fromisoformat(body.start_date) < earliest:
            raise HTTPException(
                402,
                f"The Free plan includes {years_cap} years of history (from {earliest.isoformat()}). "
                "Upgrade to Pro for the full archive.",
            )

    bt = Backtest(
        user_id=user.id,
        strategy_version_id=version.id,
        start_date=body.start_date,
        end_date=body.end_date,
        initial_capital=body.initial_capital,
    )
    db.add(bt)
    db.commit()
    submit_backtest(bt.id)  # PLACEHOLDER[CELERY+REDIS]: becomes task.delay(bt.id)
    return {"id": bt.id, "status": "queued"}


@router.get("")
def list_backtests(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(Backtest).filter(Backtest.user_id == user.id)
        .order_by(Backtest.created_at.desc()).limit(100).all()
    )
    return [_summary(bt) for bt in rows]


@router.get("/{backtest_id}/status")
def backtest_status(backtest_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    bt = _owned_bt(backtest_id, user, db)
    return {"id": bt.id, "status": bt.status, "progress": bt.progress, "error": bt.error}


@router.get("/{backtest_id}")
def get_backtest(backtest_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    bt = _owned_bt(backtest_id, user, db)
    version = db.get(StrategyVersion, bt.strategy_version_id)
    strategy = db.get(Strategy, version.strategy_id) if version else None
    return {
        **_summary(bt),
        "result": bt.result,
        "strategy": {"id": strategy.id, "name": strategy.name} if strategy else None,
        "version_number": version.version_number if version else None,
    }


@router.get("/{backtest_id}/export/trades.csv")
def export_trades_csv(backtest_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    bt = _owned_bt(backtest_id, user, db)
    if bt.status != "done" or not bt.result:
        raise HTTPException(409, "Backtest has not finished")
    trades = bt.result.get("trades", [])
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=[
        "symbol", "side", "qty", "entry_date", "exit_date",
        "entry_price", "exit_price", "pnl", "return_pct", "holding_days",
    ])
    writer.writeheader()
    writer.writerows(trades)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=trades_{bt.id[:8]}.csv"},
    )


@router.get("/{backtest_id}/export/equity.csv")
def export_equity_csv(backtest_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    bt = _owned_bt(backtest_id, user, db)
    if bt.status != "done" or not bt.result:
        raise HTTPException(409, "Backtest has not finished")
    r = bt.result
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["date", "equity", "benchmark", "drawdown", "rolling_sharpe"])
    for i, d in enumerate(r["dates"]):
        writer.writerow([d, r["equity"][i], r["benchmark"][i], r["drawdown"][i], r["rolling_sharpe"][i]])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=equity_{bt.id[:8]}.csv"},
    )
