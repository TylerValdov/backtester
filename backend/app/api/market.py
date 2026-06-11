"""Market data endpoints: universe catalog, OHLCV series, signal catalog."""
from fastapi import APIRouter, HTTPException, Query

from ..data import BENCHMARK, UNIVERSE, get_provider
from ..signals import catalog

router = APIRouter(tags=["market"])


@router.get("/universe")
def universe():
    return [
        {"symbol": sym, **spec, "benchmark": sym == BENCHMARK}
        for sym, spec in UNIVERSE.items()
    ]


@router.get("/signals/catalog")
def signal_catalog():
    return catalog()


@router.get("/ohlcv/{symbol}")
def ohlcv(
    symbol: str,
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    limit: int = Query(default=500, le=5000),
):
    try:
        df = get_provider().history(symbol.upper(), start, end).tail(limit)
    except KeyError:
        raise HTTPException(404, f"Unknown symbol: {symbol}")
    return {
        "symbol": symbol.upper(),
        "dates": [d.strftime("%Y-%m-%d") for d in df.index],
        "open": [round(v, 4) for v in df["open"]],
        "high": [round(v, 4) for v in df["high"]],
        "low": [round(v, 4) for v in df["low"]],
        "close": [round(v, 4) for v in df["close"]],
        "volume": [int(v) for v in df["volume"]],
    }
