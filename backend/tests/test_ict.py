import numpy as np
import pandas as pd

from app.backtest.runner import run_backtest
from app.ict.engine import FvgConfig, run_ict_backtest, simulate_symbol
from app.ict.fvg import detect_gap


def test_detect_bullish_and_bearish_gap():
    # bar2.low (11) > bar0.high (10) -> bullish gap [10, 11]
    h = np.array([10.0, 11.5, 12.0])
    l = np.array([9.5, 10.1, 11.0])
    c = np.array([9.8, 11.2, 11.8])
    g = detect_gap(h, l, c, 2, 0.001)
    assert g is not None and g.kind == "bull" and g.bottom == 10.0 and g.top == 11.0

    # bar2.high (19) < bar0.low (20) -> bearish gap [19, 20]
    h2 = np.array([21.0, 20.0, 19.0])
    l2 = np.array([20.0, 18.5, 18.0])
    c2 = np.array([20.5, 19.0, 18.2])
    g2 = detect_gap(h2, l2, c2, 2, 0.001)
    assert g2 is not None and g2.kind == "bear" and g2.bottom == 19.0 and g2.top == 20.0


def test_tiny_gap_rejected_by_min_size():
    h = np.array([10.0, 10.2, 10.3])
    l = np.array([9.9, 10.05, 10.001])  # gap [10.0, 10.001] ~0.01% < 1%
    c = np.array([9.95, 10.1, 10.2])
    assert detect_gap(h, l, c, 2, 0.01) is None


def test_engine_enters_and_takes_profit_on_bullish_fvg():
    # 0-2 form a bullish gap [10,11]; bar3 taps it; bar4 runs to the target.
    rows = [
        (10.0, 10.0, 9.5, 9.8),
        (10.2, 11.5, 10.1, 11.2),
        (11.3, 12.0, 11.0, 11.8),   # gap [10,11] created here
        (11.5, 11.6, 10.5, 10.8),   # taps the gap (low 10.5 <= 11) -> long @ 11
        (11.0, 13.5, 11.0, 13.2),   # high 13.5 hits the 2R target
        (13.0, 13.2, 12.8, 13.0),
    ]
    idx = pd.bdate_range("2022-01-03", periods=len(rows))
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=idx)
    df["volume"] = 1_000_000

    cfg = FvgConfig(min_gap_frac=0.001, rr=2.0)
    _eq, _exp, trades, _slip = simulate_symbol("TEST", df, cfg, 100_000.0, bps=0.0, intraday=False)
    assert len(trades) == 1
    t = trades[0]
    assert t["side"] == "long" and t["pnl"] > 0
    assert abs(t["entry_price"] - 11.0) < 1e-6


def test_intraday_position_flattens_at_session_end():
    # bullish gap + tap on day 1; price then sits between stop and target so the
    # only thing that closes it is the 4pm session-end flatten (no overnight).
    ts = [
        "2022-01-03 09:30", "2022-01-03 09:35", "2022-01-03 09:40",
        "2022-01-03 09:45", "2022-01-03 15:55",   # last bar of day 1
        "2022-01-04 09:30",
    ]
    rows = [
        (10.0, 10.0, 9.5, 9.8),
        (10.2, 11.5, 10.1, 11.2),
        (11.3, 12.0, 11.0, 11.8),   # gap [10, 11]
        (11.5, 11.6, 10.5, 11.4),   # taps -> long @ 11
        (11.4, 11.7, 11.2, 11.5),   # between stop and target -> flattened here
        (11.5, 11.6, 11.3, 11.4),   # next day; should never be held into
    ]
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=pd.to_datetime(ts))
    df["volume"] = 1_000_000

    cfg = FvgConfig(min_gap_frac=0.001, rr=2.0)
    _eq, _exp, trades, _slip = simulate_symbol("TEST", df, cfg, 100_000.0, bps=0.0, intraday=True)
    assert len(trades) == 1
    assert trades[0]["exit_date"].startswith("2022-01-03")  # closed same session, not overnight


class VICT:
    signal_type = "ict_fvg"
    params = {"min_gap_pct": 0.05, "tap_depth": 0.0, "stop_buffer": 0.05, "rr": 2.0,
              "max_hold": 50, "use_ifvg": 0, "rth_only": 1}
    code = ""
    universe = ["AAPL", "MSFT"]
    timeframe = "1d"
    rebalance = "daily"
    position_mode = "long_top"
    top_n = 1
    slippage = {"pct_bps": 2}
    ml_filter = {}


def test_run_ict_backtest_payload_shape():
    r = run_ict_backtest(VICT(), "2018-06-01", "2021-06-01", 100_000.0)
    for key in ("dates", "equity", "benchmark", "drawdown", "metrics", "trades", "config"):
        assert key in r
    assert r["config"]["signal_type"] == "ict_fvg"
    assert len(r["equity"]) > 200
    assert len(r["equity"]) == len(r["dates"])


def test_runner_dispatches_ict():
    # run_backtest must route ICT keys to the event engine
    r = run_backtest(VICT(), "2018-06-01", "2020-06-01", 100_000.0)
    assert r["config"]["position_mode"] == "ict_fvg"
    assert r["config"]["rebalance"] == "event"
