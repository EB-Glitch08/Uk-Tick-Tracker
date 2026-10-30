"""Group the detailed regions into the wider areas the site displays.

Each sighting is stored with the region of its nearest city, for example
"Yorkshire and the Humber". The map page shows a shorter list of wider areas,
which is easier to read at a glance, so the detailed region is folded into one
of these groups when the figures are worked out.

Keeping both means nothing is lost: a sighting can still be searched for by its
detailed region, while the summary stays short.
"""

# detailed region -> the wider area shown on the page
GROUPS = {
    "South West": "South West",
    "South East": "South East & London",
    "London": "South East & London",
    "Scotland": "Scotland",
    "Wales": "Wales",
    "North West": "Northern England",
    "North East": "Northern England",
    "Yorkshire and the Humber": "Northern England",
    "West Midlands": "Midlands & East",
    "East Midlands": "Midlands & East",
    "East of England": "Midlands & East",
    "Northern Ireland": "Northern Ireland",
}

# The order they appear in on the page when counts are equal.
GROUP_ORDER = [
    "South West",
    "South East & London",
    "Scotland",
    "Wales",
    "Northern England",
    "Midlands & East",
    "Northern Ireland",
]

ELSEWHERE = "Elsewhere"


def group_for(region):
    """The wider area a detailed region belongs to.

    Anything we don't recognise, including a sighting too far from any city to
    have a region at all, is grouped under "Elsewhere" rather than dropped.
    """
    if not region:
        return ELSEWHERE
    return GROUPS.get(region, ELSEWHERE)
