"""Aggregate insight endpoints: totals per region and trends over time."""
from datetime import date, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException

from backend.cities import CITIES
from backend.db import get_connection
from backend.region_groups import GROUP_ORDER, group_for

router = APIRouter(prefix="/api/insights")


def build_where(date_from, date_to, city=None, region=None, species=None):
    """Turn the optional filters into a SQL WHERE clause and its values."""
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from must not be after date_to.")

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

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    return where, values


@router.get("/regions")
def sightings_per_region(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    species: Optional[str] = None,
):
    """How many sightings there are in each region, biggest first."""
    where, values = build_where(date_from, date_to, species=species)

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT COALESCE(region, 'Unknown') AS region, COUNT(*) AS count "
            f"FROM sightings {where} "
            "GROUP BY COALESCE(region, 'Unknown') ORDER BY count DESC, region",
            values,
        ).fetchall()
    finally:
        conn.close()

    regions = [dict(row) for row in rows]

    # The page shows a short list of wider areas rather than every region, so
    # the same figures are also returned folded into those groups.
    areas = {}
    for row in regions:
        area = group_for(None if row["region"] == "Unknown" else row["region"])
        areas[area] = areas.get(area, 0) + row["count"]

    ordered = sorted(
        ({"area": name, "count": count} for name, count in areas.items()),
        key=lambda a: (-a["count"],
                       GROUP_ORDER.index(a["area"]) if a["area"] in GROUP_ORDER else 99),
    )

    return {
        "total": sum(r["count"] for r in regions),
        "regions": regions,     # every region, in detail
        "areas": ordered,       # the same totals, grouped for the page
    }


@router.get("/locations")
def sightings_per_location(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    species: Optional[str] = None,
):
    """Sightings grouped by place, ready for the map.

    The map needs every sighting, which would be thousands of rows. Because all
    of our sightings sit at a known place, we can send one row per place with
    the counts worked out here instead. That keeps the response small however
    much data we hold, and gives the map the bubble size and species mix it
    needs in a single request.
    """
    where, values = build_where(date_from, date_to, species=species)

    # Only sightings with a position can go on the map.
    where = (where + " AND is_complete = 1") if where else "WHERE is_complete = 1"

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT COALESCE(location, 'Other') AS location, region, "
            "ROUND(lat, 2) AS lat, ROUND(lon, 2) AS lon, species, "
            "COUNT(*) AS count, MAX(sighted_on) AS latest "
            f"FROM sightings {where} "
            "GROUP BY COALESCE(location, 'Other'), region, ROUND(lat, 2), ROUND(lon, 2), species",
            values,
        ).fetchall()
    finally:
        conn.close()

    # Fold the rows into one entry per place.
    places = {}
    for row in rows:
        name = row["location"]
        if name in CITIES:
            # A city is a single place, however far from the centre a user's
            # report was. We use the city's own coordinates so its bubble stays
            # put instead of drifting towards whichever report came last.
            key = name
            lat, lon, region = CITIES[name]
        else:
            # Spots that aren't near any city: one place per position, rounded
            # to about a kilometre, so unrelated sightings aren't lumped together.
            key = (name, row["lat"], row["lon"])
            lat, lon, region = row["lat"], row["lon"], row["region"]

        place = places.setdefault(key, {
            "location": name,
            "region": region,
            # The wider area the map shades, so the page doesn't have to work
            # the grouping out for itself.
            "area": group_for(region),
            "lat": lat,
            "lon": lon,
            "count": 0,
            "latest": row["latest"],
            "species": {},
        })
        place["count"] += row["count"]
        place["latest"] = max(place["latest"], row["latest"])
        place["species"][row["species"]] = place["species"].get(row["species"], 0) + row["count"]

    # Turn each species tally into a list, most common first.
    locations = []
    for place in places.values():
        tally = sorted(place["species"].items(), key=lambda item: (-item[1], item[0]))
        place["species"] = [{"species": name, "count": count} for name, count in tally]
        locations.append(place)
    locations.sort(key=lambda p: p["count"], reverse=True)
    return {"total": sum(p["count"] for p in locations), "locations": locations}


def fill_gaps(counts, interval):
    """Add zero-count periods between the first and last one.

    Without this, a quiet month would simply be missing, and a chart would
    draw a straight line over the gap instead of showing the dip to zero.
    """
    if not counts:
        return []

    first, last = min(counts), max(counts)
    points = []

    if interval == "month":
        year, month = int(first[:4]), int(first[5:7])
        end = (int(last[:4]), int(last[5:7]))
        while (year, month) <= end:
            key = f"{year:04d}-{month:02d}"
            points.append({"period": key, "count": counts.get(key, 0)})
            month += 1
            if month == 13:
                year, month = year + 1, 1
    else:
        # Weeks are labelled by the Monday they start on, so step 7 days at a time.
        day = date.fromisoformat(first)
        end_day = date.fromisoformat(last)
        while day <= end_day:
            key = day.isoformat()
            points.append({"period": key, "count": counts.get(key, 0)})
            day += timedelta(days=7)

    return points


@router.get("/trends")
def trends_over_time(
    interval: Literal["week", "month"] = "month",
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    city: Optional[str] = None,
    region: Optional[str] = None,
    species: Optional[str] = None,
):
    """Number of sightings per week or per month, oldest first."""
    where, values = build_where(date_from, date_to, city, region, species)

    if interval == "month":
        period_sql = "strftime('%Y-%m', sighted_on)"            # e.g. "2020-03"
    else:
        # The Monday of the week the sighting falls in, e.g. "2020-03-09".
        period_sql = "date(sighted_on, 'weekday 0', '-6 days')"

    conn = get_connection()
    try:
        rows = conn.execute(
            f"SELECT {period_sql} AS period, COUNT(*) AS count "
            f"FROM sightings {where} GROUP BY period ORDER BY period",
            values,
        ).fetchall()
    finally:
        conn.close()

    counts = {row["period"]: row["count"] for row in rows}
    return {
        "interval": interval,
        "total": sum(counts.values()),
        "points": fill_gaps(counts, interval),
    }
