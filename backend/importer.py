"""Import Elanco's sightings into our database.

Steps: fetch from Elanco -> clean each record -> save it, skipping duplicates.
It returns a summary of what happened, and never crashes if Elanco is down.
"""
import json
import sqlite3
from datetime import datetime, timezone

from backend.cleaning import clean_record
from backend.db import get_connection, init_db
from backend.elanco import ElancoError, fetch_sightings

# The :names are filled in from the dict that clean_record returns.
INSERT_SQL = """
INSERT INTO sightings
    (external_id, source, sighted_on, lat, lon, location, region,
     species, latin_name, is_complete, dedupe_key, created_at)
VALUES
    (:external_id, :source, :sighted_on, :lat, :lon, :location, :region,
     :species, :latin_name, :is_complete, :dedupe_key, :created_at)
"""


def import_elanco():
    """Fetch, clean and save Elanco's sightings. Returns a summary dict."""
    summary = {
        "fetched": 0,       # records Elanco sent us
        "saved": 0,         # new rows added to our database
        "duplicates": 0,    # skipped because we already had them
        "incomplete": 0,    # saved, but flagged so they stay off the map
        "rejected": 0,      # unusable (e.g. no valid date), not saved
        "rejected_examples": [],
        "error": None,      # set if Elanco could not be reached
    }

    init_db()   # make sure the tables exist (safe to call every time)

    try:
        raw_records = fetch_sightings()
    except ElancoError as problem:
        # Elanco is unavailable. Don't crash: carry on with what we already have.
        summary["error"] = str(problem)
        return summary

    summary["fetched"] = len(raw_records)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    conn = get_connection()
    try:
        for raw in raw_records:
            # One bad record must never stop the whole import.
            try:
                row = clean_record(raw)
            except ValueError as problem:
                summary["rejected"] += 1
                if len(summary["rejected_examples"]) < 5:
                    summary["rejected_examples"].append(str(problem))
                continue

            row["created_at"] = now
            try:
                conn.execute(INSERT_SQL, row)
            except sqlite3.IntegrityError:
                # The UNIQUE rule on dedupe_key: we already have this sighting.
                summary["duplicates"] += 1
                continue

            summary["saved"] += 1
            if row["is_complete"] == 0:
                summary["incomplete"] += 1

        conn.commit()   # one commit at the end keeps the import fast
    finally:
        conn.close()

    return summary


if __name__ == "__main__":
    # Lets you run it from the terminal:  python -m backend.importer
    print(json.dumps(import_elanco(), indent=2))