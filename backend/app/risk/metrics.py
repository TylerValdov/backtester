"""Risk & performance metrics. All annualization assumes 252 trading days."""
import numpy as np
import pandas as pd

TRADING_DAYS = 252


def sharpe(returns: pd.Series, rf_annual: float = 0.0, ppy: float = TRADING_DAYS) -> float:
    """Annualized Sharpe ratio. ppy = return periods per year (252 for daily,
    252×bars/day for intraday)."""
    if len(returns) < 2 or returns.std() < 1e-12:
        return 0.0
    excess = returns - rf_annual / ppy
    return float(excess.mean() / excess.std() * np.sqrt(ppy))


def sortino(returns: pd.Series, rf_annual: float = 0.0, ppy: float = TRADING_DAYS) -> float:
    """Annualized Sortino ratio (downside deviation in the denominator)."""
    excess = returns - rf_annual / ppy
    downside = excess[excess < 0]
    if len(downside) < 2:
        return 0.0
    dd = float(np.sqrt((downside**2).mean()))
    if dd == 0:
        return 0.0
    return float(excess.mean() / dd * np.sqrt(ppy))


def max_drawdown(equity: pd.Series) -> float:
    """Maximum peak-to-trough drawdown as a negative fraction."""
    if len(equity) == 0:
        return 0.0
    running_max = equity.cummax()
    return float(((equity - running_max) / running_max).min())


def drawdown_series(equity: pd.Series) -> pd.Series:
    running_max = equity.cummax()
    return (equity - running_max) / running_max


def cagr(equity: pd.Series, ppy: float = TRADING_DAYS) -> float:
    if len(equity) < 2 or equity.iloc[0] <= 0:
        return 0.0
    final = equity.iloc[-1]
    if final <= 0:
        return -1.0  # total loss; a negative base would give a complex/NaN root
    years = len(equity) / ppy
    if years <= 0:
        return 0.0
    return float((final / equity.iloc[0]) ** (1 / years) - 1)


def volatility(returns: pd.Series, ppy: float = TRADING_DAYS) -> float:
    return float(returns.std() * np.sqrt(ppy))


def rolling_sharpe(returns: pd.Series, window: int = 63, ppy: float = TRADING_DAYS) -> pd.Series:
    mean = returns.rolling(window).mean()
    std = returns.rolling(window).std()
    return (mean / std.replace(0, np.nan)) * np.sqrt(ppy)


def beta_alpha(returns: pd.Series, benchmark_returns: pd.Series, ppy: float = TRADING_DAYS) -> tuple[float, float]:
    """OLS beta and annualized alpha vs a benchmark return series."""
    aligned = pd.concat([returns, benchmark_returns], axis=1).dropna()
    if len(aligned) < 20:
        return 0.0, 0.0
    r, b = aligned.iloc[:, 0], aligned.iloc[:, 1]
    var = b.var()
    if var == 0:
        return 0.0, 0.0
    beta = float(r.cov(b) / var)
    alpha_per_period = float(r.mean() - beta * b.mean())
    return beta, alpha_per_period * ppy


def trade_stats(trades: list[dict]) -> dict:
    """Aggregate closed-trade stats. Each trade: {pnl, holding_days, ...}."""
    closed = [t for t in trades if t.get("exit_date")]
    if not closed:
        return {"win_rate": 0.0, "avg_holding_days": 0.0, "num_trades": 0, "avg_win": 0.0, "avg_loss": 0.0, "profit_factor": 0.0}
    pnls = np.array([t["pnl"] for t in closed])
    wins, losses = pnls[pnls > 0], pnls[pnls <= 0]
    gross_loss = float(-losses.sum())
    return {
        "win_rate": float(len(wins) / len(pnls)),
        "avg_holding_days": float(np.mean([t["holding_days"] for t in closed])),
        "num_trades": len(closed),
        "avg_win": float(wins.mean()) if len(wins) else 0.0,
        "avg_loss": float(losses.mean()) if len(losses) else 0.0,
        "profit_factor": float(pnls[pnls > 0].sum() / gross_loss) if gross_loss > 0 else float("inf") if len(wins) else 0.0,
    }


def summarize(equity: pd.Series, benchmark_equity: pd.Series, trades: list[dict], ppy: float = TRADING_DAYS) -> dict:
    returns = equity.pct_change().dropna()
    bench_returns = benchmark_equity.pct_change().dropna()
    beta, alpha = beta_alpha(returns, bench_returns, ppy)
    stats = trade_stats(trades)
    return {
        "total_return": float(equity.iloc[-1] / equity.iloc[0] - 1) if len(equity) > 1 else 0.0,
        "cagr": cagr(equity, ppy),
        "sharpe": sharpe(returns, ppy=ppy),
        "sortino": sortino(returns, ppy=ppy),
        "max_drawdown": max_drawdown(equity),
        "volatility": volatility(returns, ppy),
        "beta": beta,
        "alpha": alpha,
        "benchmark_total_return": float(benchmark_equity.iloc[-1] / benchmark_equity.iloc[0] - 1) if len(benchmark_equity) > 1 else 0.0,
        "benchmark_cagr": cagr(benchmark_equity, ppy),
        "benchmark_sharpe": sharpe(bench_returns, ppy=ppy),
        "benchmark_max_drawdown": max_drawdown(benchmark_equity),
        **stats,
    }
