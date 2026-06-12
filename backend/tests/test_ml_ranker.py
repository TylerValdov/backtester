import numpy as np

from app.data import get_provider
from app.signals import build_signal, catalog


def test_ml_trained_in_catalog():
    keys = {c["key"] for c in catalog()}
    assert "ml_trained" in keys
    meta = next(c for c in catalog() if c["key"] == "ml_trained")
    assert meta["category"] == "ml"


def test_ml_trained_produces_out_of_sample_scores():
    closes = get_provider().closes(["AAPL", "MSFT", "NVDA", "JPM", "XOM", "UNH", "GLD", "SPY"])
    closes = closes.loc[closes.index >= "2018-01-01"]
    sig = build_signal("ml_trained", {"model_kind": 1, "horizon": 21})
    scores = sig.generate(closes)
    assert scores.shape == closes.shape
    # warmup region is NaN; later region has finite predictions
    assert scores.iloc[:300].isna().all().all()
    assert scores.iloc[-50:].notna().any().any()
    assert sig.diagnostics["n_folds"] >= 1
