"""Background job runner for long-running backtests.

In-process thread pool with a progress registry. Each job updates the Backtest
row (status/progress/result) so any API worker can serve polling requests.

PLACEHOLDER[CELERY+REDIS]: for multi-worker production deployments, replace
`submit_backtest` with a Celery task — set CELERY_BROKER_URL (redis://...) and
move `_run` into a @celery_app.task. The DB-backed progress contract stays the
same, so the frontend polling endpoint does not change.
"""
import logging
import traceback
from concurrent.futures import ThreadPoolExecutor

from .db import SessionLocal
from .models import Backtest, StrategyVersion

log = logging.getLogger("tasks")

_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="backtest")


def submit_backtest(backtest_id: str) -> None:
    _pool.submit(_run, backtest_id)


def _run(backtest_id: str) -> None:
    from .backtest.runner import run_backtest  # late import: avoid cycles

    db = SessionLocal()
    try:
        bt = db.get(Backtest, backtest_id)
        if bt is None:
            return
        version = db.get(StrategyVersion, bt.strategy_version_id)
        bt.status = "running"
        db.commit()

        def on_progress(fraction: float) -> None:
            bt.progress = round(fraction, 3)
            db.commit()

        result = run_backtest(
            version=version,
            start_date=bt.start_date,
            end_date=bt.end_date,
            initial_capital=bt.initial_capital,
            on_progress=on_progress,
        )
        bt.result = result
        bt.progress = 1.0
        bt.status = "done"
        db.commit()
    except Exception as exc:  # surface engine errors to the UI
        log.error("backtest %s failed: %s\n%s", backtest_id, exc, traceback.format_exc())
        db.rollback()
        bt = db.get(Backtest, backtest_id)
        if bt is not None:
            bt.status = "error"
            bt.error = str(exc)
            db.commit()
    finally:
        db.close()
