"""Small helper functions used when saving sightings."""


def make_dedupe_key(sighted_on, species, place):
    """Build a 'fingerprint' for a sighting so duplicates can be spotted.

    Two sightings with the same date, species and place get the same key.
    The database has a UNIQUE rule on this key, so a duplicate can't be saved twice.

    sighted_on: the date, e.g. "2026-10-01"
    species:    the species name, e.g. "Southern rodent tick"
    place:      where it was seen. For a user's report this is their coordinates
                rounded to about 100 m; for Elanco data it is the city name.
    """
    # strip() and lower() make "Deer Tick " and "deer tick" count as the same species.
    return f"{sighted_on}|{species.strip().lower()}|{place}"


def round_place(lat, lon):
    """Round coordinates to 3 decimal places, which is about 100 metres.

    Two reports from nearly the same spot then count as the same place.
    """
    return f"{round(lat, 3)},{round(lon, 3)}"