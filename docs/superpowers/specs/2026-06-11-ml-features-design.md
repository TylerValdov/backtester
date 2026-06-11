# ML Features — Design Spec (2026-06-11)

Two machine-learning features for the backtester, sharing one ML core:

1. **ML trade filter (meta-labeling)** — train a model on a strategy's own
   candidate trades so it only takes the ones it predicts will win.
2. **Standalone trainable ML strategy** — the model is the signal: walk-forward
   predictions of forward return drive the cross-sectional ranking.

Decisions locked in brainstorming: build **both**; **walk-forward** validation;
**scikit-learn + XGBoost**.

## Goals & non-goals

**Goals**
- Per-strategy trade-quality filter that demonstrably skips losers, validated
  out-of-sample.
- A standalone trained-model strategy that ranks the universe from learned
  features, validated out-of-sample.
- Rigorous lookahead safety — the headline correctness property.
- Reproducible runs (fixed `random_state`).

**Non-goals**
- Deep learning / sequence models. Tabular models only.
- Hyperparameter search/tuning UI (future work).
- Online/incremental learning. Retraining is batch, walk-forward.

## Architecture — shared `app/ml/` core

```
app/ml/
  features.py     # entry feature block (date, symbol) -> feature matrix
  models.py       # model factory + fit/predict_proba + metrics
  walkforward.py  # anchored walk-forward harness (no lookahead)
  filter.py       # Feature 1: meta-labeling trade filter
  ranker.py       # Feature 2: trained ranking signal
```

### features.py

`build_feature_panel(closes, base_scores) -> dict[str, pd.DataFrame]` returning
one aligned DataFrame per feature, each indexed by date × symbol. Features (all
computed from data ≤ t):

- `signal` — the base strategy's score (filter only; for the ranker this is omitted)
- `mom_21`, `mom_63` — trailing returns
- `zscore_20` — rolling z-score of price
- `rsi_14` — Wilder RSI
- `vol_21` — annualized realized vol
- `dist_ma200` — (price − 200-day MA) / 200-day MA
- `mom_rank` — cross-sectional percentile rank of `mom_63` across the universe at t
- `spy_above_200` — 1.0 if SPY > its 200-day MA else 0.0 (market regime)
- `spy_mom_21` — SPY 21-day return

A helper assembles these into an `X` matrix (rows = samples, cols = features)
for a given set of (date, symbol) sample keys, plus a `feature_names` list.

### models.py

```python
MODEL_TYPES = {"logistic", "random_forest", "gradient_boosting", "xgboost"}

def make_model(kind: str, task: str = "clf"):
    # task: "clf" (predict_proba) | "reg" (predict). random_state fixed.

def feature_importance(model, feature_names) -> dict[str, float]
def classification_metrics(y_true, y_prob) -> dict  # accuracy, precision, recall, auc
def regression_metrics(y_true, y_pred) -> dict       # r2, directional_accuracy
```

Defaults kept modest for walk-forward speed: RF/GBM `n_estimators=200`,
`max_depth` bounded; XGBoost `n_estimators=200`, `max_depth=4`, `learning_rate=0.05`.
XGBoost import is lazy so a missing wheel degrades to an explicit error only when
that model is chosen.

### walkforward.py

Anchored (expanding-window) walk-forward.

```python
@dataclass
class WalkForwardConfig:
    train_window_days: int = 504   # ~2y initial minimum training span
    retrain_every_days: int = 63   # ~quarterly retrain cadence
    min_train_samples: int = 200   # below this, no prediction (positions pass through)

def walk_forward_predict(
    dates: pd.DatetimeIndex,         # ordered backtest dates
    samples: pd.DataFrame,           # columns: date, symbol, label, label_resolved_date, *features
    cfg, model_kind, task,
) -> WalkForwardResult               # out-of-sample preds per (date, symbol) + per-fold + agg metrics
```

**Lookahead guarantees**
1. Features at date t derive only from data ≤ t (enforced in features.py).
2. The model predicting on the window starting at cutoff C was trained only on
   samples with `date < C`.
3. A training sample is included only if `label_resolved_date < C` — its outcome
   was already known at train time (no peeking at unresolved future trades).

Folds: first prediction window starts after `train_window_days`; thereafter the
window advances by `retrain_every_days`, the model retrains on all eligible past
samples each step. Predictions are stitched into one out-of-sample series.

### filter.py (Feature 1)

```python
def build_filter_mask(
    closes, base_scores, target_weights_fn, version, cfg, model_kind, threshold,
) -> FilterResult   # mask[date, symbol] (take?), diagnostics, model metrics, importances
```

1. Walk the backtest dates; at each rebalance get the base strategy's intended
   target weights (reuse `runner.target_weights`).
2. Each intended long position becomes a **candidate sample**: features at entry,
   `label` = 1 if holding-period return (entry close → next rebalance close)
   beats round-trip cost (fixed_per_share + pct_bps as a return hurdle) else 0,
   `label_resolved_date` = next rebalance date.
3. `walk_forward_predict` → P(win) per candidate.
4. `mask = P(win) >= threshold`. Before the first fold (insufficient training),
   mask defaults to True (take the trade) so early history is unfiltered, not empty.
5. Diagnostics: % taken, avg holding-period return of taken vs skipped, plus the
   walk-forward classification metrics and feature importances.

**Scope note (v1):** the filter gates **long entries** (the common case and the
clearest "skip the losers" story). In `long_short` mode, short legs pass through
unfiltered in v1; filtering shorts (label = profit on a downward move) is a
straightforward later extension once the long path is proven.

### ranker.py (Feature 2)

A `Signal` subclass `MlTrainedSignal` (registry key `ml_trained`, category `ml`).
`generate(closes)`:
1. Build the feature panel (no `signal` feature).
2. Sample = each (date, symbol); `label` = forward return over `horizon_days`
   (default 21), `label_resolved_date` = t + horizon.
3. `walk_forward_predict(task="reg")` → out-of-sample predicted forward return
   per (date, symbol).
4. Return that prediction matrix as the score (NaN where no out-of-sample
   prediction yet). The existing runner ranks it like any signal.

Params: `model` (kind), `horizon` (days), `retrain` (days), `train_window` (days).
Diagnostics (out-of-sample r², directional accuracy, importances) stashed on the
signal instance and surfaced by the runner.

## Runner integration

`StrategyVersion` gains an optional `ml_filter` JSON config:
`{enabled, model, threshold, retrain_days, train_window_days}`.

In `run_backtest`:
- If `ml_filter.enabled`, compute `FilterResult` once up front, then in the
  rebalance loop drop any intended position whose `mask[date, symbol]` is False
  and re-normalize remaining weights. Attach `result["ml_filter"]` = diagnostics.
- For an `ml_trained` signal, after `signal.generate`, read its diagnostics and
  attach `result["ml_model"]`.

Both paths add to the result payload without changing existing fields, so the
current results UI keeps working and only renders the new panels when present.

## Data model

`StrategyVersion.ml_filter: Mapped[dict] = mapped_column(JSON, default=dict)`.
New column; existing rows default to `{}` (disabled). The standalone strategy
needs no schema change — it's a signal type with params.

## API

No new endpoints. `VersionIn` (POST /strategies, /versions) accepts `ml_filter`.
The signal catalog (`GET /signals/catalog`) includes `ml_trained` with its params.
Backtest result payload carries `ml_filter` and/or `ml_model` blocks when present.

## UI

**Strategy Builder** (`/build`)
- `ml_trained` shows up in the ML signal category with its param sliders.
- New "ML trade filter" panel (collapsible, off by default): enable toggle,
  model select, probability-threshold slider (0.40–0.80, default 0.55), retrain
  cadence + train-window selects. Applies on top of whatever base signal is set.
- Both remain Pro-gated via existing `enforce_ml_access` (extend it to cover
  `ml_trained` and an enabled `ml_filter`).

**Backtest Results** (`/backtests/[id]`)
- When `ml_filter` present: a panel with base-vs-filtered metric columns, %
  trades taken, avg-return taken vs skipped, model precision/recall/AUC, and a
  feature-importance bar chart.
- When `ml_model` present: a model-diagnostics panel (out-of-sample r²/
  directional accuracy + feature importance).
- One new chart component: `FeatureImportance` (horizontal bars), added to
  `components/charts/`.

## Dependencies

Add to `backend/requirements.txt`: `scikit-learn>=1.4`, `xgboost>=2.0`.
Install into the existing venv.

## Testing

- **Lookahead (critical):** synthetic dataset with a deliberately leaky feature
  (a function of the future label). Assert it does NOT improve out-of-sample AUC
  vs. a clean run — proves the walk-forward harness blocks leakage.
- **Features:** known-answer checks on a tiny price frame (RSI, z-score, mom rank,
  regime flags).
- **Walk-forward:** fold boundaries respect `label_resolved_date < cutoff`; no
  sample used before its outcome exists; predictions are out-of-sample only.
- **Filter:** mask reduces trade count; alignment to (date, symbol); diagnostics
  computed; early (pre-train) trades pass through.
- **Ranker:** `ml_trained` returns a score matrix aligned to closes with leading
  NaNs (warmup) and finite out-of-sample tail; backtest runs end to end.
- **Integration:** backtest with filter on a momentum base; backtest with
  `ml_trained`; both produce coherent metric payloads. Determinism: identical
  inputs → identical metrics (fixed random_state).
- All ML tests force the synthetic provider (offline) via the existing conftest.

## Build order

1. `app/ml/features.py`, `models.py`, `walkforward.py` + their tests (lookahead first).
2. `app/ml/filter.py` + runner integration + tests.
3. `app/ml/ranker.py` (`ml_trained` signal) + registry + tests.
4. Frontend: builder panels, results panels, `FeatureImportance` chart.
5. Dependencies, plan-gate extension, end-to-end verification.

## Risks

- **Walk-forward runtime.** 31 symbols × many folds × XGBoost can be slow.
  Mitigation: modest model sizes, quarterly retrain, run in the existing
  background task with progress updates.
- **Overfitting / weak signal.** The honest taken-vs-skipped diagnostic makes a
  useless filter obvious rather than hiding it. That's the point.
- **XGBoost install on Windows.** Lazy import; sklearn models work regardless.
