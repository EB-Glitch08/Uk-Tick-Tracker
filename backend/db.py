"""The SQLite database: where it lives, what it looks like, and how to open it."""
import sqlite3
from pathlib import Path

# The database file sits in the data folder next to the backend folder.
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "ticks.db"


def get_connection():
    """Open a connection to the database, creating the data folder if needed."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row   # so rows can be read by column name
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS sightings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT,
    source      TEXT NOT NULL,
    sighted_on  TEXT NOT NULL,
    lat         REAL,
    lon         REAL,
    location    TEXT,
    region      TEXT,
    species     TEXT NOT NULL DEFAULT 'Unknown',
    latin_name  TEXT,
    notes       TEXT,
    image_path  TEXT,
    is_complete INTEGER NOT NULL DEFAULT 1,
    dedupe_key  TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL
);
"""


def init_db():
    """Create the table if it isn't there yet. Safe to call every time."""
    conn = get_connection()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()
