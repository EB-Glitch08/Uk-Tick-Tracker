"""Import Elanco's sightings into our database.

Steps: fetch from Elanco -> clean each record -> save it, skipping duplicates.
It returns a summary of what happened, and never crashes if Elanco is down.
"""
import json
import logging
import sqlite3
from datetime import datetime, timezone

from backend.cleaning import clean_record
from backend.db import get_connection, init_db
from backend.elanco import ElancoError, fetch_sightings

logger = logging.getLogger("tick-tracker")

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
            # One bad record must never stop the whole import. clean_record
            # raises ValueError for the problems we expect, but we catch
            # anything at all here: a single odd record from Elanco should cost
            # us that record, not the other nine hundred and ninety nine.
            try:
                row = clean_record(raw)
            except Exception as problem:
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
            except sqlite3.Error as problem:
                # Any other database complaint about this one row.
                summary["rejected"] += 1
                if len(summary["rejected_examples"]) < 5:
                    summary["rejected_examples"].append(f"could not save: {problem}")
                continue

            summary["saved"] += 1
            if row["is_complete"] == 0:
                summary["incomplete"] += 1

        conn.commit()   # one commit at the end keeps the import fast
    finally:
        conn.close()

    return summary


# How long Elanco's data is treated as fresh. Restarting the server inside this
# window skips the fetch, which matters while developing: the server reloads
# every time a file is saved, and refetching each time would quickly earn us a
# "too many requests" reply from Elanco.
FRESH_FOR_MINUTES = 15


def minutes_since_last_import():
    """How long ago we last saved Elanco data, or None if we never have."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT MAX(created_at) FROM sightings WHERE source = 'elanco'"
        ).fetchone()
    finally:
        conn.close()

    if not row or not row[0]:
        return None

    try:
        last = datetime.fromisoformat(row[0])
    except ValueError:
        return None

    if last.tzinfo is None:                       # older rows were saved without one
        last = last.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - last).total_seconds() / 60


def import_in_background():
    """Refresh Elanco's data and write the result to the server log.

    This is what the server calls when it starts. It never raises, so a problem
    with Elanco can't take the website down with it.
    """
    try:
        init_db()
        age = minutes_since_last_import()
        if age is not None and age < FRESH_FOR_MINUTES:
            logger.info("Elanco data was refreshed %d minutes ago, so it is left "
                        "as it is.", age)
            return

        summary = import_elanco()
    except Exception:
        logger.exception("The import from Elanco failed unexpectedly")
        return

    if summary["error"]:
        logger.warning("Could not refresh Elanco's data: %s. "
                       "The site is still running on the data we already hold.",
                       summary["error"])
    else:
        logger.info("Elanco data refreshed: %s fetched, %s new, %s already held, "
                    "%s rejected.", summary["fetched"], summary["saved"],
                    summary["duplicates"], summary["rejected"])


if __name__ == "__main__":
    # Lets you run it from the terminal:  python -m backend.importer
    print(json.dumps(import_elanco(), indent=2))