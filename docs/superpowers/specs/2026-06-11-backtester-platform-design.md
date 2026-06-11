# Backtester Platform — Design Spec (2026-06-11)

Personal quantitative backtesting + live paper trading platform. "Open-source Quantopian
meets modern ML research environment." User spec was exhaustive; this doc records the
decisions made within it.

## Architecture

Two-service monorepo:

- `backend/` — **FastAPI** (Python 3.13). Owns: auth, signal engine, backtest engine,
  risk metrics, paper trading simulator, WebSocket, persistence.
  - Chosen over a TS monorepo because the quant ecosystem (numpy/pandas, sklearn,
    XGBoost) is Python-native; signal code users write is Python-flavored.
- `frontend/` — **Next.js 15** (App Router, TypeScript, Tailwind v4). All pages.
  - Talks to backend via Next rewrites (`/api/*` → `localhost:8000`), keeping
    httpOnly session cookies same-origin. WebSocket connects directly.

### Key technical choices

| Concern | Choice | Placeholder for production |
| --- | --- | --- |
| Database | SQLite + SQLAlchemy | `DATABASE_URL` → Postgres/TimescaleDB (OHLCV table is partition-ready) |
| Historical data | Deterministic synthetic OHLCV generator (GBM + regimes, 2010→present, 30-symbol universe + SPY) | `MARKET_DATA_API_KEY` → Polygon.io/Alpaca/yfinance adapter interface |
| Live data | Simulated tick stream off last close | Same adapter interface, streaming endpoint |
| Task queue | In-process thread pool with progress registry | `CELERY_BROKER_URL` → Celery + Redis |
| Auth | JWT (httpOnly cookie), scrypt password hashing, email-confirm tokens | `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `EMAIL_API_KEY` (confirm links logged to console in dev) |
| API key storage | Fernet encryption at rest | `SECRET_KEY` / `ENCRYPTION_KEY` from env |
| ML signals | Pluggable interface: sklearn-style `predict`, or HTTP inference endpoint | `ML_INFERENCE_URL` |
| Editor | CodeMirror 6 (lighter than Monaco, SSR-friendly) | — |
| Charts | Custom SVG/canvas kit (instrument aesthetic, no chart-lib genericism) | — |

### Backend modules (separation of concerns)

- `app/data/` — market data: synthetic generator, provider interface, universe
- `app/signals/` — signal definitions: momentum, mean-reversion, ML hook; safe param-driven execution
- `app/backtest/` — runner (single + multi-asset, rebalance frequency), portfolio accounting
- `app/risk/` — Sharpe, Sortino, max drawdown, CAGR, win rate, holding period, slippage models, benchmark comparison
- `app/paper/` — live paper trading loop, fills, positions, P&L, order blotter, WS broadcast
- `app/api/` — routers: auth, signals, strategies, backtests, paper, analytics, settings
- `app/tasks.py` — background job registry (Celery placeholder)

### Data model

users · signals · strategies · strategy_versions (versioning/fork/diff) · backtests
(params + full result JSON) · paper_sessions · paper_orders · paper_positions · api_keys
(encrypted) · notification_prefs.

## Design system (Hallmark custom-tuned)

- Genre atmospheric; dark research environment, not casino.
- Paper `oklch(13% 0.01 240)`, ink `oklch(93% 0.008 240)`, accent instrument-cyan
  `oklch(80% 0.13 195)` (≤3% viewport), semantic `--up`/`--down` green/red reserved for
  data only. No pure black/white, no gradients on text, one accent.
- Type: Geist (display 600 / body 400) + JetBrains Mono (outlier: data role — tickers,
  numbers, nav, code). Tabular nums on all data.
- Landing: Marquee Hero over live canvas equity curve; nav N8 terminal command;
  footer Ft4 dense colophon; F4 step sequence + F3 tabular spec sheet below fold.
- Motion: Emil rules — transform/opacity only, `--ease-out: cubic-bezier(0.16,1,0.3,1)`,
  ≤300ms UI, press scale 0.97, reduced-motion supported, one page-load orchestration.

## Pages

`/` landing · `/login` `/signup` `/confirm` auth · `/dashboard` paper trading (live WS)
· `/build` strategy builder · `/strategies` library + version diff · `/backtests/[id]`
results (equity/drawdown/rolling-Sharpe/trade log/slippage/benchmark, CSV+PDF export)
· `/analytics` cross-strategy comparison, correlation heatmap, return histogram
· `/pricing` · `/settings`.

## Quality bar (from spec)

Backtests compute real metrics against generated data. Paper trading updates via
WebSocket. Auth end-to-end with protected routes. Every placeholder labeled with
service, reason, expected shape. Mobile functional for monitoring + results review.
