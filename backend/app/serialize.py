"""JSON-safety for result payloads.

Postgres' JSON type rejects the non-finite tokens NaN/Infinity (SQLite silently
accepted them). Backtest metrics can legitimately produce them — e.g. a profit
factor with no losing trades (inf), or a blown-up equity curve. Replace every
non-finite float with null before the payload is stored or returned."""
import math
from typing import Any


def json_safe(obj: Any) -> Any:
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    return obj
