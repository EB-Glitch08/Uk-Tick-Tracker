"""The FastAPI app: starts the server, sets up the database and plugs in the endpoints."""
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.api import router
from backend.errors import register_error_handlers
from backend.insights import router as insights_router
from backend.search import router as search_router
from backend.db import get_connection, init_db
from backend.importer import import_elanco


def database_is_empty():
    """True if no sightings are stored yet (i.e. the very first run)."""
    conn = get_connection()
    try:
        return conn.execute("SELECT COUNT(*) FROM sightings").fetchone()[0] == 0
    finally:
        conn.close()


@asynccontextmanager
async def lifespan(app):
    # Runs once when the server starts, before any requests are handled.
    init_db()   # make sure the database and tables exist
    if database_is_empty():
        # First run: fetch Elanco's data in a background thread so the server
        # starts straight away, even if Elanco is slow or rate-limiting us.
        threading.Thread(target=import_elanco, daemon=True).start()
    yield


app = FastAPI(title="UK Tick Tracker", lifespan=lifespan)
register_error_handlers(app)
app.include_router(router)
app.include_router(search_router)
app.include_router(insights_router)


@app.get("/api/health")
def health():
    return {"status": "ok"}