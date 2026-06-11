"""Slippage / transaction cost models.

Three components, all configurable per strategy version:

- fixed:      flat cost per share (e.g. $0.005) — commission-like
- pct_bps:    proportional cost in basis points of notional — spread crossing
- impact:     square-root market impact: k * sigma * sqrt(participation),
              where participation = order shares / average daily volume.
              The classic Almgren-style approximation; punishes size.
"""
from dataclasses import dataclass


@dataclass
class SlippageConfig:
    fixed_per_share: float = 0.005
    pct_bps: float = 2.0
    impact_k: float = 0.1

    @classmethod
    def from_dict(cls, d: dict | None) -> "SlippageConfig":
        d = d or {}
        return cls(
            fixed_per_share=float(d.get("fixed_per_share", 0.005)),
            pct_bps=float(d.get("pct_bps", 2.0)),
            impact_k=float(d.get("impact_k", 0.1)),
        )

    def to_dict(self) -> dict:
        return {"fixed_per_share": self.fixed_per_share, "pct_bps": self.pct_bps, "impact_k": self.impact_k}


def slippage_breakdown(
    qty: float,
    price: float,
    cfg: SlippageConfig,
    daily_vol_shares: float = 1e7,
    daily_sigma: float = 0.015,
) -> dict:
    """Cost components in dollars for an order of |qty| shares at `price`."""
    shares = abs(qty)
    notional = shares * price
    fixed = shares * cfg.fixed_per_share
    pct = notional * cfg.pct_bps / 10_000
    participation = shares / max(daily_vol_shares, 1.0)
    impact = cfg.impact_k * daily_sigma * (participation**0.5) * notional
    return {"fixed": fixed, "pct": pct, "impact": impact, "total": fixed + pct + impact}


def apply_slippage(side: str, price: float, qty: float, cfg: SlippageConfig, **kw) -> tuple[float, dict]:
    """Effective fill price after costs (buys fill higher, sells lower)."""
    costs = slippage_breakdown(qty, price, cfg, **kw)
    per_share = costs["total"] / max(abs(qty), 1e-9)
    fill = price + per_share if side == "buy" else price - per_share
    return fill, costs
