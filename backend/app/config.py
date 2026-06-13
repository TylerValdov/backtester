"""Application settings, loaded from environment / backend/.env."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    secret_key: str = "change-me-dev-secret"
    encryption_key: str = ""  # Fernet key; derived from secret_key when empty (dev only)

    # PLACEHOLDER[TIMESCALEDB/POSTGRES]: point at a time-series optimized
    # database in production. OHLCV access is isolated in app/data/.
    database_url: str = "sqlite:///./backtester.db"

    # Market data: "synthetic" | "alpaca" | "polygon" | "yahoo"
    market_data_provider: str = "synthetic"
    market_data_api_key: str = ""  # used by the (stub) Polygon path

    # Alpaca market data (https://data.alpaca.markets). The free "Basic" plan
    # serves IEX-feed daily bars; SIP (full-market) requires a paid plan.
    alpaca_api_key: str = ""
    alpaca_secret_key: str = ""
    alpaca_feed: str = "iex"  # "iex" (free) | "sip" (paid)
    # Earliest date AlpacaProvider tries to backfill per symbol.
    alpaca_history_start: str = "2015-01-01"

    # PLACEHOLDER[ML INFERENCE ENDPOINT]
    ml_inference_url: str = ""

    # PLACEHOLDER[CELERY+REDIS]
    celery_broker_url: str = ""

    # Email — Resend (https://resend.com). Unset = links logged to console.
    resend_api_key: str = ""
    email_from: str = "research@backtester.local"

    # PLACEHOLDER[GOOGLE OAUTH]
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""

    frontend_origin: str = "http://localhost:3000"

    session_ttl_hours: int = 24 * 7
    # Mark the session cookie Secure (HTTPS-only). Keep False for localhost dev;
    # set COOKIE_SECURE=true in production behind HTTPS.
    cookie_secure: bool = False

    # Plan limits (Free tier). Pro/Quant lift these — see app/api/deps.py.
    free_max_strategies: int = 2
    free_history_years: int = 2


    @property
    def sqlalchemy_url(self) -> str:
        """DB URL with an explicit driver. Managed hosts (Railway/Heroku/Render)
        hand out `postgresql://` or `postgres://`, which SQLAlchemy maps to the
        unbundled psycopg2 — we ship psycopg3, so force the `+psycopg` dialect."""
        url = self.database_url
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
