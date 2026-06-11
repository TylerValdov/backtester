"""FastAPI application entry point."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import analytics, auth, backtests, market, paper, settings_api, strategies
from .config import get_settings
from .db import Base, engine as db_engine
from .paper import engine as paper_engine

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(db_engine)
    paper_engine.start()  # live paper trading tick loop
    yield


app = FastAPI(title="Backtester", version="0.1.0", lifespan=lifespan)

# The Next.js dev server proxies /api/* here (same-origin cookies), but CORS
# stays open to the frontend origin for direct calls and the WebSocket.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_prefix = "/api"
app.include_router(auth.router, prefix=api_prefix)
app.include_router(strategies.router, prefix=api_prefix)
app.include_router(backtests.router, prefix=api_prefix)
app.include_router(paper.router, prefix=api_prefix)
app.include_router(analytics.router, prefix=api_prefix)
app.include_router(settings_api.router, prefix=api_prefix)
app.include_router(market.router, prefix=api_prefix)

app.add_api_websocket_route("/ws/paper/{session_id}", paper.paper_ws)


@app.get("/api/health")
def health():
    return {"ok": True, "provider": settings.market_data_provider}
