"""Event-driven backtest for FVG strategies.

Per symbol, one position at a time. Each bar: (1) manage the open position
against this bar's range (resting stop/target), (2) detect a new gap formed at
this bar, (3) if flat, look for a tap of a previously-formed gap and enter.
Invalidated gaps optionally flip to inverse FVGs. Capital is split equally
across the selected assets; the per-symbol equity curves are summed.

Output payload matches app/backtest/runner.run_backtest so the results UI is
shared.
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..data import BENCHMARK, SYMBOLS, get_provider, is_intraday, normalize, periods_per_year
from ..risk import drawdown_series, rolling_sharpe, summarize
from .fvg import Gap, detect_gap

MAX_TRADES_IN_PAYLOAD = 1000


@dataclass
class FvgConfig:
    min_gap_frac: float = 0.001   # min gap height as a fraction of price
    tap_depth: float = 0.0        # how far into the gap price must trade to trigger
    stop_buffer: float = 0.0005   # stop placed this fraction beyond the far gap edge
    rr: float = 2.0               # reward:risk target
    max_hold: int = 0             # bar-count time stop (0 = off)
    use_ifvg: bool = False        # flip violated gaps to inverse FVGs


def config_from_params(params: dict) -> FvgConfig:
    return FvgConfig(
        min_gap_frac=float(params.get("min_gap_pct", 0.10)) / 100.0,
        tap_depth=float(params.get("tap_depth", 0.0)),
        stop_buffer=float(params.get("stop_buffer", 0.05)) / 100.0,
        rr=float(params.get("rr", 2.0)),
        max_hold=int(params.get("max_hold", 0)),
        use_ifvg=bool(int(params.get("use_ifvg", 0))),
    )


@dataclass
class _Pos:
    side: int          # +1 long, -1 short
    entry_idx: int
    entry_price: float
    qty: float
    stop: float
    target: float


def simulate_symbol(symbol: str, df: pd.DataFrame, cfg: FvgConfig, alloc: float, bps: float, intraday: bool):
    """Run the FVG state machine over one symbol. Returns (equity Series,
    exposure Series, trades, slippage_total).

    Intraday data is regular-session bars; any open position is flattened on the
    last bar of each session (the 4pm close) — no overnight holds."""
    o, h, l, c = (df[k].to_numpy(dtype=float) for k in ("open", "high", "low", "close"))
    idx = df.index
    n = len(df)
    # session_end[i] marks the last bar of a trading day (intraday only)
    session_end = np.zeros(n, dtype=bool)
    if intraday and n > 0:
        day = idx.normalize().to_numpy()
        session_end[:-1] = day[:-1] != day[1:]
        session_end[-1] = True
    gaps: list[Gap] = []
    pos: _Pos | None = None
    realized = 0.0
    slip_total = 0.0
    equity = np.empty(n)
    exposure = np.zeros(n)
    trades: list[dict] = []
    fmt = "%Y-%m-%d %H:%M" if intraday else "%Y-%m-%d"

    def close_pos(p: _Pos, exit_price: float, i: int) -> None:
        nonlocal realized, slip_total
        fill = exit_price * (1 - p.side * bps)
        pnl = p.qty * (fill - p.entry_price) * p.side
        slip = p.qty * abs(exit_price) * bps
        realized += pnl
        slip_total += slip
        trades.append({
            "symbol": symbol,
            "side": "long" if p.side == 1 else "short",
            "qty": round(p.qty, 4),
            "entry_date": idx[p.entry_idx].strftime(fmt),
            "exit_date": idx[i].strftime(fmt),
            "entry_price": round(p.entry_price, 4),
            "exit_price": round(fill, 4),
            "pnl": round(pnl, 2),
            "return_pct": round(p.side * (fill / p.entry_price - 1), 5),
            "holding_days": int(i - p.entry_idx),
        })

    for i in range(n):
        price = c[i]

        # 1) manage open position against this bar (stop/target are resting orders)
        if pos is not None:
            exit_price = None
            if pos.side == 1:
                if l[i] <= pos.stop:
                    exit_price = pos.stop            # stop first (conservative)
                elif h[i] >= pos.target:
                    exit_price = pos.target
            else:
                if h[i] >= pos.stop:
                    exit_price = pos.stop
                elif l[i] <= pos.target:
                    exit_price = pos.target
            if exit_price is None and cfg.max_hold and (i - pos.entry_idx) >= cfg.max_hold:
                exit_price = price
            if exit_price is None and session_end[i]:
                exit_price = price            # flatten at the 4pm session close
            if exit_price is not None:
                close_pos(pos, exit_price, i)
                pos = None

        # 2) detect a gap formed at this bar
        g = detect_gap(h, l, c, i, cfg.min_gap_frac)
        if g is not None:
            gaps.append(g)

        # 3) if flat, age/violate gaps and look for a tap to enter
        if pos is None:
            # don't open on the session's last bar — it'd flatten immediately
            block_entry = bool(session_end[i])
            for g in gaps:
                if g.dead or g.created_idx >= i:
                    continue
                # violation: a close beyond the far edge invalidates (or inverts) it
                if g.kind == "bull" and c[i] < g.bottom:
                    if cfg.use_ifvg:
                        g.kind, g.created_idx = "bear", i
                    else:
                        g.dead = True
                    continue
                if g.kind == "bear" and c[i] > g.top:
                    if cfg.use_ifvg:
                        g.kind, g.created_idx = "bull", i
                    else:
                        g.dead = True
                    continue
                if block_entry:
                    continue
                span = g.top - g.bottom
                if g.kind == "bull":
                    tap = g.top - cfg.tap_depth * span
                    if l[i] <= tap:
                        entry = tap * (1 + bps)
                        stop = g.bottom * (1 - cfg.stop_buffer)
                        risk = entry - stop
                        if risk > 0:
                            pos = _Pos(1, i, entry, alloc / entry, stop, entry + cfg.rr * risk)
                            slip_total += (alloc / entry) * tap * bps
                            g.dead = True
                            break
                else:
                    tap = g.bottom + cfg.tap_depth * span
                    if h[i] >= tap:
                        entry = tap * (1 - bps)
                        stop = g.top * (1 + cfg.stop_buffer)
                        risk = stop - entry
                        if risk > 0:
                            pos = _Pos(-1, i, entry, alloc / entry, stop, entry - cfg.rr * risk)
                            slip_total += (alloc / entry) * tap * bps
                            g.dead = True
                            break
            gaps = [g for g in gaps if not g.dead]

        # 4) mark to market
        unreal = pos.qty * (price - pos.entry_price) * pos.side if pos else 0.0
        equity[i] = alloc + realized + unreal
        exposure[i] = 1.0 if pos else 0.0

    return (
        pd.Series(equity, index=idx),
        pd.Series(exposure, index=idx),
        trades,
        slip_total,
    )


def run_ict_backtest(version, start_date, end_date, initial_capital, on_progress=None) -> dict:
    provider = get_provider()
    symbols = list(version.universe) or SYMBOLS[:1]
    timeframe = normalize(getattr(version, "timeframe", "1d"))
    intraday = is_intraday(timeframe)
    ppy = periods_per_year(timeframe)
    cfg = config_from_params(version.params or {})
    bps = float((version.slippage or {}).get("pct_bps", 0.0)) / 1e4

    if intraday:
        data_start = (pd.Timestamp(start_date) - pd.Timedelta(days=10)).strftime("%Y-%m-%d")
        data_end = end_date
    else:
        data_start = data_end = None

    end_ts = pd.Timestamp(end_date) + pd.Timedelta(hours=23, minutes=59, seconds=59)
    alloc = initial_capital / len(symbols)

    eq_parts: list[pd.Series] = []
    exp_parts: list[pd.Series] = []
    all_trades: list[dict] = []
    slip_total = 0.0

    for k, sym in enumerate(symbols):
        df = provider.history(sym, data_start, data_end, timeframe)
        df = df.loc[(df.index >= pd.Timestamp(start_date)) & (df.index <= end_ts)]
        if len(df) < 5:
            continue
        eq, exp, trades, slip = simulate_symbol(sym, df, cfg, alloc, bps, intraday)
        eq_parts.append(eq)
        exp_parts.append(exp)
        all_trades.extend(trades)
        slip_total += slip
        if on_progress:
            on_progress((k + 1) / len(symbols))

    if not eq_parts:
        raise ValueError("No data in the requested window for the selected assets / timeframe")

    common = sorted(set().union(*[s.index for s in eq_parts]))
    common_idx = pd.DatetimeIndex(common)
    equity = sum(s.reindex(common_idx).ffill().fillna(alloc) for s in eq_parts)
    exposure = sum(s.reindex(common_idx).ffill().fillna(0.0) for s in exp_parts) / len(eq_parts)

    bench_closes = provider.history(BENCHMARK, data_start or start_date, data_end or end_date, timeframe)["close"].reindex(common_idx).ffill()
    benchmark = bench_closes / bench_closes.iloc[0] * initial_capital

    all_trades.sort(key=lambda t: t["exit_date"])
    metrics = summarize(equity, benchmark, all_trades, ppy=ppy)
    metrics["total_slippage"] = round(slip_total, 2)
    metrics["turnover_orders"] = len(all_trades) * 2

    dd = drawdown_series(equity)
    rs = rolling_sharpe(equity.pct_change().fillna(0.0), 63, ppy=ppy)
    label_fmt = "%Y-%m-%d %H:%M" if intraday else "%Y-%m-%d"

    return {
        "dates": [d.strftime(label_fmt) for d in common_idx],
        "equity": [round(v, 2) for v in equity.tolist()],
        "benchmark": [round(v, 2) for v in benchmark.tolist()],
        "drawdown": [round(v, 5) for v in dd.fillna(0.0).tolist()],
        "rolling_sharpe": [None if pd.isna(v) else round(v, 3) for v in rs.tolist()],
        "exposure": [round(v, 4) for v in exposure.tolist()],
        "metrics": metrics,
        "trades": all_trades[-MAX_TRADES_IN_PAYLOAD:],
        "trades_total": len(all_trades),
        "open_positions": [],
        "slippage_breakdown": {"fixed": 0.0, "pct": round(slip_total, 2), "impact": 0.0, "total": round(slip_total, 2)},
        "config": {
            "symbols": symbols,
            "signal_type": version.signal_type,
            "params": version.params,
            "timeframe": timeframe,
            "rebalance": "event",
            "position_mode": "ict_fvg",
            "top_n": 1,
            "slippage": {"pct_bps": (version.slippage or {}).get("pct_bps", 0.0)},
            "start": start_date,
            "end": end_date,
            "initial_capital": initial_capital,
        },
    }
