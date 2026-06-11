"""Signal registry: key → class, plus catalog metadata for the builder UI."""
from dataclasses import asdict

from .base import Signal
from .custom import CustomCodeSignal
from .mean_reversion import Bollinger, PairsSpread, ZScoreReversion
from .ml import MlSignal
from .momentum import Breakout, Macd, Rsi, SmaCrossover, TimeSeriesMomentum

_REGISTRY: dict[str, type[Signal]] = {
    cls.meta.key: cls
    for cls in (
        SmaCrossover, TimeSeriesMomentum, Rsi, Macd, Breakout,
        ZScoreReversion, Bollinger, PairsSpread,
        MlSignal,
    )
}


def catalog() -> list[dict]:
    out = []
    for cls in _REGISTRY.values():
        meta = asdict(cls.meta)
        out.append(meta)
    return out


def build_signal(signal_type: str, params: dict | None = None, code: str = "") -> Signal:
    if signal_type == "custom":
        return CustomCodeSignal(params, code=code)
    cls = _REGISTRY.get(signal_type)
    if cls is None:
        raise KeyError(f"Unknown signal type: {signal_type}")
    return cls(params)
