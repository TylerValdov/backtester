from app.backtest.runner import run_backtest


class V:
    signal_type = "sma_crossover"
    params = {"fast": 20, "slow": 100}
    code = ""
    universe = ["AAPL", "MSFT", "NVDA", "AMZN", "JPM", "XOM", "UNH", "GLD"]
    rebalance = "weekly"
    position_mode = "long_top"
    top_n = 4
    slippage = {}
    ml_filter = {"enabled": True, "model": "random_forest", "threshold": 0.55}


def test_backtest_with_filter_attaches_diagnostics():
    r = run_backtest(V(), "2018-06-01", "2021-06-01", 100_000.0)
    assert "ml_filter" in r
    d = r["ml_filter"]
    assert "pct_taken" in d and "metrics" in d and "importances" in d
    assert 0.0 <= d["pct_taken"] <= 1.0
    assert len(r["equity"]) > 200


def test_filter_disabled_when_flag_absent():
    class W(V):
        ml_filter = {}
    r = run_backtest(W(), "2018-06-01", "2020-06-01", 100_000.0)
    assert "ml_filter" not in r
