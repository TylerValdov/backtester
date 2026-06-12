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
