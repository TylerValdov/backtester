"""Backtest runner.

Daily event loop over the requested window:
- signals are generated once over the full history (vectorized), then sampled
  at each rebalance date
- targets are converted to share deltas and filled at that day's close through
  the slippage model
- equity is marked to market every day; trades are FIFO-paired for the log

Lookahead honesty: scores at date t are computed from closes up to and
including t, and trades execute at t's close — i.e. "trade the close on the
signal of the close". Tighten to t+1 open by taste; the engine samples
scores.shift(1) when `signal_lag` is set in params.
"""
from typing import Callable

import numpy as np
import pandas as pd

from ..data import BENCHMARK, SYMBOLS, get_provider, is_intraday, normalize, periods_per_year
from ..risk import SlippageConfig, apply_slippage, drawdown_series, rolling_sharpe, summarize
from ..signals import build_signal
from .portfolio import Portfolio

MAX_TRADES_IN_PAYLOAD = 1000


def rebalance_dates(dates: pd.DatetimeIndex, freq: str) -> set:
    if freq == "every_bar":
        return set(dates)  # trade every bar (intraday-friendly)
    if freq == "weekly":
        keys = dates.to_series().groupby([dates.isocalendar().year, dates.isocalendar().week]).first()
        return set(keys)
    if freq == "monthly":
        keys = dates.to_series().groupby([dates.year, dates.month]).first()
        return set(keys)
    # daily: first bar of each calendar day. On daily data that's every bar; on
    # intraday it's once per session (the open).
    keys = dates.to_series().groupby(dates.normalize()).first()
    return set(keys)


def target_weights(row: pd.Series, mode: str, top_n: int) -> dict[str, float]:
    """Convert one date's score row into target portfolio weights."""
    scores = row.dropna()
    if scores.empty:
        return {}
    if mode == "long_short":
        n = min(top_n, len(scores) // 2) or 1
        longs = scores.nlargest(n)
        shorts = scores.nsmallest(n)
        w = {}
        w.update({s: 0.5 / n for s in longs.index if longs[s] > 0})
        w.update({s: -0.5 / n for s in shorts.index if shorts[s] < 0})
        return w
    if mode == "signal_weight":
        pos = scores.clip(lower=0)
        total = pos.sum()
        if total <= 0:
            return {}
        return {s: float(pos[s] / total) for s in pos.index if pos[s] > 0}
    # long_top (default): equal-weight the top N positive scores
    n = min(top_n, len(scores)) or 1
    top = scores.nlargest(n)
    top = top[top > 0]
    if top.empty:
        return {}
    return {s: 1.0 / n for s in top.index}


def run_backtest(
    version,
    start_date: str,
    end_date: str,
    initial_capital: float,
    on_progress: Callable[[float], None] | None = None,
) -> dict:
    # ICT / event strategies use a separate engine (entry/stop/target) but
    # return the same payload shape.
    from ..ict import is_ict, run_ict_backtest
    if is_ict(version.signal_type):
        return run_ict_backtest(version, start_date, end_date, initial_capital, on_progress)

    provider = get_provider()
    symbols = list(version.universe) or SYMBOLS[:10]
    slip_cfg = SlippageConfig.from_dict(version.slippage)
    timeframe = normalize(getattr(version, "timeframe", "1d"))
    ppy = periods_per_year(timeframe)

    # Data window: daily pulls full history (cheap, cached) for signal warmup;
    # intraday pulls the requested span plus a short warmup pad (minute history
    # is too large to backfill wholesale).
    if is_intraday(timeframe):
        data_start = (pd.Timestamp(start_date) - pd.Timedelta(days=10)).strftime("%Y-%m-%d")
        data_end = end_date
    else:
        data_start = data_end = None

    closes = provider.closes(symbols, data_start, data_end, timeframe)
    signal = build_signal(version.signal_type, version.params, code=version.code)
    scores = signal.generate(closes)
    if int(version.params.get("signal_lag", 0)):
        scores = scores.shift(int(version.params["signal_lag"]))

    # ML trade filter (meta-labeling) — optional, see app/ml/filter.py
    ml_filter_cfg = getattr(version, "ml_filter", None) or {}
    filter_result = None
    if ml_filter_cfg.get("enabled"):
        from ..ml.filter import FilterConfig, build_filter_mask

        fcfg = FilterConfig(
            model=ml_filter_cfg.get("model", "random_forest"),
            threshold=float(ml_filter_cfg.get("threshold", 0.55)),
            rebalance=version.rebalance,
            position_mode=version.position_mode,
            top_n=version.top_n,
            retrain_every_days=int(ml_filter_cfg.get("retrain_days", 63)),
            train_window_days=int(ml_filter_cfg.get("train_window_days", 504)),
        )
        filter_result = build_filter_mask(closes, scores, fcfg)

    model_diag = getattr(signal, "diagnostics", None)

    end_ts = pd.Timestamp(end_date) + pd.Timedelta(hours=23, minutes=59, seconds=59)
    window = closes.loc[(closes.index >= pd.Timestamp(start_date)) & (closes.index <= end_ts)]
    if len(window) < 5:
        raise ValueError("Backtest window contains fewer than 5 bars of data")
    dates = window.index
    rebal = rebalance_dates(dates, version.rebalance)
    label_fmt = "%Y-%m-%d %H:%M" if is_intraday(timeframe) else "%Y-%m-%d"
    date_strs = [d.strftime(label_fmt) for d in dates]
    days_index = {ds: i for i, ds in enumerate(date_strs)}

    # Per-symbol stats the impact model needs (same timeframe + window as closes)
    volumes = {s: provider.history(s, data_start, data_end, timeframe)["volume"] for s in symbols}
    sigmas = {s: float(closes[s].pct_change().std()) for s in symbols}

    pf = Portfolio(cash=initial_capital)
    equity_curve: list[float] = []
    exposure: list[float] = []
    orders: list[dict] = []
    slippage_totals = {"fixed": 0.0, "pct": 0.0, "impact": 0.0, "total": 0.0}

    for i, (ts, ds) in enumerate(zip(dates, date_strs)):
        prices = {s: float(window.at[ts, s]) for s in symbols if not np.isnan(window.at[ts, s])}

        if ts in rebal:
            eq = pf.equity(prices)
            weights = target_weights(scores.loc[ts], version.position_mode, version.top_n)
            if filter_result is not None and weights:
                # gate every leg (long and short) by the model's take/skip mask
                kept = {s: w for s, w in weights.items() if bool(filter_result.mask.get((ts, s), True))}
                # rescale each side back to the strategy's original gross exposure,
                # so skipping trades concentrates the survivors rather than letting
                # net exposure drift (keeps long_short dollar-neutral)
                orig_pos = sum(w for w in weights.values() if w > 0)
                orig_neg = sum(w for w in weights.values() if w < 0)
                kept_pos = sum(w for w in kept.values() if w > 0)
                kept_neg = sum(w for w in kept.values() if w < 0)
                pos_scale = orig_pos / kept_pos if kept_pos > 0 else 0.0
                neg_scale = orig_neg / kept_neg if kept_neg < 0 else 0.0
                weights = {s: w * (pos_scale if w > 0 else neg_scale) for s, w in kept.items()}
            # Sells first so cash frees up before buys
            deltas = []
            for sym in set(list(weights) + [s for s in pf.positions if abs(pf.qty(s)) > 1e-9]):
                px = prices.get(sym)
                if px is None or px <= 0:
                    continue
                target_qty = (weights.get(sym, 0.0) * eq) / px
                delta = target_qty - pf.qty(sym)
                if abs(delta * px) < eq * 0.001:  # ignore dust rebalances (<0.1% equity)
                    continue
                deltas.append((sym, delta, px))
            deltas.sort(key=lambda d: d[1])  # negative (sells) first

            for sym, delta, px in deltas:
                side = "buy" if delta > 0 else "sell"
                adv = float(volumes[sym].tail(21).mean()) if sym in volumes else 1e7
                fill_px, costs = apply_slippage(side, px, delta, slip_cfg, daily_vol_shares=adv, daily_sigma=sigmas.get(sym, 0.015))
                pf.fill(sym, delta, fill_px, ds, days_index)
                for k in slippage_totals:
                    slippage_totals[k] += costs[k]
                orders.append({"date": ds, "symbol": sym, "side": side, "qty": round(abs(delta), 2), "price": round(fill_px, 4), "slippage": round(costs["total"], 2)})

        eq = pf.equity(prices)
        equity_curve.append(eq)
        exposure.append(pf.market_value(prices) / eq if eq else 0.0)
        if on_progress and (i % 50 == 0 or i == len(dates) - 1):
            on_progress((i + 1) / len(dates))

    equity = pd.Series(equity_curve, index=dates)

    # Benchmark: SPY scaled to the same starting capital
    bench_closes = provider.history(BENCHMARK, data_start or start_date, data_end or end_date, timeframe)["close"].reindex(dates).ffill()
    benchmark = bench_closes / bench_closes.iloc[0] * initial_capital

    trades = pf.closed_trades
    metrics = summarize(equity, benchmark, trades, ppy=ppy)
    metrics["total_slippage"] = round(slippage_totals["total"], 2)
    metrics["turnover_orders"] = len(orders)

    dd = drawdown_series(equity)
    rs = rolling_sharpe(equity.pct_change().fillna(0.0), 63, ppy=ppy)

    payload = {
        "dates": date_strs,
        "equity": [round(v, 2) for v in equity.tolist()],
        "benchmark": [round(v, 2) for v in benchmark.tolist()],
        "drawdown": [round(v, 5) for v in dd.fillna(0.0).tolist()],
        "rolling_sharpe": [None if pd.isna(v) else round(v, 3) for v in rs.tolist()],
        "exposure": [round(v, 4) for v in exposure],
        "metrics": metrics,
        "trades": trades[-MAX_TRADES_IN_PAYLOAD:],
        "trades_total": len(trades),
        "open_positions": pf.open_positions({s: float(window[s].iloc[-1]) for s in symbols}),
        "slippage_breakdown": {k: round(v, 2) for k, v in slippage_totals.items()},
        "config": {
            "symbols": symbols,
            "signal_type": version.signal_type,
            "params": version.params,
            "timeframe": timeframe,
            "rebalance": version.rebalance,
            "position_mode": version.position_mode,
            "top_n": version.top_n,
            "slippage": slip_cfg.to_dict(),
            "start": start_date,
            "end": end_date,
            "initial_capital": initial_capital,
        },
    }
    if filter_result is not None:
        payload["ml_filter"] = {
            **filter_result.diagnostics,
            "metrics": filter_result.metrics,
            "importances": filter_result.importances,
            "n_folds": filter_result.n_folds,
        }
    if model_diag:
        payload["ml_model"] = model_diag
    return payload
