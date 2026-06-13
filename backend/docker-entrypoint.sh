#!/bin/sh
# Apply DB migrations to head before starting the server. Idempotent — safe to
# run on every boot. Fails fast (set -e) so a bad migration stops the deploy.
set -e

echo "[entrypoint] running database migrations…"
alembic upgrade head

echo "[entrypoint] starting server…"
exec "$@"
