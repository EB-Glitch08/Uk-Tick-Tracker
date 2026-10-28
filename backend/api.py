"""The API endpoints for tick sightings."""
import sqlite3
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from backend.db import get_connection
from backend.helpers import make_dedupe_key, round_place
from backend.models import SightingIn
from backend.regions import region_for

# A router groups related endpoints. Every address here starts with /api.
router = APIRouter(prefix="/api")


@router.post("/sightings", status_code=201)
def create_sighting(report: SightingIn):
    """Save a new sighting sent from the report form.

    FastAPI checks the form against SightingIn first and replies with a 422
    error if anything is wrong, so by the time we get here the data is valid.
    """
    # Work out the extra fields the user doesn't send.
    day = report.sighted_on.isoformat()                      # e.g. "2026-10-20"
    region = region_for(report.lat, report.lon)
    dedupe_key = make_dedupe_key(day, report.species, round_place(report.lat, report.lon))
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    conn = get_connection()
    try:
        cursor = conn.execute(
            """INSERT INTO sightings
               (source, sighted_on, lat, lon, location, region, species,
                notes, is_complete, dedupe_key, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)""",
            ("user", day, report.lat, report.lon, report.location, region,
             report.species, report.notes, dedupe_key, created_at),
        )
        conn.commit()
        new_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        # The UNIQUE rule on dedupe_key was broken: this sighting is already stored.
        raise HTTPException(status_code=409, detail="This sighting has already been reported.")
    finally:
        # Always close the connection, whether it worked or not.
        conn.close()

    return {"id": new_id, "region": region, "message": "Sighting saved."}