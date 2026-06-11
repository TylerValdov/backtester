"""Database session / engine setup.

SQLite for development. PLACEHOLDER[TIMESCALEDB/POSTGRES]: in production set
DATABASE_URL to Postgres and convert the (future) ohlcv bars table to a
TimescaleDB hypertable partitioned on the date column — the rest of the app is
unaffected because market data access goes through app/data/provider.py.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
