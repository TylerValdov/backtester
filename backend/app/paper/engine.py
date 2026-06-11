"""Live paper trading engine.

One asyncio loop ticks every TICK_SECONDS:
1. advance the live feed for every symbol any running session trades
   (SimulatedFeed by default — see PLACEHOLDER[MARKET DATA API — LIVE FEED]
   in app/data/provider.py for wiring a real Polygon/Alpaca stream)
2. mark positions to market, append an intraday equity point, broadcast a
   `tick` frame over WebSocket
3. every SIGNAL_EVERY ticks, re-evaluate the strategy's signal on daily
   history + the live price, rebalance toward target weights through the
   slippage model, persist fills, broadcast `order` frames

PLACEHOLDER[BROKER PAPER ACCOUNT]: to route to a real paper broker (Alpaca
paper API), replace `_execute` with order submission + fill polling; the
WebSocket contract to the frontend stays identical.
"""
import asyncio
import logging
from datetime import datetime, timezone

import pandas as pd

from ..data import get_live_feed, get_provider
from ..db import SessionLocal
from ..models import PaperOrder, PaperPosition, PaperSession, StrategyVersion
from ..risk import SlippageConfig, apply_slippage
from ..signals import build_signal
from .ws import manager

log = logging.getLogger("paper")

TICK_SECONDS = 2.0
SIGNAL_EVERY = 15  # re-evaluate strategy every ~30s of simulated time
EQUITY_BUFFER = 1800  # ~1h of 2s points


class _Runtime:
    """In-memory state for one running session."""

    def __init__(self, session: PaperSession, version: StrategyVersion) -> None:
        self.id = session.id
        self.version = version
        self.cash = session.cash
        self.symbols = list(version.universe) or ["AAPL", "MSFT", "NVDA", "SPY"]
        self.positions: dict[str, dict] = {}  # symbol -> {qty, avg_price}
        self.equity_series: list[tuple[str, float]] = []
        self.tick_count = 0
        self.slip = SlippageConfig.from_dict(version.slippage)


class PaperEngine:
    def __init__(self) -> None:
        # Real Alpaca prices when configured, else the synthetic walk.
        self.feed = get_live_feed()
        self.sessions: dict[str, _Runtime] = {}
        self._task: asyncio.Task | None = None

    # ── lifecycle ────────────────────────────────────────────────────────────
    def start(self) -> None:
        if self._task is None:
            self._load_running_sessions()
            self._task = asyncio.get_event_loop().create_task(self._loop())

    def _load_running_sessions(self) -> None:
        db = SessionLocal()
        try:
            for s in db.query(PaperSession).filter(PaperSession.status == "running"):
                version = db.get(StrategyVersion, s.strategy_version_id)
                if version is None:
                    continue
                rt = _Runtime(s, version)
                for p in db.query(PaperPosition).filter(PaperPosition.session_id == s.id):
                    if abs(p.qty) > 1e-9:
                        rt.positions[p.symbol] = {"qty": p.qty, "avg_price": p.avg_price}
                self.sessions[s.id] = rt
        finally:
            db.close()

    def add_session(self, session: PaperSession, version: StrategyVersion) -> None:
        self.sessions[session.id] = _Runtime(session, version)

    def remove_session(self, session_id: str) -> None:
        self.sessions.pop(session_id, None)

    def snapshot(self, session_id: str) -> dict | None:
        rt = self.sessions.get(session_id)
        if rt is None:
            return None
        prices = {s: self.feed.price(s) for s in self._symbols_of(rt)}
        return self._frame(rt, prices, kind="snapshot")

    # ── tick loop ────────────────────────────────────────────────────────────
    async def _loop(self) -> None:
        while True:
            try:
                await self._tick()
            except Exception:
                log.exception("paper tick failed")
            await asyncio.sleep(TICK_SECONDS)

    def _symbols_of(self, rt: _Runtime) -> list[str]:
        return sorted(set(rt.symbols) | set(rt.positions))

    async def _tick(self) -> None:
        if not self.sessions:
            return
        all_symbols = sorted({s for rt in self.sessions.values() for s in self._symbols_of(rt)})
        prices = self.feed.tick(all_symbols)

        for rt in list(self.sessions.values()):
            rt.tick_count += 1
            if rt.tick_count % SIGNAL_EVERY == 0:
                fills = await asyncio.to_thread(self._rebalance, rt, prices)
                if fills:
                    self._persist(rt, fills)
                    for f in fills:
                        await manager.broadcast(rt.id, {"type": "order", **f})

            frame = self._frame(rt, prices, kind="tick")
            rt.equity_series.append((frame["ts"], frame["equity"]))
            if len(rt.equity_series) > EQUITY_BUFFER:
                rt.equity_series = rt.equity_series[-EQUITY_BUFFER:]
            await manager.broadcast(rt.id, frame)

    def _frame(self, rt: _Runtime, prices: dict[str, float], kind: str) -> dict:
        mv = sum(p["qty"] * prices.get(s, p["avg_price"]) for s, p in rt.positions.items())
        equity = rt.cash + mv
        initial = self._initial_capital(rt)
        positions = [
            {
                "symbol": s,
                "qty": round(p["qty"], 4),
                "avg_price": round(p["avg_price"], 4),
                "last_price": round(prices.get(s, p["avg_price"]), 4),
                "market_value": round(p["qty"] * prices.get(s, p["avg_price"]), 2),
                "unrealized_pnl": round((prices.get(s, p["avg_price"]) - p["avg_price"]) * p["qty"], 2),
            }
            for s, p in sorted(rt.positions.items())
            if abs(p["qty"]) > 1e-9
        ]
        return {
            "type": kind,
            "session_id": rt.id,
            "ts": datetime.now(timezone.utc).isoformat(),
            "equity": round(equity, 2),
            "cash": round(rt.cash, 2),
            "pnl": round(equity - initial, 2),
            "pnl_pct": round((equity / initial - 1) if initial else 0.0, 6),
            "prices": {s: round(prices.get(s, 0.0), 4) for s in self._symbols_of(rt)},
            "positions": positions,
            "equity_series": rt.equity_series[-300:] if kind == "snapshot" else None,
        }

    def _initial_capital(self, rt: _Runtime) -> float:
        db = SessionLocal()
        try:
            s = db.get(PaperSession, rt.id)
            return s.initial_capital if s else 100_000.0
        finally:
            db.close()

    # ── strategy evaluation + execution ──────────────────────────────────────
    def _rebalance(self, rt: _Runtime, live_prices: dict[str, float]) -> list[dict]:
        from ..backtest.runner import target_weights

        provider = get_provider()
        closes = provider.closes(rt.symbols).tail(400).copy()
        today = pd.Timestamp.now().normalize()
        live_row = {s: live_prices.get(s, float(closes[s].iloc[-1])) for s in rt.symbols}
        if closes.index[-1] != today:
            closes.loc[today] = live_row
        else:
            closes.iloc[-1] = pd.Series(live_row)

        signal = build_signal(rt.version.signal_type, rt.version.params, code=rt.version.code)
        scores = signal.generate(closes)
        weights = target_weights(scores.iloc[-1], rt.version.position_mode, rt.version.top_n)

        mv = sum(p["qty"] * live_prices.get(s, p["avg_price"]) for s, p in rt.positions.items())
        equity = rt.cash + mv
        fills: list[dict] = []
        for sym in set(list(weights) + list(rt.positions)):
            px = live_prices.get(sym)
            if px is None or px <= 0:
                continue
            target_qty = weights.get(sym, 0.0) * equity / px
            current = rt.positions.get(sym, {"qty": 0.0, "avg_price": px})["qty"]
            delta = target_qty - current
            if abs(delta * px) < max(equity * 0.002, 50):  # ignore dust
                continue
            side = "buy" if delta > 0 else "sell"
            fill_px, costs = apply_slippage(side, px, delta, rt.slip)
            self._execute(rt, sym, delta, fill_px)
            fills.append({
                "session_id": rt.id,
                "symbol": sym,
                "side": side,
                "qty": round(abs(delta), 4),
                "fill_price": round(fill_px, 4),
                "slippage_cost": round(costs["total"], 4),
                "ts": datetime.now(timezone.utc).isoformat(),
            })
        return fills

    def _execute(self, rt: _Runtime, symbol: str, delta: float, fill_px: float) -> None:
        rt.cash -= delta * fill_px
        pos = rt.positions.setdefault(symbol, {"qty": 0.0, "avg_price": fill_px})
        new_qty = pos["qty"] + delta
        if pos["qty"] * delta > 0 or abs(pos["qty"]) < 1e-9:  # adding to / opening
            total_cost = pos["avg_price"] * pos["qty"] + fill_px * delta
            pos["avg_price"] = total_cost / new_qty if abs(new_qty) > 1e-9 else fill_px
        pos["qty"] = new_qty
        if abs(new_qty) < 1e-9:
            rt.positions.pop(symbol, None)

    def _persist(self, rt: _Runtime, fills: list[dict]) -> None:
        db = SessionLocal()
        try:
            for f in fills:
                db.add(PaperOrder(
                    session_id=rt.id, symbol=f["symbol"], side=f["side"],
                    qty=f["qty"], fill_price=f["fill_price"], slippage_cost=f["slippage_cost"],
                ))
            db.query(PaperPosition).filter(PaperPosition.session_id == rt.id).delete()
            for sym, p in rt.positions.items():
                db.add(PaperPosition(
                    session_id=rt.id, symbol=sym, qty=p["qty"], avg_price=p["avg_price"],
                    last_price=self.feed.price(sym),
                ))
            session = db.get(PaperSession, rt.id)
            if session:
                session.cash = rt.cash
                mv = sum(p["qty"] * self.feed.price(s) for s, p in rt.positions.items())
                session.equity = rt.cash + mv
            db.commit()
        finally:
            db.close()


engine = PaperEngine()
