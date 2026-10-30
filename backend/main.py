"""The FastAPI app: starts the server, sets up the database and plugs in the endpoints."""
import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.api import router
from backend.errors import register_error_handlers
from backend.insights import router as insights_router
from backend.search import router as search_router
from backend.db import init_db
from backend.importer import import_in_background

# Show our own log messages, such as what the import did.
logging.basicConfig(level=logging.INFO)

# The frontend folder sits next to the backend folder.
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app):
    # Runs once when the server starts, before any requests are handled.
    init_db()   # make sure the database and tables exist

    # Fetch Elanco's data on every start, so new records are picked up rather
    # than only on the very first run. Re-importing is safe because duplicates
    # are blocked by the database. It runs in a background thread so the server
    # starts straight away, even if Elanco is slow, rate-limiting us or down.
    threading.Thread(target=import_in_background, daemon=True,
                     name="elanco-import").start()
    yield


app = FastAPI(title="UK Tick Tracker", lifespan=lifespan)
register_error_handlers(app)
app.include_router(router)
app.include_router(search_router)
app.include_router(insights_router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Git doesn't store empty folders, so a fresh copy of this project might not have
# a frontend folder yet. Make it rather than refuse to start.
FRONTEND_DIR.mkdir(parents=True, exist_ok=True)

# This must come LAST. It serves the web pages from the frontend folder, and
# because it matches every address, it would hide the /api routes if it came first.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
