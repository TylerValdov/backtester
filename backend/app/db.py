"""Database session / engine setup.

SQLite for development. PLACEHOLDER[TIMESCALEDB/POSTGRES]: in production set
DATABASE_URL to Postgres and convert the (future) ohlcv bars table to a
TimescaleDB hypertable partitioned on the date column — the rest of the app is
unaffected because market data access goes through app/data/provider.py.
"""
import json

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings
from .serialize import json_safe

settings = get_settings()

db_url = settings.sqlalchemy_url
connect_args = {"check_same_thread": False} if db_url.startswith("sqlite") else {}


def _json_serializer(obj) -> str:
    # Postgres' JSON type rejects NaN/Infinity tokens; strip them at the lowest
    # level so no result payload (from any code path) can ever break a write.
    return json.dumps(json_safe(obj))


# pool_pre_ping recycles connections dropped by the DB/proxy (matters on managed
# Postgres, which closes idle connections); no-op cost on SQLite.
engine = create_engine(db_url, connect_args=connect_args, pool_pre_ping=True, json_serializer=_json_serializer)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
