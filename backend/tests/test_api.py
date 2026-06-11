"""API integration tests: auth flow, strategy CRUD, backtest lifecycle, plan limits."""
import time

import pytest
from fastapi.testclient import TestClient

import app.db as app_db
from app.db import Base
from app.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Isolated SQLite per test run
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(f"sqlite:///{tmp_path}/test.db", connect_args={"check_same_thread": False})
    TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(app_db, "engine", engine)
    monkeypatch.setattr(app_db, "SessionLocal", TestSession)
    # tasks.py + paper engine grabbed SessionLocal at import time
    import app.tasks as tasks_mod
    monkeypatch.setattr(tasks_mod, "SessionLocal", TestSession)
    Base.metadata.create_all(engine)

    def override_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    from app.db import get_db
    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _signup_and_login(client, email="quant@example.com"):
    resp = client.post("/api/auth/signup", json={"email": email, "password": "hunter2hunter2", "name": "Quant"})
    assert resp.status_code == 201, resp.text
    confirm_url = resp.json()["dev_confirmation_url"]  # no email provider in tests
    token = confirm_url.split("token=")[1]
    resp = client.post(f"/api/auth/confirm?token={token}")
    assert resp.status_code == 200
    return resp.json()


def test_signup_confirm_login_me_logout(client):
    user = _signup_and_login(client)
    assert user["confirmed"] is True

    # /me works with the cookie set by confirm
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "quant@example.com"

    # login before confirm fails for a fresh unconfirmed user
    client.post("/api/auth/signup", json={"email": "x@example.com", "password": "hunter2hunter2"})
    resp = client.post("/api/auth/login", json={"email": "x@example.com", "password": "hunter2hunter2"})
    assert resp.status_code == 403

    # wrong password
    resp = client.post("/api/auth/login", json={"email": "quant@example.com", "password": "wrong-password"})
    assert resp.status_code == 401

    client.post("/api/auth/logout")
    # TestClient keeps the cleared cookie jar
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_protected_routes_require_auth(client):
    for path in ("/api/strategies", "/api/backtests", "/api/paper/sessions", "/api/analytics/overview"):
        assert client.get(path).status_code == 401


STRATEGY_BODY = {
    "name": "Fast/Slow Cross",
    "description": "20/100 SMA crossover",
    "category": "momentum",
    "version": {
        "signal_type": "sma_crossover",
        "params": {"fast": 20, "slow": 100},
        "universe": ["AAPL", "MSFT", "NVDA"],
        "rebalance": "weekly",
        "position_mode": "long_top",
        "top_n": 2,
        "slippage": {"fixed_per_share": 0.005, "pct_bps": 2, "impact_k": 0.1},
    },
}


def test_strategy_crud_versioning_fork_and_diff(client):
    _signup_and_login(client)
    resp = client.post("/api/strategies", json=STRATEGY_BODY)
    assert resp.status_code == 201, resp.text
    strategy = resp.json()
    sid = strategy["id"]
    v1 = strategy["latest_version"]

    # add a second version
    v_body = {**STRATEGY_BODY["version"], "params": {"fast": 10, "slow": 50}, "label": "tighter"}
    resp = client.post(f"/api/strategies/{sid}/versions", json=v_body)
    assert resp.status_code == 201
    v2 = resp.json()
    assert v2["version_number"] == 2

    # diff
    resp = client.get(f"/api/strategies/{sid}/diff", params={"a": v1["id"], "b": v2["id"]})
    assert resp.status_code == 200
    diff = resp.json()
    changed = {d["key"] for d in diff["param_diff"] if d["changed"]}
    assert "param.fast" in changed and "param.slow" in changed

    # fork
    resp = client.post(f"/api/strategies/{sid}/fork")
    assert resp.status_code == 201
    assert resp.json()["forked_from_id"] == sid

    # star
    resp = client.patch(f"/api/strategies/{sid}", json={"starred": True})
    assert resp.json()["starred"] is True


def test_free_plan_strategy_quota(client):
    _signup_and_login(client)
    client.post("/api/strategies", json=STRATEGY_BODY)
    client.post("/api/strategies", json={**STRATEGY_BODY, "name": "Second"})
    resp = client.post("/api/strategies", json={**STRATEGY_BODY, "name": "Third"})
    assert resp.status_code == 402  # Free plan: 2 strategies


def test_free_plan_history_cap_and_ml_gate(client):
    _signup_and_login(client)
    s = client.post("/api/strategies", json=STRATEGY_BODY).json()
    vid = s["latest_version"]["id"]
    resp = client.post("/api/backtests", json={
        "strategy_version_id": vid, "start_date": "2015-01-01", "end_date": "2020-01-01",
    })
    assert resp.status_code == 402  # beyond 2y history

    resp = client.post("/api/strategies", json={
        **STRATEGY_BODY, "name": "ML", "version": {**STRATEGY_BODY["version"], "signal_type": "ml_model"},
    })
    assert resp.status_code == 402  # ML is Pro

    # upgrade unlocks both
    client.post("/api/settings/plan", json={"plan": "pro"})
    resp = client.post("/api/backtests", json={
        "strategy_version_id": vid, "start_date": "2018-01-01", "end_date": "2019-01-01",
    })
    assert resp.status_code == 202


def test_backtest_end_to_end(client):
    _signup_and_login(client)
    s = client.post("/api/strategies", json=STRATEGY_BODY).json()
    vid = s["latest_version"]["id"]

    from datetime import date, timedelta
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=365)).isoformat()
    resp = client.post("/api/backtests", json={
        "strategy_version_id": vid, "start_date": start, "end_date": end,
    })
    assert resp.status_code == 202
    bt_id = resp.json()["id"]

    # poll until the thread-pool worker finishes
    for _ in range(120):
        status = client.get(f"/api/backtests/{bt_id}/status").json()
        if status["status"] in ("done", "error"):
            break
        time.sleep(0.25)
    assert status["status"] == "done", status

    result = client.get(f"/api/backtests/{bt_id}").json()
    assert result["result"]["metrics"]["sharpe"] is not None
    assert len(result["result"]["equity"]) > 200

    # exports
    csv_resp = client.get(f"/api/backtests/{bt_id}/export/trades.csv")
    assert csv_resp.status_code == 200
    assert "entry_date" in csv_resp.text.splitlines()[0]
    eq_resp = client.get(f"/api/backtests/{bt_id}/export/equity.csv")
    assert eq_resp.text.startswith("date,equity,benchmark")


def test_api_key_encryption_at_rest(client):
    _signup_and_login(client)
    resp = client.post("/api/settings/api-keys", json={"provider": "polygon", "key": "pk_live_supersecret1234"})
    assert resp.status_code == 201
    assert resp.json()["last_four"] == "1234"
    listed = client.get("/api/settings/api-keys").json()
    assert listed[0]["provider"] == "polygon"
    assert "key" not in listed[0]  # raw key never returned

    # stored ciphertext does not contain the plaintext
    from app.models import ApiKey
    db = app_db.SessionLocal()
    row = db.query(ApiKey).first()
    assert "supersecret" not in row.encrypted_key
    from app.security import decrypt_secret
    assert decrypt_secret(row.encrypted_key) == "pk_live_supersecret1234"
    db.close()


def test_universe_and_catalog_public(client):
    assert client.get("/api/universe").status_code == 200
    cat = client.get("/api/signals/catalog").json()
    assert any(c["key"] == "zscore" for c in cat)
    ohlcv = client.get("/api/ohlcv/SPY?limit=100").json()
    assert len(ohlcv["close"]) == 100
