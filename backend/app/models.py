"""SQLAlchemy models."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _id() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    password_hash: Mapped[str] = mapped_column(String(255), default="")  # empty for OAuth-only accounts
    google_sub: Mapped[str] = mapped_column(String(64), default="", index=True)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    plan: Mapped[str] = mapped_column(String(16), default="free")  # free | pro | quant
    notification_prefs: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    strategies: Mapped[list["Strategy"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class ApiKey(Base):
    """Provider API keys, encrypted at rest with Fernet (app/security.py)."""

    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    provider: Mapped[str] = mapped_column(String(40))  # polygon | alpaca | yahoo | broker_paper | ml_endpoint
    encrypted_key: Mapped[str] = mapped_column(Text)
    last_four: Mapped[str] = mapped_column(String(8), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Strategy(Base):
    __tablename__ = "strategies"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(32), default="momentum")  # momentum | mean_reversion | ml
    starred: Mapped[bool] = mapped_column(Boolean, default=False)
    forked_from_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    user: Mapped[User] = relationship(back_populates="strategies")
    versions: Mapped[list["StrategyVersion"]] = relationship(
        back_populates="strategy", cascade="all, delete-orphan", order_by="StrategyVersion.version_number"
    )


class StrategyVersion(Base):
    """Immutable snapshot of a strategy's full configuration."""

    __tablename__ = "strategy_versions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    strategy_id: Mapped[str] = mapped_column(ForeignKey("strategies.id"), index=True)
    version_number: Mapped[int] = mapped_column(Integer, default=1)
    label: Mapped[str] = mapped_column(String(120), default="")
    signal_type: Mapped[str] = mapped_column(String(40))  # registry key, e.g. "sma_crossover"
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    code: Mapped[str] = mapped_column(Text, default="")  # custom signal code ("custom" signal_type)
    universe: Mapped[list] = mapped_column(JSON, default=list)
    timeframe: Mapped[str] = mapped_column(String(8), default="1d")  # 1m | 5m | 15m | 1h | 1d
    rebalance: Mapped[str] = mapped_column(String(16), default="daily")  # every_bar | daily | weekly | monthly
    position_mode: Mapped[str] = mapped_column(String(16), default="long_top")  # long_top | long_short | signal_weight
    top_n: Mapped[int] = mapped_column(Integer, default=5)
    slippage: Mapped[dict] = mapped_column(JSON, default=dict)
    ml_filter: Mapped[dict] = mapped_column(JSON, default=dict)
    parent_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    strategy: Mapped[Strategy] = relationship(back_populates="versions")


class Backtest(Base):
    __tablename__ = "backtests"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    strategy_version_id: Mapped[str] = mapped_column(ForeignKey("strategy_versions.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued | running | done | error
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[str] = mapped_column(String(10), default="")
    end_date: Mapped[str] = mapped_column(String(10), default="")
    initial_capital: Mapped[float] = mapped_column(Float, default=100_000.0)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # full computed result payload
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class PaperSession(Base):
    __tablename__ = "paper_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    strategy_version_id: Mapped[str] = mapped_column(ForeignKey("strategy_versions.id"))
    name: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(16), default="running")  # running | paused | stopped
    initial_capital: Mapped[float] = mapped_column(Float, default=100_000.0)
    cash: Mapped[float] = mapped_column(Float, default=100_000.0)
    equity: Mapped[float] = mapped_column(Float, default=100_000.0)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class PaperPosition(Base):
    __tablename__ = "paper_positions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("paper_sessions.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(12))
    qty: Mapped[float] = mapped_column(Float, default=0.0)
    avg_price: Mapped[float] = mapped_column(Float, default=0.0)
    last_price: Mapped[float] = mapped_column(Float, default=0.0)


class PaperOrder(Base):
    __tablename__ = "paper_orders"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("paper_sessions.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(12))
    side: Mapped[str] = mapped_column(String(4))  # buy | sell
    qty: Mapped[float] = mapped_column(Float)
    fill_price: Mapped[float] = mapped_column(Float)
    slippage_cost: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(12), default="filled")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
