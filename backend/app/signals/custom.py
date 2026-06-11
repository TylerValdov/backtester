"""User-authored signal code.

Strategy Builder users write a Python function against pandas:

    def signal(closes, params):
        # closes: DataFrame (index=dates, columns=symbols)
        # return: DataFrame of scores, same shape
        fast = closes.rolling(int(params.get("fast", 20))).mean()
        slow = closes.rolling(int(params.get("slow", 100))).mean()
        return (fast - slow) / slow

Execution uses a restricted namespace: no imports, no file/network builtins —
only numpy, pandas and a whitelist of safe builtins are visible. This is a
guardrail against accidents, not a sandbox against a hostile author; the
platform is single-tenant by design. For multi-tenant deployments run user
code in a subprocess jail or container instead.
"""
import numpy as np
import pandas as pd

from .base import Signal, SignalMeta

_SAFE_BUILTINS = {
    "abs": abs, "min": min, "max": max, "sum": sum, "len": len, "range": range,
    "round": round, "int": int, "float": float, "bool": bool, "str": str,
    "list": list, "dict": dict, "tuple": tuple, "set": set, "enumerate": enumerate,
    "zip": zip, "map": map, "filter": filter, "sorted": sorted, "any": any, "all": all,
    "print": print,
}

_BANNED_TOKENS = ("import", "__", "open(", "exec(", "eval(", "compile(", "globals(", "locals(")


class CustomCodeSignal(Signal):
    meta = SignalMeta(
        key="custom",
        label="Custom Code",
        category="momentum",  # category comes from the parent strategy
        description="Hand-written signal function executed against the close matrix.",
        params=[],
    )

    def __init__(self, params: dict | None = None, code: str = "") -> None:
        super().__init__(params)
        self.code = code

    def generate(self, closes: pd.DataFrame) -> pd.DataFrame:
        for token in _BANNED_TOKENS:
            if token in self.code:
                raise ValueError(f"Custom signal code may not contain '{token}'")

        namespace: dict = {"np": np, "pd": pd, "__builtins__": _SAFE_BUILTINS}
        exec(self.code, namespace)  # noqa: S102 — restricted namespace, see module docstring
        fn = namespace.get("signal")
        if not callable(fn):
            raise ValueError("Custom code must define a function: def signal(closes, params)")

        result = fn(closes, dict(self.params))
        if not isinstance(result, pd.DataFrame):
            raise ValueError("signal() must return a pandas DataFrame of scores")
        return result.reindex(index=closes.index, columns=closes.columns)
