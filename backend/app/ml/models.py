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
