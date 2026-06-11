"""ML-based signal with a pluggable model interface.

Three inference paths, tried in order:

1. PLACEHOLDER[ML INFERENCE ENDPOINT] — set ML_INFERENCE_URL in backend/.env to
   score with a hosted model. Contract:
     POST {url}/score
     body:     {"features": {"AAPL": [[f1, f2, ...], ...], ...},
                "feature_names": ["mom_21", "mom_63", "zscore_20", "vol_21"]}
     response: {"scores": {"AAPL": [s1, s2, ...], ...}}  # one score per row
   Rows are per-date feature vectors; scores must align row-for-row.

2. PLACEHOLDER[SKLEARN/XGBOOST MODEL FILE] — drop a pickled model implementing
   .predict(X: ndarray[n, 4]) -> ndarray[n] at backend/models/signal_model.pkl
   (e.g. sklearn GradientBoostingRegressor, xgboost.XGBRegressor). It receives
   the same feature matrix described above.

3. Built-in fallback: a deterministic linear blend of the features (momentum
   tilt minus reversion stretch). This keeps ML strategies runnable end-to-end
   with no external dependencies — replace it, don't trade it.
"""
import logging
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import get_settings
from .base import ParamSpec, Signal, SignalMeta

log = logging.getLogger("signals.ml")

MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "signal_model.pkl"
FEATURE_NAMES = ["mom_21", "mom_63", "zscore_20", "vol_21"]


def build_features(closes: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Standard feature block consumed by every inference path."""
    rets = closes.pct_change()
    return {
        "mom_21": closes / closes.shift(21) - 1,
        "mom_63": closes / closes.shift(63) - 1,
        "zscore_20": (closes - closes.rolling(20).mean()) / closes.rolling(20).std(),
        "vol_21": rets.rolling(21).std() * np.sqrt(252),
    }


class MlSignal(Signal):
    meta = SignalMeta(
        key="ml_model",
        label="ML Model Score",
        category="ml",
        description="Scores each symbol with a plugged-in model (hosted endpoint or local sklearn/XGBoost pickle) over a standard feature block: 21/63-day momentum, 20-day z-score, 21-day realized vol. Falls back to a labeled linear blend when no model is wired.",
        params=[
            ParamSpec("smoothing", "Score smoothing (days)", 5, 1, 30),
        ],
    )

    def generate(self, closes: pd.DataFrame) -> pd.DataFrame:
        feats = build_features(closes)
        scores = self._infer(closes, feats)
        smooth = int(self.params["smoothing"])
        return scores.rolling(smooth, min_periods=1).mean() if smooth > 1 else scores

    def _infer(self, closes: pd.DataFrame, feats: dict[str, pd.DataFrame]) -> pd.DataFrame:
        settings = get_settings()

        # Path 1 — hosted inference endpoint
        if settings.ml_inference_url:
            try:
                return self._infer_remote(closes, feats, settings.ml_inference_url)
            except Exception as exc:
                log.warning("ML endpoint failed (%s); falling back", exc)

        # Path 2 — local pickled model
        if MODEL_PATH.exists():
            try:
                return self._infer_local(closes, feats)
            except Exception as exc:
                log.warning("Local model failed (%s); falling back", exc)

        # Path 3 — deterministic fallback blend (clearly not a trained model)
        return 0.5 * feats["mom_63"].clip(-0.5, 0.5) * 2 + 0.3 * (-feats["zscore_20"]).clip(-3, 3) / 3 - 0.2 * (
            feats["vol_21"] - feats["vol_21"].mean()
        ).clip(-0.5, 0.5)

    @staticmethod
    def _stack(feats: dict[str, pd.DataFrame], symbol: str) -> np.ndarray:
        return np.column_stack([feats[name][symbol].to_numpy() for name in FEATURE_NAMES])

    def _infer_local(self, closes: pd.DataFrame, feats: dict[str, pd.DataFrame]) -> pd.DataFrame:
        import pickle

        with open(MODEL_PATH, "rb") as fh:
            model = pickle.load(fh)
        out = pd.DataFrame(index=closes.index, columns=closes.columns, dtype=float)
        for sym in closes.columns:
            X = self._stack(feats, sym)
            valid = ~np.isnan(X).any(axis=1)
            preds = np.full(len(X), np.nan)
            if valid.any():
                preds[valid] = model.predict(X[valid])
            out[sym] = preds
        return out

    def _infer_remote(self, closes: pd.DataFrame, feats: dict[str, pd.DataFrame], url: str) -> pd.DataFrame:
        import httpx

        payload = {
            "features": {sym: np.nan_to_num(self._stack(feats, sym)).tolist() for sym in closes.columns},
            "feature_names": FEATURE_NAMES,
        }
        resp = httpx.post(f"{url.rstrip('/')}/score", json=payload, timeout=60)
        resp.raise_for_status()
        scores = resp.json()["scores"]
        out = pd.DataFrame(index=closes.index, columns=closes.columns, dtype=float)
        for sym in closes.columns:
            out[sym] = scores[sym]
        return out
