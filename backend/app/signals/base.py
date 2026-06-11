"""Signal contract.

A signal transforms a close-price matrix (index=dates, columns=symbols) into a
score matrix of the same shape. Scores are cross-sectionally comparable
convictions: positive = long, negative = short, NaN = no opinion. The backtest
runner turns scores into target weights (top-N, long/short, or
signal-weighted) at each rebalance date.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import pandas as pd


@dataclass
class ParamSpec:
    """Describes one tunable parameter for the builder UI (slider metadata)."""

    name: str
    label: str
    default: float
    min: float
    max: float
    step: float = 1


@dataclass
class SignalMeta:
    key: str
    label: str
    category: str  # momentum | mean_reversion | ml
    description: str
    params: list[ParamSpec] = field(default_factory=list)


class Signal(ABC):
    meta: SignalMeta

    def __init__(self, params: dict | None = None) -> None:
        defaults = {p.name: p.default for p in self.meta.params}
        self.params = {**defaults, **(params or {})}

    @abstractmethod
    def generate(self, closes: pd.DataFrame) -> pd.DataFrame:
        """Return score matrix aligned to `closes` (same index/columns)."""
