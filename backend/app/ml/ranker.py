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
