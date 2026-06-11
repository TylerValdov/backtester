# Backtester

A personal quantitative backtesting and live paper trading platform — open-source
Quantopian energy, research-environment design. Write a trading signal, test it against
a decade of daily bars, then paper trade it live over a WebSocket.

## Quick start

```bash
# backend (Python 3.13, venv at repo root)
cd backend
../.venv/Scripts/python -m pip install -r requirements.txt
../.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000

# frontend (Node 22)
cd frontend
npm install
npm run dev          # http://localhost:3000  (proxies /api/* to :8000)
```

Sign up → the confirmation link is returned in dev mode (no email key needed) → build a
strategy → run a backtest → start a paper session. Everything works offline on a
deterministic synthetic data feed (16 years of daily OHLCV, regime shifts, shared market
factor) until you add real keys.

## What's inside

| Area | Module | Notes |
| --- | --- | --- |
| Alpha signals | `backend/app/signals/` | Momentum (SMA cross, momentum, RSI, MACD, breakout), mean reversion (z-score, Bollinger, pairs spread), ML hook (endpoint / sklearn pickle / labeled fallback), custom Python signals |
| Backtest engine | `backend/app/backtest/` | Daily event loop, weekly/monthly rebalance, long-top / long-short / signal-weighted sizing, FIFO trade pairing |
| Risk & costs | `backend/app/risk/` | Sharpe, Sortino, max DD, CAGR, win rate, holding period, alpha/beta vs SPY, rolling Sharpe; slippage = fixed + bps + √impact |
| Paper trading | `backend/app/paper/` | 2s tick loop, ~30s rebalances, fills persisted, WebSocket broadcast (`/ws/paper/{session}`) |
| Versioning | `backend/app/api/strategies.py` | Immutable versions, forks with lineage, param + metric diff endpoint |
| Auth | `backend/app/api/auth.py` | Email/password + confirmation, scrypt hashing, httpOnly JWT cookie, Google OAuth flow (needs creds) |
| Frontend | `frontend/app/` | Landing, auth, builder (CodeMirror), results, live dashboard, library, analytics, pricing, settings — custom SVG/canvas chart kit, dark research theme |

## Plug in real services

Every integration point is a labeled placeholder — search the backend for `PLACEHOLDER[`:

- `PLACEHOLDER[MARKET DATA API]` — Polygon/Alpaca/Yahoo, historical + live (`app/data/provider.py`)
- `PLACEHOLDER[ML INFERENCE ENDPOINT]` — hosted model scoring contract (`app/signals/ml.py`)
- `PLACEHOLDER[CELERY+REDIS]` — distributed backtest workers (`app/tasks.py`)
- `PLACEHOLDER[TIMESCALEDB/POSTGRES]` — time-series DB swap (`app/db.py`)
- `PLACEHOLDER[EMAIL SERVICE]` — Resend/Postmark/SES (`app/email_service.py`)
- `PLACEHOLDER[GOOGLE OAUTH]` — credentials only, flow implemented (`app/api/auth.py`)
- `PLACEHOLDER[BROKER PAPER ACCOUNT]` — Alpaca paper order routing (`app/paper/engine.py`)
- `PLACEHOLDER[BILLING — STRIPE]` — plan switching (`app/api/settings_api.py`)

Copy `backend/.env.example` → `backend/.env` and fill in keys. Stored provider keys are
encrypted at rest with Fernet.

## Tests

```bash
cd backend
../.venv/Scripts/python -m pytest      # engine math, auth flow, plan gates, e2e backtest
```

## Design

Spec: `docs/superpowers/specs/2026-06-11-backtester-platform-design.md`. Tokens:
`frontend/app/tokens.css` — cool slate paper, one instrument-cyan accent, semantic
up/down green/red reserved for market data. Geist + Geist Mono.

Sample data only — nothing here is investment advice.
