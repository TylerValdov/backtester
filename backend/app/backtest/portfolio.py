"""Portfolio accounting: positions, fills, FIFO trade pairing."""
from dataclasses import dataclass, field


@dataclass
class Lot:
    date: str
    qty: float  # signed: + long, - short
    price: float


@dataclass
class Portfolio:
    cash: float
    positions: dict[str, list[Lot]] = field(default_factory=dict)
    closed_trades: list[dict] = field(default_factory=list)

    def qty(self, symbol: str) -> float:
        return sum(lot.qty for lot in self.positions.get(symbol, []))

    def market_value(self, prices: dict[str, float]) -> float:
        mv = 0.0
        for sym, lots in self.positions.items():
            px = prices.get(sym)
            if px is not None:
                mv += sum(lot.qty for lot in lots) * px
        return mv

    def equity(self, prices: dict[str, float]) -> float:
        return self.cash + self.market_value(prices)

    def fill(self, symbol: str, qty: float, fill_price: float, date: str, trading_days_index: dict[str, int]) -> None:
        """Apply a signed fill. Opposite-sign quantity closes existing lots FIFO,
        emitting closed-trade records; any remainder opens a new lot."""
        self.cash -= qty * fill_price
        lots = self.positions.setdefault(symbol, [])
        remaining = qty

        while remaining != 0 and lots and (lots[0].qty * remaining) < 0:
            lot = lots[0]
            close_qty = min(abs(remaining), abs(lot.qty))
            sign = 1 if lot.qty > 0 else -1  # direction of the original position
            pnl = (fill_price - lot.price) * close_qty * sign
            entry_i = trading_days_index.get(lot.date, 0)
            exit_i = trading_days_index.get(date, entry_i)
            self.closed_trades.append({
                "symbol": symbol,
                "side": "long" if sign > 0 else "short",
                "qty": round(close_qty, 4),
                "entry_date": lot.date,
                "exit_date": date,
                "entry_price": round(lot.price, 4),
                "exit_price": round(fill_price, 4),
                "pnl": round(pnl, 2),
                "return_pct": round(pnl / (lot.price * close_qty), 6) if lot.price else 0.0,
                "holding_days": max(exit_i - entry_i, 0),
            })
            lot.qty += close_qty * (1 if remaining > 0 else -1)
            remaining -= close_qty * (1 if remaining > 0 else -1)
            if abs(lot.qty) < 1e-9:
                lots.pop(0)

        if abs(remaining) > 1e-9:
            lots.append(Lot(date=date, qty=remaining, price=fill_price))

    def open_positions(self, prices: dict[str, float]) -> list[dict]:
        out = []
        for sym, lots in self.positions.items():
            q = sum(lot.qty for lot in lots)
            if abs(q) < 1e-9:
                continue
            cost = sum(lot.qty * lot.price for lot in lots)
            avg = cost / q if q else 0.0
            px = prices.get(sym, avg)
            out.append({
                "symbol": sym,
                "qty": round(q, 4),
                "avg_price": round(avg, 4),
                "last_price": round(px, 4),
                "market_value": round(q * px, 2),
                "unrealized_pnl": round((px - avg) * q, 2),
            })
        return sorted(out, key=lambda p: -abs(p["market_value"]))
