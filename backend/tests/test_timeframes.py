import pandas as pd

from app.backtest.runner import run_backtest
from app.data import get_provider


class V5m:
    signal_type = "sma_crossover"
    params = {"fast": 10, "slow": 20}
    code = ""
    universe = ["AAPL", "MSFT", "NVDA", "JPM"]
    timeframe = "5m"
    rebalance = "daily"
    position_mode = "long_top"
    top_n = 2
    slippage = {}
    ml_filter = {}


def _recent_window(days: int) -> tuple[str, str]:
    end = pd.Timestamp.today().normalize()
    start = end - pd.Timedelta(days=days)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def test_intraday_provider_returns_minute_bars():
    df = get_provider().history("AAPL", timeframe="5m")
    assert not df.empty
    # index carries a time component (intraday), not midnight-only
    assert (df.index.minute != 0).any() or (df.index.hour != 0).any()
    assert list(df.columns) == ["open", "high", "low", "close", "volume"]


def test_intraday_5m_backtest_runs():
    start, end = _recent_window(20)
    r = run_backtest(V5m(), start, end, 100_000.0)
    assert r["config"]["timeframe"] == "5m"
    assert len(r["equity"]) > 50  # many intraday bars in the window
    assert " " in r["dates"][0]  # label has a HH:MM time component


def test_single_asset_daily_backtest():
    class VSingle(V5m):
        timeframe = "1d"
        universe = ["AAPL"]
        top_n = 1

    r = run_backtest(VSingle(), "2019-01-01", "2021-01-01", 100_000.0)
    assert r["config"]["symbols"] == ["AAPL"]
    assert len(r["equity"]) > 200
    # daily labels have no time component
    assert " " not in r["dates"][0]


def test_timeframe_defaults_to_daily_when_absent():
    class VNoTf:
        signal_type = "sma_crossover"
        params = {"fast": 20, "slow": 100}
        code = ""
        universe = ["AAPL", "MSFT", "NVDA", "JPM"]
        rebalance = "weekly"
        position_mode = "long_top"
        top_n = 2
        slippage = {}
        ml_filter = {}

    r = run_backtest(VNoTf(), "2019-01-01", "2021-01-01", 100_000.0)
    assert r["config"]["timeframe"] == "1d"
