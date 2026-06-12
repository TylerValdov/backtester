"""Anchored (expanding-window) walk-forward. No lookahead:
- a model predicting on a window starting at cutoff C trains only on samples
  whose label resolved strictly before C
- features were already computed from data <= each sample's date (features.py)
"""
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .models import classification_metrics, feature_importance, make_model, regression_metrics


@dataclass
class WalkForwardConfig:
    train_window_days: int = 504
    retrain_every_days: int = 63
    min_train_samples: int = 200


@dataclass
class WalkForwardResult:
    predictions: pd.Series  # index MultiIndex(date, symbol) -> prob/value (NaN = out-of-sample gap)
    metrics: dict = field(default_factory=dict)
    importances: dict = field(default_factory=dict)
    n_folds: int = 0


def walk_forward_predict(samples: pd.DataFrame, feature_names: list[str],
                         cfg: WalkForwardConfig, model_kind: str, task: str) -> WalkForwardResult:
    s = samples.dropna(subset=feature_names).sort_values("date").reset_index(drop=True)
    keys = pd.MultiIndex.from_arrays([s["date"], s["symbol"]])
    preds = pd.Series(np.nan, index=range(len(s)), dtype=float)
    if s.empty:
        return WalkForwardResult(pd.Series(dtype=float))

    dates = s["date"]
    min_d, max_d = dates.min(), dates.max()
    cutoffs: list[pd.Timestamp] = []
    c = min_d + pd.Timedelta(days=cfg.train_window_days)
    while c <= max_d:
        cutoffs.append(c)
        c += pd.Timedelta(days=cfg.retrain_every_days)

    X_all = s[feature_names].to_numpy()
    y_all = s["label"].to_numpy()
    last_importance: dict = {}
    n_folds = 0

    for i, cut in enumerate(cutoffs):
        nxt = cutoffs[i + 1] if i + 1 < len(cutoffs) else max_d + pd.Timedelta(days=1)
        train_mask = (s["resolved"] < cut).to_numpy()
        if train_mask.sum() < cfg.min_train_samples:
            continue
        test_mask = ((dates >= cut) & (dates < nxt)).to_numpy()
        if not test_mask.any():
            continue
        if task == "clf" and len(np.unique(y_all[train_mask])) < 2:
            continue
        model = make_model(model_kind, task)
        model.fit(X_all[train_mask], y_all[train_mask])
        if task == "clf":
            preds.iloc[np.where(test_mask)[0]] = model.predict_proba(X_all[test_mask])[:, 1]
        else:
            preds.iloc[np.where(test_mask)[0]] = model.predict(X_all[test_mask])
        last_importance = feature_importance(model, feature_names)
        n_folds += 1

    predictions = pd.Series(preds.to_numpy(), index=keys)
    resolved = preds.notna().to_numpy()
    if resolved.any():
        if task == "clf":
            metrics = classification_metrics(y_all[resolved], preds.to_numpy()[resolved])
        else:
            metrics = regression_metrics(y_all[resolved], preds.to_numpy()[resolved])
    else:
        metrics = {}
    return WalkForwardResult(predictions, metrics, last_importance, n_folds)
