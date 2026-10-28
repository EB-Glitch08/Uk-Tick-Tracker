"""Database setup for the UK Tick Tracker.

Uses SQLite through Python's built-in sqlite3 module. There is no database
server to install, and the whole database is one file, which keeps the
project easy to run and review.
"""
import sqlite3
from pathlib import Path

# Work out where the database file lives relative to this file, so it always
# ends up in <project root>/data/ticks.db wherever the app is started from.
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "ticks.db"

def get_connection():
    """Open the database and return a connection."""
    # Make sure the data folder exists before SQLite tries to create the file.
    DB_PATH.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    # Lets us read columns by name, e.g. row["species"], not by position.
    conn.row_factory = sqlite3.Row
    return conn

# SQL that creates the sightings table. One row is one tick sighting.
SCHEMA = """
CREATE TABLE IF NOT EXISTS sightings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,  -- unique id, created automatically
    external_id TEXT,                               -- the id from the Elanco data, used to spot repeat imports
    source      TEXT NOT NULL,                      -- where it came from: 'elanco' or 'user'
    sighted_on  TEXT NOT NULL,                      -- date as text, YYYY-MM-DD (SQLite has no date type)
    lat         REAL,                               -- latitude; empty if the record has no coordinates
    lon         REAL,                               -- longitude
    location    TEXT,                               -- place name, e.g. "Epping Forest"
    region      TEXT,                               -- UK region, used for per-region totals
    species     TEXT NOT NULL DEFAULT 'Unknown',    -- tick species
    latin_name  TEXT,                               --scientific name,e.g. Ixodes acuminatus
    notes       TEXT,                               -- free-text notes from the person reporting
    image_path  TEXT,                               -- file name of an uploaded photo, if any
    is_complete INTEGER NOT NULL DEFAULT 1,         -- 1 = has coordinates and can go on the map, 0 = flagged incomplete
    dedupe_key  TEXT NOT NULL UNIQUE,               -- fingerprint of the sighting; UNIQUE stops duplicates being stored
    created_at  TEXT NOT NULL                       -- when the row was added
);
"""

def init_db():
    """Create the tables if they don't exist yet. Safe to run on every start."""
    conn = get_connection()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        # Always close the connection, even if something above fails.
        conn.close()