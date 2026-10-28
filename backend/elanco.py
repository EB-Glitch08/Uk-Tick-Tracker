"""Fetch tick sightings from Elanco's API, coping with the ways it can fail."""
import time

import requests

BASE_URL = "https://dev-task.elancoapps.com/data"
MAX_ATTEMPTS = 3
TIMEOUT_SECONDS = 15
RATE_LIMIT_WAIT = 60   # Elanco says to wait a minute after a 429


class ElancoError(Exception):
    """Raised when we can't get usable data from Elanco, even after retrying."""


def fetch_sightings():
    """Download every sighting from Elanco and return them as a list of dicts.

    Temporary problems (timeouts, rate limiting, server errors) are retried.
    If it still fails, ElancoError is raised so the caller can carry on
    with the data already in our database.
    """
    url = f"{BASE_URL}/tick-sightings"
    last_problem = "unknown problem"

    for attempt in range(1, MAX_ATTEMPTS + 1):
        wait = 2 * attempt          # short pause before retrying, longer each time
        try:
            response = requests.get(url, timeout=TIMEOUT_SECONDS)
        except requests.RequestException as error:
            # No internet, DNS failure, timeout...
            last_problem = f"could not reach Elanco ({error.__class__.__name__})"
        else:
            if response.status_code == 200:
                try:
                    data = response.json()
                except ValueError:
                    raise ElancoError("Elanco sent something that isn't valid JSON")
                if not isinstance(data, list):
                    raise ElancoError("Elanco sent an unexpected shape of data (expected a list)")
                return data
            if response.status_code == 429:
                last_problem = "rate limited by Elanco (429)"
                wait = RATE_LIMIT_WAIT
            elif response.status_code >= 500:
                last_problem = f"Elanco server error ({response.status_code})"
            else:
                # Other errors (like 404) won't fix themselves, so don't retry.
                raise ElancoError(f"Elanco replied with status {response.status_code}")

        if attempt < MAX_ATTEMPTS:
            time.sleep(wait)

    raise ElancoError(f"gave up after {MAX_ATTEMPTS} attempts: {last_problem}")