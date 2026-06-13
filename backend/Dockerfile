# ── Backtester backend ────────────────────────────────────────────────────────
FROM python:3.13-slim

# libgomp1: OpenMP runtime required by xgboost / scikit-learn wheels.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY migrations ./migrations
COPY alembic.ini .
COPY docker-entrypoint.sh .
RUN chmod +x docker-entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
# Single worker on purpose: the live paper-trading loop (app/paper) and the
# in-process backtest pool (app/tasks) are per-process singletons. Scaling to
# multiple workers requires externalizing those (Celery/Redis) — Phase 1.
CMD ["gunicorn", "app.main:app", "-k", "uvicorn.workers.UvicornWorker", \
     "-w", "1", "-b", "0.0.0.0:8000", "--timeout", "120"]
