from contextlib import asynccontextmanager
from fastapi import FastAPI
from backend.db import init_db


@asynccontextmanager
async def lifespan(app):
    # Runs once when the server starts, before any requests are handled.
    # It makes sure the database and tables exist, so a fresh clone just works.
    init_db()
    yield


app = FastAPI(title="UK Tick Tracker", lifespan=lifespan)


@app.get("/api/health")
def health():
    return {"status": "ok"}