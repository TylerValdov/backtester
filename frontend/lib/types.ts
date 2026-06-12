// Shared API payload types (mirror backend/app/api/* responses)

export type User = {
  id: string;
  email: string;
  name: string;
  plan: "free" | "pro" | "quant";
  confirmed: boolean;
};

export type ParamSpec = {
  name: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
};

export type SignalMeta = {
  key: string;
  label: string;
  category: "momentum" | "mean_reversion" | "ml";
  description: string;
  params: ParamSpec[];
};

export type StrategyVersion = {
  id: string;
  version_number: number;
  label: string;
  signal_type: string;
  params: Record<string, number>;
  code: string;
  universe: string[];
  rebalance: "daily" | "weekly" | "monthly";
  position_mode: "long_top" | "long_short" | "signal_weight";
  top_n: number;
  slippage: Record<string, number>;
  parent_version_id: string | null;
  created_at: string;
  ml_filter?: Record<string, unknown>;
};

export type Metrics = {
  total_return: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  max_drawdown: number;
  volatility: number;
  beta: number;
  alpha: number;
  benchmark_total_return: number;
  benchmark_cagr: number;
  benchmark_sharpe: number;
  benchmark_max_drawdown: number;
  win_rate: number;
  avg_holding_days: number;
  num_trades: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  total_slippage: number;
  turnover_orders: number;
};

export type Strategy = {
  id: string;
  name: string;
  description: string;
  category: string;
  starred: boolean;
  forked_from_id: string | null;
  created_at: string;
  version_count: number;
  latest_version: StrategyVersion | null;
  last_metrics: Metrics | null;
  last_backtest_id: string | null;
  versions?: StrategyVersion[];
};

export type Trade = {
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  pnl: number;
  return_pct: number;
  holding_days: number;
};

export type BacktestResult = {
  dates: string[];
  equity: number[];
  benchmark: number[];
  drawdown: number[];
  rolling_sharpe: (number | null)[];
  exposure: number[];
  metrics: Metrics;
  trades: Trade[];
  trades_total: number;
  open_positions: Position[];
  slippage_breakdown: { fixed: number; pct: number; impact: number; total: number };
  config: {
    symbols: string[];
    signal_type: string;
    params: Record<string, number>;
    rebalance: string;
    position_mode: string;
    top_n: number;
    slippage: Record<string, number>;
    start: string;
    end: string;
    initial_capital: number;
  };
  ml_filter?: MlFilterResult;
  ml_model?: MlModelResult;
};

export type Backtest = {
  id: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  error: string;
  strategy_version_id: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  metrics: Metrics | null;
  created_at: string;
  result?: BacktestResult;
  strategy?: { id: string; name: string };
  version_number?: number;
};

export type Position = {
  symbol: string;
  qty: number;
  avg_price: number;
  last_price: number;
  market_value?: number;
  unrealized_pnl?: number;
};

export type PaperSession = {
  id: string;
  name: string;
  status: "running" | "paused" | "stopped";
  initial_capital: number;
  cash: number;
  equity: number;
  pnl: number;
  strategy: { id: string; name: string } | null;
  version_number: number | null;
  signal_type: string | null;
  universe: string[];
  started_at: string;
  positions: Position[];
  live?: TickFrame;
};

export type TickFrame = {
  type: "tick" | "snapshot" | "order";
  session_id: string;
  ts: string;
  equity: number;
  cash: number;
  pnl: number;
  pnl_pct: number;
  prices: Record<string, number>;
  positions: Position[];
  equity_series?: [string, number][] | null;
};

export type OrderFrame = {
  type: "order";
  session_id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  fill_price: number;
  slippage_cost: number;
  ts: string;
};

export type PaperOrder = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  fill_price: number;
  slippage_cost: number;
  status: string;
  ts: string;
};

export type UniverseEntry = {
  symbol: string;
  name: string;
  sector: string;
  benchmark: boolean;
};

export type AnalyticsOverview = {
  comparison: {
    strategy_id: string;
    strategy_name: string;
    category: string;
    version_number: number;
    backtest_id: string;
    metrics: Metrics | null;
    equity_sparkline: number[];
    dates_span: [string, string] | null;
  }[];
  correlation: { labels: string[]; matrix: number[][] } | null;
  histogram: { counts: number[]; edges: number[] } | null;
  drawdown_periods: {
    start: string;
    end: string;
    trough_date: string;
    depth: number;
    strategy_name: string;
    ongoing?: boolean;
  }[];
};

export type MlFilterResult = {
  n_candidates: number;
  pct_taken: number;
  avg_return_taken: number;
  avg_return_skipped: number;
  threshold: number;
  model: string;
  metrics: { precision?: number; recall?: number; accuracy?: number; auc?: number };
  importances: Record<string, number>;
  n_folds: number;
};

export type MlModelResult = {
  metrics: { r2?: number; directional_accuracy?: number };
  importances: Record<string, number>;
  n_folds: number;
  model: string;
};

export type VersionDiff = {
  a: StrategyVersion;
  b: StrategyVersion;
  param_diff: { key: string; a: unknown; b: unknown; changed: boolean }[];
  metrics_a: Metrics | null;
  metrics_b: Metrics | null;
  code_changed: boolean;
  code_a: string;
  code_b: string;
};
