"""ICT strategy catalog. Reuses the SignalMeta shape so these appear in the
builder alongside signals, but they're executed by the event engine, not the
score runner."""
from ..signals.base import ParamSpec, SignalMeta

ICT_FVG = SignalMeta(
    key="ict_fvg",
    label="Fair Value Gap",
    category="ict",
    description="ICT price-action: finds 3-candle fair value gaps (imbalances) and "
                "enters when price retraces to tap the gap — long on bullish gaps, "
                "short on bearish. Exits on a fixed reward:risk target or a stop "
                "beyond the gap. Optionally trades inverse FVGs (a gap that gets "
                "violated flips to act as the opposite level). Trades the regular "
                "session only; intraday positions are flattened at the 4pm close. "
                "One position at a time per asset.",
    params=[
        ParamSpec("min_gap_pct", "Min gap size (%)", 0.10, 0.0, 1.0, 0.05),
        ParamSpec("tap_depth", "Tap depth into gap", 0.0, 0.0, 1.0, 0.1),
        ParamSpec("stop_buffer", "Stop buffer past gap (%)", 0.05, 0.0, 0.5, 0.05),
        ParamSpec("rr", "Reward : risk", 2.0, 0.5, 5.0, 0.5),
        ParamSpec("max_hold", "Max hold (bars, 0=off)", 50, 0, 500, 10),
        ParamSpec("use_ifvg", "Trade inverse FVGs (0/1)", 0, 0, 1, 1),
    ],
)

_REGISTRY = {ICT_FVG.key: ICT_FVG}
ICT_KEYS = frozenset(_REGISTRY)


def is_ict(key: str) -> bool:
    return key in _REGISTRY


def ict_meta(key: str) -> SignalMeta:
    return _REGISTRY[key]


def ict_catalog() -> list[dict]:
    from dataclasses import asdict
    return [asdict(m) for m in _REGISTRY.values()]
