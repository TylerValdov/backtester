// Plain-English help for every tunable. Keyed `${signalKey}.${paramName}` for
// signal parameters; FIELD_HELP covers the execution / slippage / window inputs.
// Goal: a newcomer should never hit a control like "Impact k" with no idea what
// it does or where to leave it.

export const PARAM_HELP: Record<string, string> = {
  "sma_crossover.fast": "Length of the quick moving average, in days. Smaller reacts faster but whipsaws more. 20 is a common default.",
  "sma_crossover.slow": "Length of the slow trend average. The fast line crossing above it is the buy trigger — keep it well above the fast window (e.g. 100).",

  "momentum.lookback": "How far back to measure the trend's total return. 126 days ≈ 6 months. Longer is steadier but slower to react.",
  "momentum.skip": "Days at the very end to ignore, to sidestep short-term reversals. 10 is typical; set 0 to use the latest price.",

  "rsi.period": "Averaging window for RSI. Shorter is jumpier, longer is smoother. 14 is the textbook setting — leave it there if unsure.",

  "macd.fast": "Fast EMA length. 12 is standard.",
  "macd.slow": "Slow EMA length. 26 is standard; keep it above the fast EMA.",
  "macd.signal": "Smoothing applied to the MACD line before taking the histogram. 9 is standard.",

  "breakout.lookback": "Window for the high/low channel. Price breaking the N-day high triggers a long. 55 is a classic Donchian setting.",

  "zscore.lookback": "Window for the mean and standard deviation. Shorter = more, faster signals. 20 is a sensible default.",
  "zscore.cap": "Caps how extreme a z-score can score, so one outlier day doesn't dominate. 3 standard deviations is reasonable.",

  "bollinger.period": "Window for the middle band (a moving average). 20 is the classic setting.",
  "bollinger.num_std": "How many standard deviations wide the bands sit. Wider bands trade less often. 2 is standard.",

  "pairs.corr_window": "How much history is used to pick each symbol's most-correlated peer. 252 days ≈ 1 trading year.",
  "pairs.z_window": "Window for z-scoring the spread between a pair. Shorter reacts faster to the gap opening and closing.",

  "ml_model.smoothing": "Days of averaging applied to the model's raw scores to cut noise. 5 is a light touch; 1 disables it.",

  "ml_trained.model_kind": "Which model to train: 0 = logistic, 1 = random forest, 2 = gradient boosting, 3 = XGBoost. Random forest (1) is a safe default.",
  "ml_trained.horizon": "How many days ahead the model is trained to predict returns over. 21 ≈ one month.",
  "ml_trained.retrain": "How often the model is refit on newer data as the backtest walks forward. 63 days ≈ quarterly.",
  "ml_trained.train_window": "How much history the first model is trained on before predictions begin. 504 days ≈ two years.",

  "ict_fvg.min_gap_pct": "Smallest fair-value gap to trade, as a percent of price. Higher = only bigger, cleaner imbalances. 0.10% is a light filter.",
  "ict_fvg.tap_depth": "How far price must trade into the gap to trigger an entry. 0 = enter on the first touch of the near edge; 0.5 = wait for a 50% fill.",
  "ict_fvg.stop_buffer": "Extra room beyond the far edge of the gap where the stop sits, as a percent of price. Bigger = fewer premature stop-outs.",
  "ict_fvg.rr": "Reward-to-risk ratio for the target. 2 means the take-profit is twice the distance to the stop.",
  "ict_fvg.max_hold": "Force-close a trade after this many bars if neither stop nor target is hit. 0 disables the time stop.",
  "ict_fvg.use_ifvg": "1 = also trade inverse FVGs: when a gap is violated (price closes through it) the zone flips and is traded as the opposite level.",
};

export const FIELD_HELP = {
  topN: "How many assets to hold at once — the top-ranked by the signal. With short selling on, the same count is used per side.",
  rebalance: "How often the strategy re-ranks and trades. Every bar trades on each candle; Daily trades once per session. Weekly balances responsiveness against trading costs.",
  positioning:
    "Buy best assets owns the best-ranked names. Buy best, short worst also shorts the lowest-ranked (roughly market-neutral). Weight by signal sizes each position by conviction.",
  slipFixed: "A flat cost per share, in dollars, to model commissions and spread. Leave at 0.005 if unsure.",
  slipBps: "Trading cost as basis points of trade value (1 bp = 0.01%), modelling the bid/ask spread. 2 is reasonable for liquid stocks.",
  impactK:
    "Strength of the square-root market-impact model: bigger orders push price further. Leave at 0.1 unless you're simulating large size.",
  capital: "Starting cash for the simulation. Purely sets the scale of dollar figures in the results.",
  mlModel: "The classifier trained to predict whether each trade will win. Random forest is a solid default.",
  mlThreshold: "Minimum predicted win probability to actually take a trade. Higher = pickier, fewer trades. 0.55 is a gentle filter.",
  mlRetrain: "How often the filter is refit on newer trades as the backtest walks forward.",
} as const;
