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
    CMD curl -fsS "http://localhost:${PORT:-8000}/api/health" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
# Bind to $PORT (managed hosts like Railway assign it and route there); falls
# back to 8000 for local compose. Single worker on purpose: the live paper loop
# (app/paper) and in-process backtest pool (app/tasks) are per-process
# singletons — multi-worker needs Celery/Redis (Phase 1). sh -c so $PORT expands.
CMD ["sh", "-c", "exec gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 1 -b 0.0.0.0:${PORT:-8000} --timeout 120"]
