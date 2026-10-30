"""Work out which city and region a pair of coordinates belongs to.

Elanco's records come with a city name, but a user picking a spot on the map
gives us coordinates instead. We find the nearest city in our own list so that
user reports and Elanco records can be grouped the same way.
"""
import math

from backend.cities import CITIES

# Beyond this distance we don't claim the sighting belongs to a city.
MAX_DISTANCE_KM = 150


def distance_km(lat1, lon1, lat2, lon2):
    """Distance in kilometres between two points on the Earth's surface.

    This is the haversine formula: it treats the Earth as a sphere, which is
    accurate enough for deciding which city is closest.
    """
    radius = 6371  # the Earth's radius in kilometres
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return 2 * radius * math.asin(math.sqrt(a))


def nearest_city(lat, lon):
    """The closest city within MAX_DISTANCE_KM, as (name, region).

    Returns (None, "Other") if the spot isn't near any city we track, so a
    sighting in, say, the Highlands is still saved rather than thrown away.
    """
    best_name = None
    best_region = "Other"
    best_distance = MAX_DISTANCE_KM

    for name, (city_lat, city_lon, region) in CITIES.items():
        distance = distance_km(lat, lon, city_lat, city_lon)
        if distance < best_distance:
            best_distance = distance
            best_name = name
            best_region = region

    return best_name, best_region


def region_for(lat, lon):
    """Just the region for a pair of coordinates."""
    return nearest_city(lat, lon)[1]
