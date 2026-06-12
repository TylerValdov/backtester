# ML Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a meta-labeling ML trade filter (skip trades a model predicts will lose) and a standalone trainable ML strategy, both walk-forward validated, to the backtester.

**Architecture:** A shared `backend/app/ml/` core (features, model factory, walk-forward harness) powers two consumers: `filter.py` (gates a base strategy's long entries) integrated into the backtest runner, and `ranker.py` (a new `ml_trained` Signal) consumed by the runner unchanged. Frontend gains builder controls and results panels.

**Tech Stack:** Python 3.13, scikit-learn 1.9, xgboost 3.2, pandas, numpy, FastAPI, SQLAlchemy; Next.js 16 + TypeScript frontend.

**Spec:** `docs/superpowers/specs/2026-06-11-ml-features-design.md`

**Conventions:** run tests from `backend/` with `../.venv/Scripts/python -m pytest`. The existing `backend/tests/conftest.py` forces the synthetic provider, so all ML tests run offline. Models use a fixed `random_state=7` for reproducibility.

---

## File structure

| File | Responsibility |
| --- | --- |
| `backend/app/ml/__init__.py` | Package exports |
| `backend/app/ml/features.py` | Entry feature block (date × symbol matrices) |
| `backend/app/ml/models.py` | Model factory + metric/importance helpers |
| `backend/app/ml/walkforward.py` | Anchored walk-forward harness (lookahead-safe) |
| `backend/app/ml/filter.py` | Feature 1: meta-labeling trade filter |
| `backend/app/ml/ranker.py` | Feature 2: `MlTrainedSignal` (`ml_trained`) |
| `backend/app/backtest/runner.py` | Apply filter mask; attach ML diagnostics |
| `backend/app/models.py` | `StrategyVersion.ml_filter` JSON column |
| `backend/app/api/strategies.py` | Accept `ml_filter` in `VersionIn` |
| `backend/app/api/deps.py` | Extend `enforce_ml_access` |
| `backend/app/signals/registry.py` | Register `ml_trained` |
| `frontend/components/charts/FeatureImportance.tsx` | Horizontal importance bars |
| `frontend/lib/types.ts` | `ml_filter` / `ml_model` payload types |
| `frontend/app/build/page.tsx` | ML filter panel + `ml_trained` params |
| `frontend/app/backtests/[id]/page.tsx` | ML diagnostics panels |
| `backend/tests/test_ml_*.py` | Unit + integration tests |

---

## Task 1: Dependencies + feature engineering

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/app/ml/__init__.py`
- Create: `backend/app/ml/features.py`
- Test: `backend/tests/test_ml_features.py`

- [ ] **Step 1: Add dependencies**

Append to `backend/requirements.txt`:

```
scikit-learn>=1.4
xgboost>=2.0
```

Install (already present in the venv, this is for fresh checkouts):

```bash
cd backend && ../.venv/Scripts/python -m pip install -r requirements.txt
```

- [ ] **Step 2: Create the package init**

Create `backend/app/ml/__init__.py`:

```python
"""Machine-learning core: shared features, model factory, walk-forward harness,
plus the trade filter (meta-labeling) and trained ranking strategy."""
```

- [ ] **Step 3: Write the failing test**

Create `backend/tests/test_ml_features.py`:

```python
import numpy as np
import pandas as pd
import pytest

from app.ml.features import FEATURE_NAMES_FILTER, FEATURE_NAMES_RANK, build_feature_panel


def _closes(n=300, syms=("AAPL", "MSFT", "SPY")):
    idx = pd.bdate_range("2020-01-01", periods=n)
    rng = np.random.default_rng(1)
    data = {}
    for i, s in enumerate(syms):
        steps = rng.normal(0.0005, 0.01, n)
        data[s] = 100 * np.exp(np.cumsum(steps)) + i
    return pd.DataFrame(data, index=idx)


def test_panel_has_all_features_aligned():
    closes = _closes()
    scores = closes.pct_change(20)  # stand-in base signal
    panel = build_feature_panel(closes, base_scores=scores)
    for name in FEATURE_NAMES_FILTER:
        assert name in panel, f"missing {name}"
        assert panel[name].shape == closes.shape
        assert list(panel[name].columns) == list(closes.columns)


def test_rank_panel_excludes_signal():
    closes = _closes()
    panel = build_feature_panel(closes, base_scores=None)
    assert "signal" not in panel
    assert set(FEATURE_NAMES_RANK).issubset(panel.keys())


def test_features_use_only_past_data():
    # Editing a future price must not change a feature value at an earlier date.
    closes = _closes()
    scores = closes.pct_change(20)
    panel_a = build_feature_panel(closes, base_scores=scores)
    closes2 = closes.copy()
    closes2.iloc[250:] *= 1.5  # mutate the future
    panel_b = build_feature_panel(closes2, base_scores=scores)
    t = closes.index[200]
    for name in ("mom_21", "mom_63", "zscore_20", "rsi_14", "vol_21", "dist_ma200"):
        a = panel_a[name].loc[t, "AAPL"]
        b = panel_b[name].loc[t, "AAPL"]
        assert (np.isnan(a) and np.isnan(b)) or a == pytest.approx(b), name


def test_regime_flags_are_binary_and_relative_rank_in_unit_interval():
    closes = _closes()
    panel = build_feature_panel(closes, base_scores=None)
    spy = panel["spy_above_200"].dropna()
    assert set(np.unique(spy.to_numpy())).issubset({0.0, 1.0})
    rank = panel["mom_rank"].dropna()
    assert rank.to_numpy().min() >= 0.0 and rank.to_numpy().max() <= 1.0
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_ml_features.py -q`
Expected: FAIL (ModuleNotFoundError: app.ml.features)

- [ ] **Step 5: Implement features.py**

Create `backend/app/ml/features.py`:

```python
"""Entry feature block. Every feature at date t derives only from data <= t."""
import numpy as np
import pandas as pd

from ..data import BENCHMARK

FEATURE_NAMES_RANK = [
    "mom_21", "mom_63", "zscore_20", "rsi_14", "vol_21",
    "dist_ma200", "mom_rank", "spy_above_200", "spy_mom_21",
]
FEATURE_NAMES_FILTER = ["signal", *FEATURE_NAMES_RANK]


def _rsi(closes: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    delta = closes.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)) / 100  # scaled to [0, 1]


def build_feature_panel(closes: pd.DataFrame, base_scores: pd.DataFrame | None) -> dict[str, pd.DataFrame]:
    cols = closes.columns
    panel: dict[str, pd.DataFrame] = {}

    panel["mom_21"] = closes / closes.shift(21) - 1
    panel["mom_63"] = closes / closes.shift(63) - 1
    panel["zscore_20"] = (closes - closes.rolling(20).mean()) / closes.rolling(20).std()
    panel["rsi_14"] = _rsi(closes, 14)
    panel["vol_21"] = closes.pct_change().rolling(21).std() * np.sqrt(252)
    ma200 = closes.rolling(200).mean()
    panel["dist_ma200"] = (closes - ma200) / ma200
    # cross-sectional percentile rank of 63d momentum across the universe at t
    panel["mom_rank"] = panel["mom_63"].rank(axis=1, pct=True)

    # market regime from the benchmark, broadcast to every column
    if BENCHMARK in closes.columns:
        spy = closes[BENCHMARK]
    else:
        spy = closes.mean(axis=1)  # fallback proxy if SPY absent from the frame
    spy_above = (spy > spy.rolling(200).mean()).astype(float)
    spy_mom = spy / spy.shift(21) - 1
    panel["spy_above_200"] = pd.DataFrame({c: spy_above for c in cols})
    panel["spy_mom_21"] = pd.DataFrame({c: spy_mom for c in cols})

    if base_scores is not None:
        panel["signal"] = base_scores.reindex(index=closes.index, columns=cols)

    return panel


def assemble_matrix(panel: dict[str, pd.DataFrame], feature_names: list[str],
                    keys: pd.MultiIndex) -> np.ndarray:
    """Build an (n_samples, n_features) matrix for the given (date, symbol) keys."""
    cols = []
    for name in feature_names:
        df = panel[name]
        cols.append(df.stack().reindex(keys).to_numpy())
    return np.column_stack(cols)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_ml_features.py -q`
Expected: PASS (4 passed)

- [ ] **Step 7: Commit**

```bash
git add backend/requirements.txt backend/app/ml/__init__.py backend/app/ml/features.py backend/tests/test_ml_features.py
git commit -m "feat(ml): entry feature block (lookahead-safe)"
```

---

## Task 2: Model factory + metrics

**Files:**
- Create: `backend/app/ml/models.py`
- Test: `backend/tests/test_ml_models.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ml_models.py`:

```python
import numpy as np
import pytest

from app.ml.models import (
    MODEL_TYPES, classification_metrics, feature_importance,
    make_model, regression_metrics,
)


def _separable(n=400):
    rng = np.random.default_rng(0)
    X = rng.normal(size=(n, 3))
    y = (X[:, 0] + 0.5 * X[:, 1] > 0).astype(int)
    return X, y


@pytest.mark.parametrize("kind", sorted(MODEL_TYPES))
def test_classifier_learns_separable_signal(kind):
    X, y = _separable()
    model = make_model(kind, task="clf")
    model.fit(X[:300], y[:300])
    prob = model.predict_proba(X[300:])[:, 1]
    m = classification_metrics(y[300:], prob)
    assert m["auc"] > 0.8
    assert 0 <= m["precision"] <= 1


@pytest.mark.parametrize("kind", sorted(MODEL_TYPES))
def test_feature_importance_keys(kind):
    X, y = _separable()
    model = make_model(kind, task="clf")
    model.fit(X, y)
    imp = feature_importance(model, ["a", "b", "c"])
    assert set(imp) == {"a", "b", "c"}
    assert all(v >= 0 for v in imp.values())


def test_regression_metrics():
    y = np.array([0.01, -0.02, 0.03, -0.01])
    pred = np.array([0.02, -0.01, 0.01, -0.02])
    m = regression_metrics(y, pred)
    assert "r2" in m and "directional_accuracy" in m
    assert m["directional_accuracy"] == pytest.approx(1.0)  # signs all match


def test_determinism():
    X, y = _separable()
    a = make_model("random_forest", "clf"); a.fit(X, y)
    b = make_model("random_forest", "clf"); b.fit(X, y)
    assert np.allclose(a.predict_proba(X), b.predict_proba(X))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_ml_models.py -q`
Expected: FAIL (ModuleNotFoundError: app.ml.models)

- [ ] **Step 3: Implement models.py**

Create `backend/app/ml/models.py`:

```python
"""Model factory + metric helpers. Fixed random_state for reproducible runs."""
import numpy as np
from sklearn.ensemble import (
    GradientBoostingClassifier, GradientBoostingRegressor,
    RandomForestClassifier, RandomForestRegressor,
)
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import precision_score, r2_score, recall_score, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

MODEL_TYPES = {"logistic", "random_forest", "gradient_boosting", "xgboost"}
SEED = 7


def make_model(kind: str, task: str = "clf"):
    if kind not in MODEL_TYPES:
        raise ValueError(f"Unknown model: {kind}")
    if kind == "logistic":
        if task == "clf":
            return Pipeline([("s", StandardScaler()), ("m", LogisticRegression(max_iter=1000, random_state=SEED))])
        return Pipeline([("s", StandardScaler()), ("m", Ridge(random_state=SEED))])
    if kind == "random_forest":
        cls = RandomForestClassifier if task == "clf" else RandomForestRegressor
        return cls(n_estimators=200, max_depth=6, min_samples_leaf=20, n_jobs=-1, random_state=SEED)
    if kind == "gradient_boosting":
        cls = GradientBoostingClassifier if task == "clf" else GradientBoostingRegressor
        return cls(n_estimators=200, max_depth=3, learning_rate=0.05, random_state=SEED)
    # xgboost — lazy import so a missing wheel only errors when chosen
    from xgboost import XGBClassifier, XGBRegressor

    cls = XGBClassifier if task == "clf" else XGBRegressor
    return cls(n_estimators=200, max_depth=4, learning_rate=0.05, subsample=0.8,
               n_jobs=-1, random_state=SEED, verbosity=0)


def feature_importance(model, feature_names: list[str]) -> dict[str, float]:
    est = model.named_steps["m"] if isinstance(model, Pipeline) else model
    if hasattr(est, "feature_importances_"):
        vals = np.asarray(est.feature_importances_, dtype=float)
    elif hasattr(est, "coef_"):
        vals = np.abs(np.ravel(est.coef_)).astype(float)
    else:
        vals = np.zeros(len(feature_names))
    total = vals.sum() or 1.0
    return {n: float(v / total) for n, v in zip(feature_names, vals)}


def classification_metrics(y_true, y_prob) -> dict:
    y_true = np.asarray(y_true)
    y_prob = np.asarray(y_prob)
    pred = (y_prob >= 0.5).astype(int)
    out = {
        "precision": float(precision_score(y_true, pred, zero_division=0)),
        "recall": float(recall_score(y_true, pred, zero_division=0)),
        "accuracy": float((pred == y_true).mean()),
        "auc": 0.5,
    }
    if len(np.unique(y_true)) > 1:
        out["auc"] = float(roc_auc_score(y_true, y_prob))
    return out


def regression_metrics(y_true, y_pred) -> dict:
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)
    return {
        "r2": float(r2_score(y_true, y_pred)) if len(y_true) > 1 else 0.0,
        "directional_accuracy": float((np.sign(y_true) == np.sign(y_pred)).mean()),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_ml_models.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/ml/models.py backend/tests/test_ml_models.py
git commit -m "feat(ml): model factory + metrics"
```

---

## Task 3: Walk-forward harness (lookahead-safe)

**Files:**
- Create: `backend/app/ml/walkforward.py`
- Test: `backend/tests/test_ml_walkforward.py`

- [ ] **Step 1: Write the failing test (includes the leakage guard)**

Create `backend/tests/test_ml_walkforward.py`:

```python
import numpy as np
import pandas as pd

from app.ml.walkforward import WalkForwardConfig, walk_forward_predict

CFG = WalkForwardConfig(train_window_days=120, retrain_every_days=30, min_train_samples=50)


def _samples(n_dates=400, n_syms=6, seed=0):
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2020-01-01", periods=n_dates)
    rows = []
    for d in dates:
        for s in range(n_syms):
            f1, f2 = rng.normal(), rng.normal()
            label = int(f1 + 0.3 * rng.normal() > 0)
            rows.append({"date": d, "symbol": f"S{s}", "label": label,
                         "resolved": d + pd.Timedelta(days=5), "f1": f1, "f2": f2})
    return pd.DataFrame(rows)


def test_predictions_are_out_of_sample_only():
    s = _samples()
    res = walk_forward_predict(s, ["f1", "f2"], CFG, "logistic", "clf")
    # the warmup region (before the first cutoff) has no predictions
    early = s["date"] < s["date"].min() + pd.Timedelta(days=CFG.train_window_days)
    early_keys = pd.MultiIndex.from_arrays([s.loc[early, "date"], s.loc[early, "symbol"]])
    assert res.predictions.reindex(early_keys).isna().all()
    assert res.n_folds >= 3


def test_predictions_do_not_depend_on_future_labels():
    # The canonical lookahead guard: a model predicting an early fold trained
    # only on samples resolved before its cutoff. Mutating labels in the *future*
    # (the back of the timeline) must NOT change predictions for the early
    # region — a leaky harness that trained on unresolved/future samples would
    # change them. This distinguishes a clean harness from a leaky one without
    # depending on a feature that secretly contains the answer.
    s = _samples(n_dates=400, seed=5)
    res_a = walk_forward_predict(s, ["f1", "f2"], CFG, "random_forest", "clf")

    s2 = s.copy()
    cut = s2["date"].quantile(0.6)
    future = s2["date"] >= cut
    s2.loc[future, "label"] = 1 - s2.loc[future, "label"]  # flip the future
    res_b = walk_forward_predict(s2, ["f1", "f2"], CFG, "random_forest", "clf")

    early_keys = pd.MultiIndex.from_arrays([s.loc[~future, "date"], s.loc[~future, "symbol"]])
    a = res_a.predictions.reindex(early_keys).dropna()
    b = res_b.predictions.reindex(early_keys).dropna()
    common = a.index.intersection(b.index)
    assert len(common) > 0  # there ARE early out-of-sample predictions to compare
    assert np.allclose(a.loc[common].to_numpy(), b.loc[common].to_numpy())


def test_unresolved_samples_excluded_from_training():
    # A sample whose label resolves AFTER a cutoff must not train that cutoff.
    s = _samples(n_dates=200)
    # make the last 50 dates' samples resolve far in the future
    late = s["date"] > s["date"].iloc[-1] - pd.Timedelta(days=20)
    s.loc[late, "resolved"] = s["date"].max() + pd.Timedelta(days=365)
    res = walk_forward_predict(s, ["f1", "f2"], CFG, "random_forest", "clf")
    assert res.n_folds >= 1  # still runs using only resolved history
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_ml_walkforward.py -q`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implement walkforward.py**

Create `backend/app/ml/walkforward.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_ml_walkforward.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/ml/walkforward.py backend/tests/test_ml_walkforward.py
git commit -m "feat(ml): walk-forward harness with lookahead guards"
```

---

## Task 4: Meta-labeling trade filter

**Files:**
- Create: `backend/app/ml/filter.py`
- Test: `backend/tests/test_ml_filter.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ml_filter.py`:

```python
import numpy as np
import pandas as pd

from app.data import get_provider
from app.ml.filter import FilterConfig, build_filter_mask
from app.signals import build_signal


def _setup():
    closes = get_provider().closes(["AAPL", "MSFT", "NVDA", "JPM", "XOM", "UNH", "GLD", "SPY"])
    closes = closes.loc[closes.index >= "2018-01-01"]
    scores = build_signal("sma_crossover", {"fast": 20, "slow": 100}).generate(closes)
    return closes, scores


def test_mask_aligns_and_reduces_or_equals_candidates():
    closes, scores = _setup()
    cfg = FilterConfig(model="random_forest", threshold=0.55, rebalance="weekly",
                       position_mode="long_top", top_n=4)
    res = build_filter_mask(closes, scores, cfg)
    assert isinstance(res.mask, pd.Series)  # MultiIndex(date, symbol) -> bool
    # diagnostics present
    for k in ("pct_taken", "avg_return_taken", "avg_return_skipped", "n_candidates"):
        assert k in res.diagnostics
    assert 0.0 <= res.diagnostics["pct_taken"] <= 1.0
    assert res.n_folds >= 1


def test_high_threshold_takes_fewer_trades():
    closes, scores = _setup()
    lo = build_filter_mask(closes, scores, FilterConfig(model="logistic", threshold=0.50,
                            rebalance="weekly", position_mode="long_top", top_n=4))
    hi = build_filter_mask(closes, scores, FilterConfig(model="logistic", threshold=0.70,
                            rebalance="weekly", position_mode="long_top", top_n=4))
    assert hi.diagnostics["pct_taken"] <= lo.diagnostics["pct_taken"] + 1e-9
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_ml_filter.py -q`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implement filter.py**

Create `backend/app/ml/filter.py`:

```python
"""Feature 1 — meta-labeling trade filter. Builds one training sample per
candidate long entry (features at entry -> did it beat costs over the holding
period), walk-forward predicts P(win), and returns a take/skip mask."""
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .features import FEATURE_NAMES_FILTER, build_feature_panel
from .walkforward import WalkForwardConfig, walk_forward_predict


@dataclass
class FilterConfig:
    model: str = "random_forest"
    threshold: float = 0.55
    rebalance: str = "weekly"
    position_mode: str = "long_top"
    top_n: int = 5
    cost_hurdle: float = 0.001       # holding return must beat this to count as a win
    train_window_days: int = 504
    retrain_every_days: int = 63
    min_train_samples: int = 200


@dataclass
class FilterResult:
    mask: pd.Series                  # MultiIndex(date, symbol) -> bool (take?)
    diagnostics: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)
    importances: dict = field(default_factory=dict)
    n_folds: int = 0


def build_filter_mask(closes: pd.DataFrame, base_scores: pd.DataFrame, cfg: FilterConfig) -> FilterResult:
    from ..backtest.runner import rebalance_dates, target_weights

    panel = build_feature_panel(closes, base_scores=base_scores)
    rebal = sorted(d for d in rebalance_dates(closes.index, cfg.rebalance) if d in closes.index)

    rows = []
    for i, d in enumerate(rebal):
        weights = target_weights(base_scores.loc[d], cfg.position_mode, cfg.top_n)
        longs = [s for s, w in weights.items() if w > 0]
        if not longs:
            continue
        nxt = rebal[i + 1] if i + 1 < len(rebal) else closes.index[-1]
        for sym in longs:
            entry = closes.at[d, sym]
            exit_ = closes.at[nxt, sym]
            if pd.isna(entry) or pd.isna(exit_) or entry <= 0:
                continue
            ret = exit_ / entry - 1
            feats = {name: panel[name].at[d, sym] for name in FEATURE_NAMES_FILTER}
            rows.append({"date": d, "symbol": sym, "label": int(ret > cfg.cost_hurdle),
                         "resolved": nxt, "holding_return": ret, **feats})

    samples = pd.DataFrame(rows)
    if samples.empty:
        return FilterResult(pd.Series(dtype=bool))

    wf = WalkForwardConfig(cfg.train_window_days, cfg.retrain_every_days, cfg.min_train_samples)
    res = walk_forward_predict(samples, FEATURE_NAMES_FILTER, wf, cfg.model, "clf")

    keys = pd.MultiIndex.from_arrays([samples["date"], samples["symbol"]])
    prob = res.predictions.reindex(keys)
    # before the first trained fold there is no prediction -> take the trade
    take = (prob.isna()) | (prob >= cfg.threshold)
    mask = pd.Series(take.to_numpy(), index=keys)

    taken = samples["holding_return"][take.to_numpy()]
    skipped = samples["holding_return"][~take.to_numpy()]
    diagnostics = {
        "n_candidates": int(len(samples)),
        "pct_taken": float(take.mean()),
        "avg_return_taken": float(taken.mean()) if len(taken) else 0.0,
        "avg_return_skipped": float(skipped.mean()) if len(skipped) else 0.0,
        "threshold": cfg.threshold,
        "model": cfg.model,
    }
    return FilterResult(mask, diagnostics, res.metrics, res.importances, res.n_folds)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_ml_filter.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/ml/filter.py backend/tests/test_ml_filter.py
git commit -m "feat(ml): meta-labeling trade filter"
```

---

## Task 5: Runner integration + schema

**Files:**
- Modify: `backend/app/models.py` (add `ml_filter` column)
- Modify: `backend/app/backtest/runner.py` (apply mask, attach diagnostics)
- Test: `backend/tests/test_ml_runner.py`

- [ ] **Step 1: Add the schema column**

In `backend/app/models.py`, inside `class StrategyVersion`, after the `slippage` column add:

```python
    ml_filter: Mapped[dict] = mapped_column(JSON, default=dict)
```

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_ml_runner.py`:

```python
from app.backtest.runner import run_backtest


class V:
    signal_type = "sma_crossover"
    params = {"fast": 20, "slow": 100}
    code = ""
    universe = ["AAPL", "MSFT", "NVDA", "AMZN", "JPM", "XOM", "UNH", "GLD"]
    rebalance = "weekly"
    position_mode = "long_top"
    top_n = 4
    slippage = {}
    ml_filter = {"enabled": True, "model": "random_forest", "threshold": 0.55}


def test_backtest_with_filter_attaches_diagnostics():
    r = run_backtest(V(), "2018-06-01", "2021-06-01", 100_000.0)
    assert "ml_filter" in r
    d = r["ml_filter"]
    assert "pct_taken" in d and "metrics" in d and "importances" in d
    assert 0.0 <= d["pct_taken"] <= 1.0
    assert len(r["equity"]) > 200


def test_filter_disabled_when_flag_absent():
    class W(V):
        ml_filter = {}
    r = run_backtest(W(), "2018-06-01", "2020-06-01", 100_000.0)
    assert "ml_filter" not in r
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_ml_runner.py -q`
Expected: FAIL (KeyError 'ml_filter' / attribute handling)

- [ ] **Step 4: Integrate into runner.py**

In `backend/app/backtest/runner.py`, after `scores = signal.generate(closes)` and the `signal_lag` block, add filter computation:

```python
    # ML trade filter (meta-labeling) — optional, see app/ml/filter.py
    ml_filter_cfg = getattr(version, "ml_filter", None) or {}
    filter_result = None
    if ml_filter_cfg.get("enabled"):
        from ..ml.filter import FilterConfig, build_filter_mask

        fcfg = FilterConfig(
            model=ml_filter_cfg.get("model", "random_forest"),
            threshold=float(ml_filter_cfg.get("threshold", 0.55)),
            rebalance=version.rebalance,
            position_mode=version.position_mode,
            top_n=version.top_n,
            retrain_every_days=int(ml_filter_cfg.get("retrain_days", 63)),
            train_window_days=int(ml_filter_cfg.get("train_window_days", 504)),
        )
        filter_result = build_filter_mask(closes, scores, fcfg)
```

Then in the rebalance loop, where `weights = target_weights(...)` is computed, gate and renormalize. Replace the existing `weights = target_weights(scores.loc[ts], version.position_mode, version.top_n)` with:

```python
            weights = target_weights(scores.loc[ts], version.position_mode, version.top_n)
            if filter_result is not None and weights:
                kept = {}
                for sym, w in weights.items():
                    if w <= 0 or bool(filter_result.mask.get((ts, sym), True)):
                        kept[sym] = w
                pos_total = sum(w for w in kept.values() if w > 0)
                if pos_total > 0:
                    weights = {s: (w / pos_total if w > 0 else w) for s, w in kept.items()}
                else:
                    weights = {}
```

Finally, before the `return {` payload, build the diagnostics block, and add it to the returned dict:

```python
    payload = {
        # ... existing keys unchanged ...
    }
    if filter_result is not None:
        payload["ml_filter"] = {
            **filter_result.diagnostics,
            "metrics": filter_result.metrics,
            "importances": filter_result.importances,
            "n_folds": filter_result.n_folds,
        }
    return payload
```

(Rename the existing `return { ... }` to `payload = { ... }` and `return payload`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_ml_runner.py -q`
Expected: PASS

- [ ] **Step 6: Run the full backend suite (no regressions)**

Run: `cd backend && ../.venv/Scripts/python -m pytest -q`
Expected: PASS (all prior tests + new ML tests)

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/app/backtest/runner.py backend/tests/test_ml_runner.py
git commit -m "feat(ml): apply trade filter in backtest runner"
```

---

## Task 6: Standalone trained ML strategy (`ml_trained`)

**Files:**
- Create: `backend/app/ml/ranker.py`
- Modify: `backend/app/signals/registry.py`
- Test: `backend/tests/test_ml_ranker.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ml_ranker.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_ml_ranker.py -q`
Expected: FAIL (unknown signal 'ml_trained')

- [ ] **Step 3: Implement ranker.py**

Create `backend/app/ml/ranker.py`:

```python
"""Feature 2 — trained ranking strategy. The model is the signal: walk-forward
out-of-sample forward-return predictions become the cross-sectional score."""
import pandas as pd

from ..signals.base import ParamSpec, Signal, SignalMeta
from .features import FEATURE_NAMES_RANK, build_feature_panel
from .walkforward import WalkForwardConfig, walk_forward_predict

# model_kind param is numeric (slider-friendly): 0=logistic,1=random_forest,2=gradient_boosting,3=xgboost
_KINDS = ["logistic", "random_forest", "gradient_boosting", "xgboost"]


class MlTrainedSignal(Signal):
    meta = SignalMeta(
        key="ml_trained",
        label="ML Trained (walk-forward)",
        category="ml",
        description="Trains a model to predict forward returns from a standard feature block, "
                    "walk-forward (out-of-sample), and ranks the universe by the prediction. "
                    "Model: 0=logistic 1=random-forest 2=gradient-boost 3=xgboost.",
        params=[
            ParamSpec("model_kind", "Model (0-3)", 1, 0, 3),
            ParamSpec("horizon", "Forward-return horizon (days)", 21, 5, 63),
            ParamSpec("retrain", "Retrain cadence (days)", 63, 21, 126),
            ParamSpec("train_window", "Initial train window (days)", 504, 252, 1008),
        ],
    )

    def __init__(self, params: dict | None = None) -> None:
        super().__init__(params)
        self.diagnostics: dict = {}

    def generate(self, closes: pd.DataFrame) -> pd.DataFrame:
        panel = build_feature_panel(closes, base_scores=None)
        horizon = int(self.params["horizon"])
        fwd = closes.shift(-horizon) / closes - 1  # label: forward return (resolved at t+horizon)

        rows = []
        dates = closes.index
        for ti, d in enumerate(dates):
            resolved = dates[min(ti + horizon, len(dates) - 1)]
            for sym in closes.columns:
                label = fwd.at[d, sym]
                if pd.isna(label):
                    continue
                feats = {name: panel[name].at[d, sym] for name in FEATURE_NAMES_RANK}
                rows.append({"date": d, "symbol": sym, "label": label, "resolved": resolved, **feats})

        samples = pd.DataFrame(rows)
        kind = _KINDS[int(self.params["model_kind"]) % len(_KINDS)]
        wf = WalkForwardConfig(int(self.params["train_window"]), int(self.params["retrain"]), 200)
        res = walk_forward_predict(samples, FEATURE_NAMES_RANK, wf, kind, "reg")
        self.diagnostics = {"metrics": res.metrics, "importances": res.importances, "n_folds": res.n_folds, "model": kind}

        scores = pd.DataFrame(index=closes.index, columns=closes.columns, dtype=float)
        if not res.predictions.empty:
            wide = res.predictions.unstack()  # date × symbol
            scores.loc[wide.index, wide.columns] = wide
        return scores
```

- [ ] **Step 4: Register the signal**

In `backend/app/signals/registry.py`, import and add to the registry tuple:

```python
from ..ml.ranker import MlTrainedSignal
```

and include `MlTrainedSignal` in the `_REGISTRY` comprehension tuple (after `MlSignal`).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_ml_ranker.py -q`
Expected: PASS

- [ ] **Step 6: Surface ranker diagnostics in the runner**

In `backend/app/backtest/runner.py`, after `scores = signal.generate(closes)` (and after the filter block), add:

```python
    model_diag = getattr(signal, "diagnostics", None)
```

and before `return payload`, add:

```python
    if model_diag:
        payload["ml_model"] = model_diag
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/ml/ranker.py backend/app/signals/registry.py backend/app/backtest/runner.py backend/tests/test_ml_ranker.py
git commit -m "feat(ml): trained ranking strategy (ml_trained)"
```

---

## Task 7: API + plan gate

**Files:**
- Modify: `backend/app/api/strategies.py` (`VersionIn.ml_filter`)
- Modify: `backend/app/api/deps.py` (`enforce_ml_access`)
- Test: extend `backend/tests/test_api.py`

- [ ] **Step 1: Add `ml_filter` to VersionIn**

In `backend/app/api/strategies.py`, in `class VersionIn`, add field:

```python
    ml_filter: dict = Field(default_factory=dict)
```

The existing `StrategyVersion(..., **body.version.model_dump())` / `**body.model_dump()` calls now pass `ml_filter` straight through (the column exists from Task 5).

Also include it in the response so the builder can hydrate it. In `_version_payload` (same file), add `"ml_filter": v.ml_filter,` to the returned dict.

- [ ] **Step 2: Extend the ML plan gate**

In `backend/app/api/deps.py`, replace `enforce_ml_access`:

```python
def enforce_ml_access(user: User, signal_type: str, ml_filter: dict | None = None) -> None:
    uses_ml = signal_type in ("ml_model", "ml_trained") or bool((ml_filter or {}).get("enabled"))
    if uses_ml and not limits_for(user)["ml"]:
        raise HTTPException(402, "ML signals and the ML trade filter are a Pro feature. Upgrade to use them.")
```

In `backend/app/api/strategies.py`, update the two call sites to pass the filter:
- `create_strategy`: `enforce_ml_access(user, body.version.signal_type, body.version.ml_filter)`
- `add_version`: `enforce_ml_access(user, body.signal_type, body.ml_filter)`

- [ ] **Step 3: Write the failing test**

Add to `backend/tests/test_api.py`:

```python
def test_ml_filter_gated_to_pro(client):
    _signup_and_login(client)
    body = {**STRATEGY_BODY, "name": "Filtered",
            "version": {**STRATEGY_BODY["version"], "ml_filter": {"enabled": True, "model": "logistic"}}}
    assert client.post("/api/strategies", json=body).status_code == 402
    client.post("/api/settings/plan", json={"plan": "pro"})
    assert client.post("/api/strategies", json=body).status_code == 201


def test_ml_trained_signal_gated_to_pro(client):
    _signup_and_login(client)
    body = {**STRATEGY_BODY, "name": "Trained",
            "version": {**STRATEGY_BODY["version"], "signal_type": "ml_trained"}}
    assert client.post("/api/strategies", json=body).status_code == 402
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_api.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/strategies.py backend/app/api/deps.py backend/tests/test_api.py
git commit -m "feat(ml): accept ml_filter in API, gate ML to Pro"
```

---

## Task 8: Frontend — types + FeatureImportance chart + builder controls

**Files:**
- Modify: `frontend/lib/types.ts`
- Create: `frontend/components/charts/FeatureImportance.tsx`
- Modify: `frontend/app/build/page.tsx`

- [ ] **Step 1: Add payload types**

In `frontend/lib/types.ts`, add:

```typescript
export type MlFilterResult = {
  n_candidates: number;
  pct_taken: number;
  avg_return_taken: number;
  avg_return_skipped: number;
  threshold: number;
  model: string;
  metrics: { precision?: number; recall?: number; accuracy?: number; auc?: number };
  importances: Record<string, number>;
  n_folds: number;
};

export type MlModelResult = {
  metrics: { r2?: number; directional_accuracy?: number };
  importances: Record<string, number>;
  n_folds: number;
  model: string;
};
```

Add to `BacktestResult`:

```typescript
  ml_filter?: MlFilterResult;
  ml_model?: MlModelResult;
```

Add to `StrategyVersion`:

```typescript
  ml_filter?: Record<string, unknown>;
```

- [ ] **Step 2: Create the FeatureImportance chart**

Create `frontend/components/charts/FeatureImportance.tsx`:

```tsx
"use client";

// Horizontal bars of relative feature importance (already normalized to sum 1).

export function FeatureImportance({ importances }: { importances: Record<string, number> }) {
  const rows = Object.entries(importances).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...rows.map(([, v]) => v), 0.0001);
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map(([name, v]) => (
        <li key={name} className="grid grid-cols-[8.5rem_1fr_3rem] items-center gap-2 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
          <span className="truncate text-[var(--color-muted)]" title={name}>{name}</span>
          <span className="h-2 rounded-[2px] bg-[var(--color-paper-3)]">
            <span className="block h-full rounded-[2px] bg-[var(--color-accent)]" style={{ width: `${(v / max) * 100}%` }} />
          </span>
          <span className="tnum text-right text-[var(--color-neutral)]">{(v * 100).toFixed(0)}%</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Add the ML filter panel to the builder**

In `frontend/app/build/page.tsx`:

1. Add state near the other config state:

```tsx
  const [mlFilter, setMlFilter] = useState({ enabled: false, model: "random_forest", threshold: 0.55, retrain_days: 63 });
```

2. Include it in the `versionBody` object built in `runBacktest`:

```tsx
      ml_filter: mlFilter.enabled ? mlFilter : {},
```

3. Add a panel after the "execution" Panel (uses existing `Panel`, `SelectField`, `Button` primitives):

```tsx
          <Panel title="ml trade filter" right={
            <button
              onClick={() => setMlFilter({ ...mlFilter, enabled: !mlFilter.enabled })}
              className="press text-xs"
              style={{ fontFamily: "var(--font-mono)", color: mlFilter.enabled ? "var(--color-accent)" : "var(--color-neutral)" }}
            >
              {mlFilter.enabled ? "on" : "off"}
            </button>
          }>
            {mlFilter.enabled ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <SelectField label="Model" value={mlFilter.model} onChange={(v) => setMlFilter({ ...mlFilter, model: v })}
                  options={[
                    { value: "logistic", label: "Logistic" },
                    { value: "random_forest", label: "Random forest" },
                    { value: "gradient_boosting", label: "Gradient boosting" },
                    { value: "xgboost", label: "XGBoost" },
                  ]} />
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs uppercase tracking-[0.08em] text-[var(--color-neutral)]">
                    Min win probability: <span className="text-[var(--color-accent)]">{mlFilter.threshold.toFixed(2)}</span>
                  </label>
                  <input type="range" min={0.4} max={0.8} step={0.01} value={mlFilter.threshold}
                    onChange={(e) => setMlFilter({ ...mlFilter, threshold: Number(e.target.value) })}
                    className="accent-[var(--color-accent)]" />
                </div>
                <SelectField label="Retrain cadence" value={String(mlFilter.retrain_days)}
                  onChange={(v) => setMlFilter({ ...mlFilter, retrain_days: Number(v) })}
                  options={[{ value: "21", label: "Monthly" }, { value: "63", label: "Quarterly" }, { value: "126", label: "Semiannual" }]} />
                <p className="text-xs text-[var(--color-neutral)] sm:col-span-3">
                  Trains on this strategy&rsquo;s own past trades (walk-forward) and skips entries below the win-probability threshold. Pro feature.
                </p>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-neutral)]">
                Off. Enable to train a model on this strategy&rsquo;s trades and skip the ones it predicts will lose.
              </p>
            )}
          </Panel>
```

4. When loading an existing strategy (the `setExisting` effect), hydrate the filter if present:

```tsx
          if (v.ml_filter && (v.ml_filter as { enabled?: boolean }).enabled) {
            setMlFilter({ enabled: true, model: "random_forest", threshold: 0.55, retrain_days: 63, ...(v.ml_filter as object) });
          }
```

- [ ] **Step 4: Build the frontend**

Run: `cd frontend && npm run build`
Expected: Compiled successfully, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/types.ts frontend/components/charts/FeatureImportance.tsx frontend/app/build/page.tsx
git commit -m "feat(ml): builder controls + feature-importance chart"
```

---

## Task 9: Frontend — results panels

**Files:**
- Modify: `frontend/app/backtests/[id]/page.tsx`

- [ ] **Step 1: Import the chart**

Add: `import { FeatureImportance } from "@/components/charts/FeatureImportance";`

- [ ] **Step 2: Render the ML filter panel**

Inside the results JSX (after the slippage/risk grid, still within `r && m`), add:

```tsx
            {r.ml_filter && (
              <Panel title="ml trade filter">
                <div className="grid gap-5 lg:grid-cols-[1fr_1fr_1.2fr]">
                  <div className="flex flex-col gap-3">
                    <Stat label="Trades taken" value={fmtPct(r.ml_filter.pct_taken, 0)} tone="accent"
                      sub={`${r.ml_filter.n_candidates} candidates · ${r.ml_filter.model}`} />
                    <Stat label="Avg return · taken" value={fmtPct(r.ml_filter.avg_return_taken, 2)}
                      tone={r.ml_filter.avg_return_taken >= 0 ? "up" : "down"} />
                    <Stat label="Avg return · skipped" value={fmtPct(r.ml_filter.avg_return_skipped, 2)}
                      tone={r.ml_filter.avg_return_skipped >= 0 ? "up" : "down"}
                      sub={r.ml_filter.avg_return_taken > r.ml_filter.avg_return_skipped ? "filter skipped the weaker trades" : "filter did not separate winners"} />
                  </div>
                  <dl className="tnum flex flex-col gap-2 text-sm" style={{ fontFamily: "var(--font-mono)" }}>
                    {([["precision", r.ml_filter.metrics.precision], ["recall", r.ml_filter.metrics.recall],
                       ["accuracy", r.ml_filter.metrics.accuracy], ["auc", r.ml_filter.metrics.auc]] as const).map(([k, v]) => (
                      <div key={k} className="flex justify-between border-b border-[var(--color-rule-soft)] pb-2">
                        <dt className="text-[var(--color-neutral)]">{k}</dt>
                        <dd className="text-[var(--color-ink)]">{v === undefined ? "—" : fmtNum(v, 2)}</dd>
                      </div>
                    ))}
                    <div className="flex justify-between pt-1">
                      <dt className="text-[var(--color-muted)]">walk-forward folds</dt>
                      <dd className="text-[var(--color-ink)]">{r.ml_filter.n_folds}</dd>
                    </div>
                  </dl>
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.1em] text-[var(--color-neutral)]">feature importance</p>
                    <FeatureImportance importances={r.ml_filter.importances} />
                  </div>
                </div>
              </Panel>
            )}
```

- [ ] **Step 3: Render the trained-model panel**

```tsx
            {r.ml_model && (
              <Panel title="ml model · out-of-sample">
                <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
                  <dl className="tnum flex flex-col gap-2 text-sm" style={{ fontFamily: "var(--font-mono)" }}>
                    <div className="flex justify-between border-b border-[var(--color-rule-soft)] pb-2">
                      <dt className="text-[var(--color-neutral)]">model</dt><dd className="text-[var(--color-ink)]">{r.ml_model.model}</dd>
                    </div>
                    <div className="flex justify-between border-b border-[var(--color-rule-soft)] pb-2">
                      <dt className="text-[var(--color-neutral)]">directional acc.</dt>
                      <dd className="text-[var(--color-ink)]">{fmtPct(r.ml_model.metrics.directional_accuracy ?? 0, 0)}</dd>
                    </div>
                    <div className="flex justify-between border-b border-[var(--color-rule-soft)] pb-2">
                      <dt className="text-[var(--color-neutral)]">r²</dt><dd className="text-[var(--color-ink)]">{fmtNum(r.ml_model.metrics.r2 ?? 0, 3)}</dd>
                    </div>
                    <div className="flex justify-between pt-1">
                      <dt className="text-[var(--color-muted)]">walk-forward folds</dt><dd className="text-[var(--color-ink)]">{r.ml_model.n_folds}</dd>
                    </div>
                  </dl>
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.1em] text-[var(--color-neutral)]">feature importance</p>
                    <FeatureImportance importances={r.ml_model.importances} />
                  </div>
                </div>
              </Panel>
            )}
```

- [ ] **Step 4: Build the frontend**

Run: `cd frontend && npm run build`
Expected: Compiled successfully.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/backtests/[id]/page.tsx
git commit -m "feat(ml): results panels for filter + trained model"
```

---

## Task 10: End-to-end verification

**Files:** none (manual verification)

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && ../.venv/Scripts/python -m pytest -q`
Expected: all PASS.

- [ ] **Step 2: Restart backend, build frontend**

Restart the backend (picks up the new column/code), `cd frontend && npm run build`.

- [ ] **Step 3: Browser check — trade filter**

Via the running app: sign in, upgrade to Pro in Settings, open the builder, pick SMA Crossover, enable the ML trade filter (random forest, threshold 0.60), run a 3-year backtest. Confirm the results page shows the "ml trade filter" panel with % taken, taken-vs-skipped returns, precision/recall/AUC, and feature-importance bars.

- [ ] **Step 4: Browser check — trained strategy**

New strategy, signal "ML Trained (walk-forward)", run a backtest. Confirm the "ml model · out-of-sample" panel renders with directional accuracy and feature importance.

- [ ] **Step 5: Final commit (docs/log)**

```bash
git add -A
git commit -m "docs(ml): mark ML features complete"
```

---

## Self-review notes

- **Spec coverage:** features (T1), models incl. XGBoost (T2), walk-forward + lookahead test (T3), filter + taken-vs-skipped diagnostic (T4), runner integration + schema (T5), `ml_trained` standalone (T6), API + Pro gate (T7), UI builder + results + FeatureImportance chart (T8–T9), e2e (T10). All spec sections mapped.
- **Long/short scope:** filter gates `w > 0` legs only; short legs pass through (matches spec v1 note).
- **Determinism:** `SEED=7` across models; tests assert reproducibility.
- **Offline tests:** conftest forces synthetic provider, so ML tests never hit Alpaca.
