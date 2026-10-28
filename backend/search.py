"""Search and filter endpoint for tick sightings."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.db import get_connection

router = APIRouter(prefix="/api")

# The columns we send back to the browser.
COLUMNS = ("id, source, sighted_on, lat, lon, location, region, species, "
           "latin_name, notes, image_path, is_complete")


@router.get("/sightings")
def search_sightings(
    date_from: Optional[date] = Query(None, description="Earliest date, YYYY-MM-DD"),
    date_to: Optional[date] = Query(None, description="Latest date, YYYY-MM-DD"),
    city: Optional[str] = Query(None, description="City name, e.g. London"),
    region: Optional[str] = Query(None, description="Region, e.g. Scotland"),
    species: Optional[str] = Query(None, description="Species name, e.g. Marsh tick"),
    on_map_only: bool = Query(False, description="Only sightings that have a position"),
    limit: int = Query(100, ge=1, le=500, description="How many results to return"),
    offset: int = Query(0, ge=0, description="How many results to skip (for paging)"),
):
    """Search sightings. Every filter is optional, and filters combine with AND."""
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from must not be after date_to.")

    # Build the WHERE part piece by piece. The ? marks keep user input out of the SQL itself.
    conditions = []
    values = []
    if date_from:
        conditions.append("sighted_on >= ?")
        values.append(date_from.isoformat())
    if date_to:
        conditions.append("sighted_on <= ?")
        values.append(date_to.isoformat())
    if city:
        conditions.append("location = ? COLLATE NOCASE")
        values.append(city.strip())
    if region:
        conditions.append("region = ? COLLATE NOCASE")
        values.append(region.strip())
    if species:
        conditions.append("species = ? COLLATE NOCASE")
        values.append(species.strip())
    if on_map_only:
        conditions.append("is_complete = 1")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    conn = get_connection()
    try:
        total = conn.execute(f"SELECT COUNT(*) FROM sightings {where}", values).fetchone()[0]
        rows = conn.execute(
            f"SELECT {COLUMNS} FROM sightings {where} "
            "ORDER BY sighted_on DESC, id DESC LIMIT ? OFFSET ?",
            values + [limit, offset],
        ).fetchall()
    finally:
        conn.close()

    return {"total": total, "limit": limit, "offset": offset, "items": [dict(r) for r in rows]}