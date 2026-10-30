"""The SQLite database: where it lives, what it looks like, and how to open it."""
import sqlite3
from pathlib import Path

# The database file sits in the data folder next to the backend folder.
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "ticks.db"


def get_connection():
    """Open a connection to the database, creating the data folder if needed."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    # timeout: if another job is writing, wait up to 15 seconds instead of
    # failing immediately. The import writes a thousand rows at a time, so a
    # report sent while that is happening would otherwise be refused.
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row   # so rows can be read by column name

    # Write-Ahead Logging lets the site keep reading while the import writes,
    # so pages still load during a refresh of Elanco's data.
    conn.execute("PRAGMA journal_mode = WAL")
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

-- Indexes for the filters the site uses most. Without these, every search
-- reads the whole table; with them SQLite can jump straight to the rows.
CREATE INDEX IF NOT EXISTS idx_sightings_date     ON sightings (sighted_on);
CREATE INDEX IF NOT EXISTS idx_sightings_location ON sightings (location);
CREATE INDEX IF NOT EXISTS idx_sightings_species  ON sightings (species);
CREATE INDEX IF NOT EXISTS idx_sightings_region   ON sightings (region);
CREATE INDEX IF NOT EXISTS idx_sightings_map      ON sightings (is_complete, sighted_on);
"""

# Columns added after the first version of the database existed. Each one is
# added only if it isn't there yet, so an existing database is upgraded in
# place and nobody has to delete their data and start again.
LATER_COLUMNS = {
    "host": "TEXT",        # what the tick was found on: Dog, Cat, Person, Vegetation
}


def add_missing_columns(conn):
    """Bring an older database up to date with the columns we now expect."""
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(sightings)")}
    for column, column_type in LATER_COLUMNS.items():
        if column not in existing:
            conn.execute(f"ALTER TABLE sightings ADD COLUMN {column} {column_type}")


def init_db():
    """Create the table if it isn't there yet, and upgrade it if it's old.

    Safe to call every time the server starts.
    """
    conn = get_connection()
    try:
        conn.executescript(SCHEMA)
        add_missing_columns(conn)
        conn.commit()
    finally:
        conn.close()
