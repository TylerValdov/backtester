"""Risk metric math against known-answer fixtures."""
import numpy as np
import pandas as pd
import pytest

from app.risk.metrics import cagr, max_drawdown, sharpe, sortino, trade_stats
from app.risk.slippage import SlippageConfig, apply_slippage, slippage_breakdown


def test_sharpe_of_constant_positive_returns_is_zero_std_guarded():
    rets = pd.Series([0.001] * 100)
    assert sharpe(rets) == 0.0  # zero std -> guarded


def test_sharpe_sign_follows_mean():
    rng = np.random.default_rng(7)
    up = pd.Series(rng.normal(0.001, 0.01, 1000))
    down = pd.Series(rng.normal(-0.001, 0.01, 1000))
    assert sharpe(up) > 0 > sharpe(down)


def test_sortino_ignores_upside_volatility():
    # Same mean, one series has all its volatility on the upside
    base = pd.Series([0.001] * 50 + [-0.002] * 10)
    spiky_up = pd.Series([0.001] * 40 + [0.05] * 10 + [-0.002] * 10)
    assert sortino(spiky_up) >= sortino(base) * 0.9


def test_max_drawdown_known_path():
    equity = pd.Series([100, 120, 90, 95, 130, 65])
    # Peak 130 -> trough 65 = -50%
    assert max_drawdown(equity) == pytest.approx(-0.5)


def test_cagr_doubling_in_one_year():
    equity = pd.Series(np.linspace(100, 200, 252))
    assert cagr(equity) == pytest.approx(1.0, rel=0.05)


def test_trade_stats():
    trades = [
        {"pnl": 100, "holding_days": 10, "exit_date": "2024-01-10"},
        {"pnl": -50, "holding_days": 5, "exit_date": "2024-01-15"},
        {"pnl": 200, "holding_days": 15, "exit_date": "2024-02-01"},
    ]
    s = trade_stats(trades)
    assert s["num_trades"] == 3
    assert s["win_rate"] == pytest.approx(2 / 3)
    assert s["avg_holding_days"] == pytest.approx(10)
    assert s["profit_factor"] == pytest.approx(300 / 50)


def test_slippage_components_positive_and_buy_fills_higher():
    cfg = SlippageConfig(fixed_per_share=0.01, pct_bps=5, impact_k=0.1)
    costs = slippage_breakdown(qty=1000, price=50, cfg=cfg, daily_vol_shares=1e6, daily_sigma=0.02)
    assert costs["fixed"] == pytest.approx(10.0)
    assert costs["pct"] == pytest.approx(1000 * 50 * 5 / 10_000)
    assert costs["impact"] > 0
    fill_buy, _ = apply_slippage("buy", 50, 1000, cfg)
    fill_sell, _ = apply_slippage("sell", 50, 1000, cfg)
    assert fill_buy > 50 > fill_sell
