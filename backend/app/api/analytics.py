"""Cross-strategy analytics: comparison, correlation, distributions, drawdowns."""
import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Backtest, Strategy, StrategyVersion, User
from .deps import get_current_user

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _latest_done_backtests(user: User, db: Session) -> list[tuple[Strategy, StrategyVersion, Backtest]]:
    """Newest finished backtest per strategy."""
    out = []
    strategies = db.query(Strategy).filter(Strategy.user_id == user.id).all()
    for s in strategies:
        version_ids = [v.id for v in s.versions]
        if not version_ids:
            continue
        bt = (
            db.query(Backtest)
            .filter(Backtest.strategy_version_id.in_(version_ids), Backtest.status == "done")
            .order_by(Backtest.created_at.desc())
            .first()
        )
        if bt and bt.result:
            version = db.get(StrategyVersion, bt.strategy_version_id)
            out.append((s, version, bt))
    return out


@router.get("/overview")
def overview(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = _latest_done_backtests(user, db)

    comparison = []
    return_series: dict[str, pd.Series] = {}
    for s, v, bt in rows:
        r = bt.result
        comparison.append({
            "strategy_id": s.id, "strategy_name": s.name, "category": s.category,
            "version_number": v.version_number, "backtest_id": bt.id,
            "metrics": r.get("metrics"),
            # sparkline: downsample equity to ~120 points
            "equity_sparkline": _downsample(r.get("equity", []), 120),
            "dates_span": [r["dates"][0], r["dates"][-1]] if r.get("dates") else None,
        })
        eq = pd.Series(r.get("equity", []), index=pd.to_datetime(r.get("dates", [])))
        if len(eq) > 2:
            return_series[s.name] = eq.pct_change().dropna()

    # Signal correlation heatmap (pairwise daily-return correlation across strategies)
    correlation = None
    names = list(return_series)
    if len(names) >= 2:
        df = pd.DataFrame(return_series).dropna()
        if len(df) > 10:
            corr = df.corr().round(3)
            correlation = {"labels": names, "matrix": corr.values.tolist()}

    # Return distribution histogram of the most recent backtest (or all combined)
    histogram = None
    if return_series:
        all_rets = pd.concat(return_series.values())
        counts, edges = np.histogram(all_rets.clip(-0.06, 0.06), bins=40)
        histogram = {"counts": counts.tolist(), "edges": [round(e, 5) for e in edges.tolist()]}

    # Drawdown periods of the best-Sharpe strategy (top 5 deepest)
    drawdown_periods = []
    if rows:
        best = max(rows, key=lambda r: (r[2].result.get("metrics") or {}).get("sharpe", -9))
        r = best[2].result
        drawdown_periods = _drawdown_periods(r.get("dates", []), r.get("drawdown", []))[:5]
        drawdown_periods = [{**d, "strategy_name": best[0].name} for d in drawdown_periods]

    return {
        "comparison": comparison,
        "correlation": correlation,
        "histogram": histogram,
        "drawdown_periods": drawdown_periods,
    }


def _downsample(values: list, target: int) -> list:
    if len(values) <= target:
        return values
    idx = np.linspace(0, len(values) - 1, target).astype(int)
    return [values[i] for i in idx]


def _drawdown_periods(dates: list[str], drawdown: list[float]) -> list[dict]:
    """Contiguous underwater stretches, sorted deepest first."""
    periods = []
    start = None
    trough = 0.0
    trough_date = None
    for i, dd in enumerate(drawdown):
        if dd < -1e-9:
            if start is None:
                start, trough, trough_date = dates[i], dd, dates[i]
            elif dd < trough:
                trough, trough_date = dd, dates[i]
        elif start is not None:
            periods.append({"start": start, "end": dates[i], "trough_date": trough_date, "depth": round(trough, 4)})
            start = None
    if start is not None:
        periods.append({"start": start, "end": dates[-1], "trough_date": trough_date, "depth": round(trough, 4), "ongoing": True})
    return sorted(periods, key=lambda p: p["depth"])
