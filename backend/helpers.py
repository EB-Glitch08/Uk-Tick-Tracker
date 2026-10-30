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


# How precisely a member of the public's own report is shown to everyone else.
# Two decimal places is roughly a kilometre.
PUBLIC_DECIMAL_PLACES = 2


def public_view(row):
    """Turn a database row into what we are willing to show the public.

    Someone reporting a tick usually does it where they found it, which may be
    their home or a walk they take often. We keep what they told us, but the
    position we hand back is rounded to about a kilometre, so the sighting is
    useful on a map without pointing at an address.

    Elanco's own records already sit on a city centre, so they are left alone.
    """
    sighting = dict(row)

    if sighting.get("source") == "user":
        for field in ("lat", "lon"):
            if sighting.get(field) is not None:
                sighting[field] = round(sighting[field], PUBLIC_DECIMAL_PLACES)
        sighting["precision"] = "about 1 km"
    else:
        sighting["precision"] = "city centre"

    return sighting