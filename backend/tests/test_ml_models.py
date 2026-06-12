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
