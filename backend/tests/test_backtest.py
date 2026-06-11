"""Backtest engine: real execution against synthetic data."""
import pandas as pd
import pytest

from app.backtest.portfolio import Portfolio
from app.backtest.runner import run_backtest, target_weights
from app.signals import build_signal


class FakeVersion:
    """Minimal stand-in for the StrategyVersion ORM row."""

    def __init__(self, **kw):
        self.signal_type = kw.get("signal_type", "sma_crossover")
        self.params = kw.get("params", {})
        self.code = kw.get("code", "")
        self.universe = kw.get("universe", ["AAPL", "MSFT", "NVDA", "JPM", "XOM"])
        self.rebalance = kw.get("rebalance", "weekly")
        self.position_mode = kw.get("position_mode", "long_top")
        self.top_n = kw.get("top_n", 3)
        self.slippage = kw.get("slippage", {})


def test_full_backtest_returns_consistent_payload():
    result = run_backtest(FakeVersion(), "2018-01-01", "2020-01-01", 100_000.0)
    n = len(result["dates"])
    assert n > 400
    assert len(result["equity"]) == n
    assert len(result["benchmark"]) == n
    assert len(result["drawdown"]) == n
    assert result["equity"][0] == pytest.approx(100_000, rel=0.02)
    m = result["metrics"]
    for key in ("sharpe", "sortino", "max_drawdown", "cagr", "win_rate", "avg_holding_days", "total_slippage"):
        assert key in m
    assert m["max_drawdown"] <= 0
    assert result["slippage_breakdown"]["total"] > 0
    assert result["trades_total"] >= 1


def test_backtest_is_deterministic():
    a = run_backtest(FakeVersion(), "2019-01-01", "2019-06-01", 50_000.0)
    b = run_backtest(FakeVersion(), "2019-01-01", "2019-06-01", 50_000.0)
    assert a["equity"] == b["equity"]
    assert a["metrics"]["sharpe"] == b["metrics"]["sharpe"]


def test_custom_code_signal_runs():
    code = (
        "def signal(closes, params):\n"
        "    fast = closes.rolling(10).mean()\n"
        "    slow = closes.rolling(50).mean()\n"
        "    return (fast - slow) / slow\n"
    )
    v = FakeVersion(signal_type="custom", code=code, rebalance="monthly")
    result = run_backtest(v, "2019-01-01", "2020-01-01", 100_000.0)
    assert result["metrics"]["num_trades"] >= 0
    assert len(result["equity"]) > 200


def test_custom_code_rejects_imports():
    sig = build_signal("custom", {}, code="import os\ndef signal(c, p):\n    return c")
    with pytest.raises(ValueError, match="import"):
        sig.generate(pd.DataFrame({"A": [1.0, 2.0]}))


def test_target_weights_long_top():
    row = pd.Series({"A": 0.9, "B": 0.5, "C": -0.2, "D": 0.1})
    w = target_weights(row, "long_top", 2)
    assert set(w) == {"A", "B"}
    assert sum(w.values()) == pytest.approx(1.0)


def test_target_weights_long_short():
    row = pd.Series({"A": 0.9, "B": 0.5, "C": -0.8, "D": -0.3})
    w = target_weights(row, "long_short", 1)
    assert w["A"] == pytest.approx(0.5)
    assert w["C"] == pytest.approx(-0.5)


def test_portfolio_fifo_trade_pairing():
    pf = Portfolio(cash=10_000)
    idx = {"2024-01-01": 0, "2024-01-05": 4, "2024-01-10": 9}
    pf.fill("AAPL", 10, 100.0, "2024-01-01", idx)
    pf.fill("AAPL", -10, 110.0, "2024-01-10", idx)
    assert len(pf.closed_trades) == 1
    t = pf.closed_trades[0]
    assert t["pnl"] == pytest.approx(100.0)
    assert t["holding_days"] == 9
    assert pf.cash == pytest.approx(10_000 - 1000 + 1100)


def test_signal_catalog_shapes():
    from app.signals import catalog

    cat = catalog()
    keys = {c["key"] for c in cat}
    assert {"sma_crossover", "rsi", "macd", "breakout", "momentum", "zscore", "bollinger", "pairs", "ml_model"} <= keys
    for c in cat:
        assert c["category"] in {"momentum", "mean_reversion", "ml"}
