"""Tradable universe for the synthetic data provider.

Symbols mirror a liquid US large-cap set so strategies read naturally. Each
entry carries the generator's per-symbol personality: annual drift, annual
volatility, and a starting price (2010-01-04).
"""

BENCHMARK = "SPY"

UNIVERSE: dict[str, dict] = {
    "SPY":  {"name": "S&P 500 ETF",        "sector": "Index",       "start": 112.0, "drift": 0.095, "vol": 0.16},
    "AAPL": {"name": "Apple",              "sector": "Technology",  "start": 7.6,   "drift": 0.22,  "vol": 0.28},
    "MSFT": {"name": "Microsoft",          "sector": "Technology",  "start": 30.0,  "drift": 0.19,  "vol": 0.25},
    "NVDA": {"name": "NVIDIA",             "sector": "Technology",  "start": 4.6,   "drift": 0.31,  "vol": 0.46},
    "GOOG": {"name": "Alphabet",           "sector": "Technology",  "start": 15.6,  "drift": 0.17,  "vol": 0.27},
    "AMZN": {"name": "Amazon",             "sector": "Consumer",    "start": 6.7,   "drift": 0.21,  "vol": 0.32},
    "META": {"name": "Meta Platforms",     "sector": "Technology",  "start": 19.0,  "drift": 0.18,  "vol": 0.38},
    "TSLA": {"name": "Tesla",              "sector": "Consumer",    "start": 1.6,   "drift": 0.27,  "vol": 0.55},
    "JPM":  {"name": "JPMorgan Chase",     "sector": "Financials",  "start": 41.0,  "drift": 0.12,  "vol": 0.24},
    "BAC":  {"name": "Bank of America",    "sector": "Financials",  "start": 15.1,  "drift": 0.09,  "vol": 0.28},
    "GS":   {"name": "Goldman Sachs",      "sector": "Financials",  "start": 168.0, "drift": 0.10,  "vol": 0.26},
    "V":    {"name": "Visa",               "sector": "Financials",  "start": 22.0,  "drift": 0.17,  "vol": 0.22},
    "JNJ":  {"name": "Johnson & Johnson",  "sector": "Healthcare",  "start": 64.0,  "drift": 0.08,  "vol": 0.15},
    "PFE":  {"name": "Pfizer",             "sector": "Healthcare",  "start": 18.0,  "drift": 0.06,  "vol": 0.20},
    "UNH":  {"name": "UnitedHealth",       "sector": "Healthcare",  "start": 31.0,  "drift": 0.18,  "vol": 0.23},
    "XOM":  {"name": "Exxon Mobil",        "sector": "Energy",      "start": 68.0,  "drift": 0.05,  "vol": 0.24},
    "CVX":  {"name": "Chevron",            "sector": "Energy",      "start": 77.0,  "drift": 0.06,  "vol": 0.23},
    "PG":   {"name": "Procter & Gamble",   "sector": "Consumer",    "start": 61.0,  "drift": 0.08,  "vol": 0.14},
    "KO":   {"name": "Coca-Cola",          "sector": "Consumer",    "start": 28.0,  "drift": 0.07,  "vol": 0.13},
    "WMT":  {"name": "Walmart",            "sector": "Consumer",    "start": 54.0,  "drift": 0.09,  "vol": 0.16},
    "DIS":  {"name": "Disney",             "sector": "Consumer",    "start": 32.0,  "drift": 0.08,  "vol": 0.24},
    "NFLX": {"name": "Netflix",            "sector": "Technology",  "start": 7.9,   "drift": 0.24,  "vol": 0.42},
    "CRM":  {"name": "Salesforce",         "sector": "Technology",  "start": 18.5,  "drift": 0.18,  "vol": 0.32},
    "ORCL": {"name": "Oracle",             "sector": "Technology",  "start": 24.7,  "drift": 0.13,  "vol": 0.24},
    "INTC": {"name": "Intel",              "sector": "Technology",  "start": 20.8,  "drift": 0.04,  "vol": 0.28},
    "AMD":  {"name": "AMD",                "sector": "Technology",  "start": 9.7,   "drift": 0.20,  "vol": 0.48},
    "BA":   {"name": "Boeing",             "sector": "Industrials", "start": 56.0,  "drift": 0.07,  "vol": 0.31},
    "CAT":  {"name": "Caterpillar",        "sector": "Industrials", "start": 58.0,  "drift": 0.11,  "vol": 0.25},
    "GE":   {"name": "General Electric",   "sector": "Industrials", "start": 15.4,  "drift": 0.05,  "vol": 0.27},
    "T":    {"name": "AT&T",               "sector": "Telecom",     "start": 28.0,  "drift": 0.03,  "vol": 0.16},
    "GLD":  {"name": "Gold Trust ETF",     "sector": "Commodities", "start": 109.0, "drift": 0.06,  "vol": 0.15},
}

SYMBOLS = [s for s in UNIVERSE if s != BENCHMARK]
