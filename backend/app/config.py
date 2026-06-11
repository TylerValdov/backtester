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

    # PLACEHOLDER[MARKET DATA API]: "synthetic" | "polygon" | "alpaca" | "yahoo"
    market_data_provider: str = "synthetic"
    market_data_api_key: str = ""

    # PLACEHOLDER[ML INFERENCE ENDPOINT]
    ml_inference_url: str = ""

    # PLACEHOLDER[CELERY+REDIS]
    celery_broker_url: str = ""

    # PLACEHOLDER[EMAIL SERVICE]
    email_api_key: str = ""
    email_from: str = "research@backtester.local"

    # PLACEHOLDER[GOOGLE OAUTH]
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""

    frontend_origin: str = "http://localhost:3000"

    session_ttl_hours: int = 24 * 7

    # Plan limits (Free tier). Pro/Quant lift these — see app/api/deps.py.
    free_max_strategies: int = 2
    free_history_years: int = 2


@lru_cache
def get_settings() -> Settings:
    return Settings()
