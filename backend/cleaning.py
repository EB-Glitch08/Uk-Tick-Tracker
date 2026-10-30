"""Clean one raw record from Elanco's API into a row we can store."""
from datetime import date, datetime

from backend.cities import CITIES
from backend.helpers import make_dedupe_key


def clean_record(raw):
    """Turn one record from Elanco into a dict ready for the database.

    Returns the dict, or raises ValueError (with the reason) if the record
    is unusable, for example if it has no valid date.
    """
    if not isinstance(raw, dict):
        raise ValueError("record is not a JSON object")

    def text(field):
        """Get a field as tidy text: None or a non-string becomes "", spaces are trimmed."""
        value = raw.get(field)
        return value.strip() if isinstance(value, str) else ""

    # The date is required. Without it the sighting can't go on a timeline or a trend.
    # A "Z" on the end of a date means UTC. Older versions of Python can't read
    # that, so we swap it for "+00:00", which every version understands.
    try:
        when = datetime.fromisoformat(text("date").replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(f"missing or invalid date: {raw.get('date')!r}")

    # A record may or may not carry a time zone. Comparing a date that has one
    # against a date that doesn't raises an error in Python, which would stop the
    # whole import, so we compare the calendar date only. That is all we store.
    if when.date() > date.today():
        raise ValueError(f"date is in the future: {text('date')}")

    city = text("location").title()           # "newcastle " -> "Newcastle"
    species = text("species") or "Unknown"
    latin_name = text("latinName") or None

    # Elanco gives a city, not coordinates, so we look the city up in our own list.
    # If the city is missing or unknown, we still keep the record but flag it
    # incomplete (is_complete = 0) so it stays off the map.
    if city in CITIES:
        lat, lon, region = CITIES[city]
        is_complete = 1
    else:
        lat = lon = region = None
        is_complete = 0

    return {
        "external_id": text("id") or None,
        "source": "elanco",
        "sighted_on": when.date().isoformat(),
        "lat": lat,
        "lon": lon,
        "location": city or None,
        "region": region,
        "species": species,
        "latin_name": latin_name,
        "is_complete": is_complete,
        # Elanco records include a time, so the key uses the full timestamp.
        # The time zone is dropped from the key so the same record always makes
        # the same key, even if Elanco changes how it writes its dates.
        "dedupe_key": make_dedupe_key(
            when.replace(tzinfo=None).isoformat(), latin_name or species, city),
    }