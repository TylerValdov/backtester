"""Test configuration.

Force the synthetic data provider for the whole suite, regardless of what
backend/.env says, so tests stay deterministic and offline (no Alpaca calls).
Set before any app import; env vars take precedence over .env in
pydantic-settings.
"""
import os

os.environ["MARKET_DATA_PROVIDER"] = "synthetic"
os.environ["RESEND_API_KEY"] = ""  # keep signup on the dev-link path in tests
os.environ["COOKIE_SECURE"] = "false"  # TestClient runs over http; a Secure cookie would be dropped
