"""Search and filter endpoints for tick sightings."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.cities import CITIES
from backend.db import get_connection
from backend.helpers import public_view
from backend.regions import distance_km

router = APIRouter(prefix="/api")

# The columns we send back to the browser.
COLUMNS = ("id, source, sighted_on, lat, lon, location, region, species, "
           "latin_name, notes, image_path, host, is_complete")


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

    return {"total": total, "limit": limit, "offset": offset,
            "items": [public_view(r) for r in rows]}


# This has to be declared before the "/sightings/{sighting_id}" route below,
# or the word "nearby" would be read as an id.
@router.get("/sightings/nearby")
def sightings_nearby(
    lat: float = Query(..., ge=49.8, le=60.9, description="Latitude of the centre"),
    lon: float = Query(..., ge=-8.7, le=1.8, description="Longitude of the centre"),
    within_km: float = Query(10, gt=0, le=200, description="How far to look, in km"),
    limit: int = Query(20, ge=1, le=200),
    exclude_id: Optional[int] = Query(None, description="A sighting to leave out"),
):
    """Sightings within a given distance of a point, closest first.

    This is what the detail page uses for "nearby activity". The distance is
    worked out in Python rather than SQL, because SQLite has no built-in way to
    measure distance on the Earth's surface. To keep that cheap, a box around
    the point is cut out in SQL first, so only the sightings that could possibly
    be close are measured.
    """
    # One degree of latitude is about 111 km anywhere. A degree of longitude is
    # narrower the further north you go, so it is adjusted for the latitude.
    import math
    lat_span = within_km / 111.0
    lon_span = within_km / max(1.0, 111.0 * math.cos(math.radians(lat)))

    conn = get_connection()
    try:
        rows = conn.execute(
            f"SELECT {COLUMNS} FROM sightings "
            "WHERE is_complete = 1 AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
            (lat - lat_span, lat + lat_span, lon - lon_span, lon + lon_span),
        ).fetchall()
    finally:
        conn.close()

    found = []
    for row in rows:
        if exclude_id is not None and row["id"] == exclude_id:
            continue
        away = distance_km(lat, lon, row["lat"], row["lon"])
        if away <= within_km:
            sighting = public_view(row)
            sighting["distance_km"] = round(away, 1)
            found.append(sighting)

    found.sort(key=lambda s: (s["distance_km"], s["sighted_on"]))
    return {"total": len(found), "within_km": within_km, "items": found[:limit]}


@router.get("/places")
def known_places():
    """The places we can put a sighting, with their coordinates.

    The report form needs these to turn "Southampton" into a position, and the
    filters use the same list. Serving it from here means the list of cities is
    written down once, in cities.py, rather than copied into the web pages.
    """
    places = [
        {"name": name, "lat": lat, "lon": lon, "region": region}
        for name, (lat, lon, region) in sorted(CITIES.items())
    ]
    return {"total": len(places), "places": places}


@router.get("/sightings/{sighting_id}")
def one_sighting(sighting_id: int):
    """A single sighting, for the detail page and for shared links."""
    conn = get_connection()
    try:
        row = conn.execute(
            f"SELECT {COLUMNS} FROM sightings WHERE id = ?", (sighting_id,)
        ).fetchone()
    finally:
        conn.close()

    if row is None:
        raise HTTPException(status_code=404, detail="That sighting could not be found.")

    return public_view(row)