"""The endpoint that accepts new sighting reports from the front-end form."""
import sqlite3
from datetime import date, datetime, timezone

from fastapi import APIRouter, HTTPException

from backend.db import get_connection
from backend.helpers import make_dedupe_key, round_place
from backend.models import SightingIn
from backend.regions import nearest_city

router = APIRouter(prefix="/api")

# Elanco's data starts in 2012, so anything earlier is worth a warning.
EARLIEST_IN_DATA = date(2012, 1, 1)


def tidy_species(conn, species):
    """Clean up the species name a user gave us.

    - Spaces around it are removed, and a blank name becomes "Unknown".
    - If we already hold this species under different capital letters
      (for example "marsh tick" when we have "Marsh tick"), we reuse the
      existing spelling, so the two are counted together rather than as
      two separate species.
    """
    species = species.strip()
    if not species or species.lower() == "unknown":
        return "Unknown"

    existing = conn.execute(
        "SELECT species FROM sightings WHERE species = ? COLLATE NOCASE LIMIT 1",
        (species,),
    ).fetchone()
    return existing["species"] if existing else species


def warnings_for(report, species, city):
    """Things worth telling the user about a report we are still going to save.

    These are warnings, not errors: the sighting is fine, but something about
    it is unusual and the user should know how we have recorded it.
    """
    notes = []

    if species == "Unknown":
        notes.append("No species was given, so this sighting is recorded as Unknown.")
    if report.sighted_on < EARLIEST_IN_DATA:
        notes.append("That date is earlier than the data we hold, which starts in 2012. "
                     "The sighting has still been saved.")
    if city is None:
        notes.append("This spot isn't close to any of the cities we track, "
                     "so it is grouped under Other.")

    return notes


@router.post("/sightings", status_code=201)
def create_sighting(report: SightingIn):
    """Save one new sighting reported by a user."""
    day = report.sighted_on.isoformat()

    # The form gives us coordinates, so we look up the nearest city ourselves.
    # Saving the city name means user reports show up in the same city filters
    # and on the same map groupings as Elanco's records.
    city, region = nearest_city(report.lat, report.lon)

    # If the spot is near a city, that city is the location, even if the user typed
    # a more specific place name. This keeps every sighting for a city together.
    # Only when no city is near do we use the name the user typed (if they gave one).
    typed_place = report.location.strip() if report.location else ""
    location = city or typed_place or None

    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    conn = get_connection()
    try:
        species = tidy_species(conn, report.species)

        # Two reports of the same species, on the same day, within about 100 metres
        # are treated as the same sighting.
        dedupe_key = make_dedupe_key(day, species, round_place(report.lat, report.lon))

        cursor = conn.execute(
            """INSERT INTO sightings
               (source, sighted_on, lat, lon, location, region, species,
                notes, is_complete, dedupe_key, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)""",
            ("user", day, report.lat, report.lon, location, region,
             species, report.notes, dedupe_key, created_at),
        )
        conn.commit()
        new_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        # The UNIQUE rule on dedupe_key stopped us: this sighting is already here.
        raise HTTPException(status_code=409, detail="This sighting has already been reported.")
    finally:
        conn.close()

    return {
        "id": new_id,
        "location": location,
        "region": region,
        "species": species,
        "warnings": warnings_for(report, species, city),
        "message": "Sighting saved.",
    }
