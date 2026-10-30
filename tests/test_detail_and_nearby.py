"""Tests for the sighting detail page: one sighting, what is near it, and privacy."""
import sqlite3

from backend import db
from backend.region_groups import group_for


LONDON = {"lat": 51.5074, "lon": -0.1278}


def a_report(**changes):
    report = {"sighted_on": "2024-04-01", "species": "Marsh tick", **LONDON}
    report.update(changes)
    return report


# ---------------------------------------------------------------- one sighting

def test_a_sighting_can_be_looked_up_by_its_id(api):
    new_id = api.post("/api/sightings", json=a_report()).json()["id"]

    found = api.get(f"/api/sightings/{new_id}").json()

    assert found["id"] == new_id
    assert found["location"] == "London"
    assert found["species"] == "Marsh tick"


def test_a_sighting_that_does_not_exist_gives_a_clear_404(api):
    reply = api.get("/api/sightings/999999")

    assert reply.status_code == 404
    assert reply.json()["error"]["code"] == "not_found"


def test_a_report_comes_back_with_a_reference_the_reporter_can_quote(api):
    body = api.post("/api/sightings", json=a_report()).json()

    assert body["reference"].startswith("UK-2024-")


# ---------------------------------------------------------------- what it was found on

def test_what_the_tick_was_found_on_is_saved(api):
    new_id = api.post("/api/sightings", json=a_report(host="Dog")).json()["id"]

    assert api.get(f"/api/sightings/{new_id}").json()["host"] == "Dog"


def test_the_host_is_tidied_to_the_wording_the_site_uses(api):
    body = api.post("/api/sightings", json=a_report(host="  dog ")).json()

    assert body["host"] == "Dog"


def test_a_report_without_a_host_is_still_fine(api):
    body = api.post("/api/sightings", json=a_report(host=None))

    assert body.status_code == 201
    assert body.json()["host"] is None


# ---------------------------------------------------------------- privacy

def test_a_persons_own_report_is_shown_rounded_to_about_a_kilometre(api):
    """We keep what was reported, but don't show the public an exact spot."""
    new_id = api.post("/api/sightings", json=a_report(lat=51.50735, lon=-0.12776)).json()["id"]

    shown = api.get(f"/api/sightings/{new_id}").json()
    assert shown["lat"] == 51.51
    assert shown["lon"] == -0.13
    assert shown["precision"] == "about 1 km"

    # The precise position is still in our own records.
    conn = sqlite3.connect(db.DB_PATH)
    stored = conn.execute("SELECT lat, lon FROM sightings WHERE id = ?", (new_id,)).fetchone()
    conn.close()
    assert stored == (51.50735, -0.12776)


def test_elancos_own_records_are_left_as_they_are(loaded):
    """Those sit on a city centre already, so there is nothing to protect."""
    london = loaded.get("/api/sightings?city=London").json()["items"][0]

    assert london["precision"] == "city centre"
    assert london["lat"] == 51.5074


def test_search_results_are_rounded_too(api):
    api.post("/api/sightings", json=a_report(lat=51.50735, lon=-0.12776))

    found = api.get("/api/sightings").json()["items"][0]

    assert found["lat"] == 51.51


# ---------------------------------------------------------------- nearby

def test_nearby_finds_sightings_around_a_point(loaded):
    near = loaded.get("/api/sightings/nearby?lat=51.5074&lon=-0.1278&within_km=10").json()

    assert near["total"] == 2                  # the two London records
    assert all(item["distance_km"] <= 10 for item in near["items"])


def test_nearby_leaves_out_what_is_too_far(loaded):
    """Glasgow is hundreds of kilometres from London."""
    near = loaded.get("/api/sightings/nearby?lat=51.5074&lon=-0.1278&within_km=10").json()

    assert all(item["location"] != "Glasgow" for item in near["items"])


def test_nearby_is_closest_first(loaded):
    loaded.post("/api/sightings", json=a_report(lat=51.60, lon=-0.1278, sighted_on="2024-05-01"))

    items = loaded.get("/api/sightings/nearby?lat=51.5074&lon=-0.1278&within_km=50").json()["items"]
    distances = [item["distance_km"] for item in items]

    assert distances == sorted(distances)


def test_nearby_can_leave_out_the_sighting_being_looked_at(loaded):
    new_id = loaded.post("/api/sightings", json=a_report(sighted_on="2024-06-01")).json()["id"]

    with_it = loaded.get("/api/sightings/nearby?lat=51.5074&lon=-0.1278&within_km=10").json()
    without = loaded.get(
        f"/api/sightings/nearby?lat=51.5074&lon=-0.1278&within_km=10&exclude_id={new_id}").json()

    assert without["total"] == with_it["total"] - 1


def test_nearby_refuses_a_point_outside_the_uk(loaded):
    assert loaded.get("/api/sightings/nearby?lat=10&lon=10&within_km=10").status_code == 422


def test_nearby_refuses_a_silly_radius(loaded):
    assert loaded.get("/api/sightings/nearby?lat=51.5&lon=-0.1&within_km=0").status_code == 422
    assert loaded.get("/api/sightings/nearby?lat=51.5&lon=-0.1&within_km=5000").status_code == 422


# ---------------------------------------------------------------- wider areas

def test_regions_are_also_grouped_into_the_wider_areas_the_page_shows(loaded):
    body = loaded.get("/api/insights/regions").json()

    assert sum(area["count"] for area in body["areas"]) == body["total"]
    names = [area["area"] for area in body["areas"]]
    assert "South East & London" in names


def test_every_region_we_use_belongs_to_an_area():
    """A region that isn't in the grouping would quietly fall into "Elsewhere"."""
    from backend.cities import CITIES

    for _, _, region in CITIES.values():
        assert group_for(region) != "Elsewhere", region


def test_somewhere_we_do_not_recognise_is_grouped_rather_than_dropped():
    assert group_for(None) == "Elsewhere"
    assert group_for("Atlantis") == "Elsewhere"


def test_map_places_carry_the_wider_area_they_belong_to(loaded):
    """The map shades by area, so each place says which one it is in."""
    places = loaded.get("/api/insights/locations").json()["locations"]

    london = [p for p in places if p["location"] == "London"][0]
    assert london["area"] == "South East & London"

    glasgow = [p for p in places if p["location"] == "Glasgow"][0]
    assert glasgow["area"] == "Scotland"

    assert all(p["area"] for p in places)
