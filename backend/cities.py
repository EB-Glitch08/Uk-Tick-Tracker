"""UK cities used to place sightings on the map and group them by region.

Elanco's data only gives a city name, not coordinates, so we look the
city up here. The same list also lets us guess the region of a user's report.
"""

# city name -> (latitude, longitude, region)
CITIES = {
    "Birmingham":  (52.4862, -1.8904, "West Midlands"),
    "Bristol":     (51.4545, -2.5879, "South West"),
    "Cardiff":     (51.4816, -3.1791, "Wales"),
    "Edinburgh":   (55.9533, -3.1883, "Scotland"),
    "Glasgow":     (55.8642, -4.2518, "Scotland"),
    "Leeds":       (53.8008, -1.5491, "Yorkshire and the Humber"),
    "Leicester":   (52.6369, -1.1398, "East Midlands"),
    "Liverpool":   (53.4084, -2.9916, "North West"),
    "London":      (51.5074, -0.1278, "London"),
    "Manchester":  (53.4808, -2.2426, "North West"),
    "Newcastle":   (54.9783, -1.6178, "North East"),
    "Nottingham":  (52.9548, -1.1581, "East Midlands"),
    "Sheffield":   (53.3811, -1.4701, "Yorkshire and the Humber"),
    "Southampton": (50.9097, -1.4044, "South East"),
}