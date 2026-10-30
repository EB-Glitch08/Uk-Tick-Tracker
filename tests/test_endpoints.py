"""Tests for the endpoints the front end uses: reporting, searching and insights."""
from datetime import date, timedelta


# ---------------------------------------------------------------- reporting

LONDON = {"lat": 51.5074, "lon": -0.1278}


def a_report(**changes):
    """A valid report, with any part of it changed for the test."""
    report = {"sighted_on": "2024-04-01", "species": "Marsh tick", **LONDON}
    report.update(changes)
    return report


def test_a_valid_report_is_saved(api):
    reply = api.post("/api/sightings", json=a_report())

    assert reply.status_code == 201
    body = reply.json()
    assert body["location"] == "London"
    assert body["region"] == "London"
    assert body["warnings"] == []


def test_a_report_is_found_by_the_city_it_was_near(api):
    """A report a few streets from the centre still belongs to that city."""
    api.post("/api/sightings", json=a_report(lat=51.5330, lon=-0.1050))

    assert api.get("/api/sightings?city=London").json()["total"] == 1

    places = api.get("/api/insights/locations").json()["locations"]
    london = [p for p in places if p["location"] == "London"]
    assert len(london) == 1
    assert (london[0]["lat"], london[0]["lon"]) == (51.5074, -0.1278)


def test_the_same_sighting_cannot_be_reported_twice(api):
    api.post("/api/sightings", json=a_report())
    second = api.post("/api/sightings", json=a_report())

    assert second.status_code == 409
    assert second.json()["error"]["code"] == "conflict"


def test_a_date_in_the_future_is_refused(api):
    tomorrow = (date.today() + timedelta(days=1)).isoformat()

    reply = api.post("/api/sightings", json=a_report(sighted_on=tomorrow))

    assert reply.status_code == 422
    fields = reply.json()["error"]["fields"]
    assert fields[0]["field"] == "sighted_on"
    assert "future" in fields[0]["message"]


def test_a_place_outside_the_uk_is_refused(api):
    reply = api.post("/api/sightings", json=a_report(lat=10, lon=10))

    assert reply.status_code == 422
    assert {f["field"] for f in reply.json()["error"]["fields"]} == {"lat", "lon"}


def test_a_missing_date_is_refused(api):
    reply = api.post("/api/sightings", json={"lat": 51.5, "lon": -0.1})

    assert reply.status_code == 422
    assert reply.json()["error"]["fields"][0]["field"] == "sighted_on"


def test_notes_that_are_too_long_are_refused(api):
    reply = api.post("/api/sightings", json=a_report(notes="x" * 501))

    assert reply.status_code == 422


def test_no_species_is_saved_as_unknown_with_a_warning(api):
    reply = api.post("/api/sightings", json=a_report(species="   "))

    assert reply.status_code == 201
    assert reply.json()["species"] == "Unknown"
    assert "Unknown" in reply.json()["warnings"][0]


def test_a_species_typed_in_lower_case_is_counted_with_the_others(loaded):
    loaded.post("/api/sightings", json=a_report(species="marsh tick", sighted_on="2024-04-02"))

    london = [p for p in loaded.get("/api/insights/locations").json()["locations"]
              if p["location"] == "London"][0]
    names = [s["species"] for s in london["species"]]

    assert names.count("Marsh tick") == 1
    assert "marsh tick" not in names


def test_a_very_old_date_is_saved_but_warned_about(api):
    reply = api.post("/api/sightings", json=a_report(sighted_on="1990-01-01"))

    assert reply.status_code == 201
    assert "2012" in reply.json()["warnings"][0]


def test_a_place_far_from_any_city_is_saved_under_other(api):
    reply = api.post("/api/sightings", json=a_report(lat=58.2, lon=-4.5))

    assert reply.status_code == 201
    assert reply.json()["region"] == "Other"
    assert "Other" in reply.json()["warnings"][0]


# ---------------------------------------------------------------- searching

def test_search_filters_by_city(loaded):
    assert loaded.get("/api/sightings?city=London").json()["total"] == 2
    assert loaded.get("/api/sightings?city=Glasgow").json()["total"] == 1


def test_search_ignores_capital_letters(loaded):
    assert loaded.get("/api/sightings?city=LONDON").json()["total"] == 2


def test_search_filters_by_date_range(loaded):
    in_2024 = loaded.get("/api/sightings?date_from=2024-01-01&date_to=2024-12-31").json()

    assert in_2024["total"] == 4
    assert all(s["sighted_on"].startswith("2024") for s in in_2024["items"])


def test_filters_combine(loaded):
    both = loaded.get("/api/sightings?city=London&species=Marsh tick").json()

    assert both["total"] == 2


def test_a_backwards_date_range_is_refused(loaded):
    reply = loaded.get("/api/sightings?date_from=2024-12-31&date_to=2024-01-01")

    assert reply.status_code == 422
    assert reply.json()["error"]["code"] == "validation_error"


def test_asking_for_more_than_the_limit_is_refused(loaded):
    assert loaded.get("/api/sightings?limit=5000").status_code == 422


# ---------------------------------------------------------------- insights

def test_sightings_per_region(loaded):
    body = loaded.get("/api/insights/regions").json()
    counts = {r["region"]: r["count"] for r in body["regions"]}

    assert counts["London"] == 2
    assert counts["Scotland"] == 1
    assert body["total"] == sum(counts.values())


def test_a_region_we_could_not_work_out_is_shown_as_unknown(loaded):
    counts = {r["region"]: r["count"]
              for r in loaded.get("/api/insights/regions").json()["regions"]}

    assert counts["Unknown"] == 1     # the city we don't know


def test_trends_by_month(loaded):
    body = loaded.get("/api/insights/trends?interval=month").json()
    periods = [point["period"] for point in body["points"]]

    assert body["interval"] == "month"
    assert periods == sorted(periods)           # oldest first
    assert "2024-03" in periods


def test_trends_fill_in_the_quiet_months(loaded):
    """A month with nothing in it must appear as zero, not be missing."""
    points = loaded.get("/api/insights/trends?interval=month").json()["points"]
    periods = [point["period"] for point in points]

    assert "2023-08" in periods                 # nothing happened that month
    assert dict(zip(periods, [p["count"] for p in points]))["2023-08"] == 0


def test_trends_by_week(loaded):
    body = loaded.get("/api/insights/trends?interval=week").json()

    assert body["interval"] == "week"
    assert body["total"] == 5


def test_trends_can_be_narrowed_to_one_city(loaded):
    body = loaded.get("/api/insights/trends?interval=month&city=London").json()

    assert body["total"] == 2


def test_an_interval_we_do_not_offer_is_refused(loaded):
    reply = loaded.get("/api/insights/trends?interval=day")

    assert reply.status_code == 422
    assert reply.json()["error"]["fields"][0]["field"] == "interval"


def test_map_data_is_one_row_per_place(loaded):
    body = loaded.get("/api/insights/locations").json()

    names = [p["location"] for p in body["locations"]]
    assert len(names) == len(set(names))                      # no place twice
    assert body["total"] == sum(p["count"] for p in body["locations"])
    for place in body["locations"]:
        assert sum(s["count"] for s in place["species"]) == place["count"]


def test_map_data_leaves_out_sightings_with_no_position(loaded):
    names = [p["location"] for p in loaded.get("/api/insights/locations").json()["locations"]]

    assert "Atlantis" not in names


def test_map_data_can_be_filtered(loaded):
    body = loaded.get("/api/insights/locations?species=Marsh tick").json()

    assert body["total"] == 2
    assert all(s["species"] == "Marsh tick"
               for place in body["locations"] for s in place["species"])


# ---------------------------------------------------------------- error shape

def test_every_error_has_the_same_shape(api):
    replies = [
        api.get("/api/nothing-here"),                                   # 404
        api.get("/api/sightings?limit=0"),                              # 422
        api.post("/api/sightings", json={}),                            # 422
    ]
    for reply in replies:
        body = reply.json()
        assert "error" in body
        assert "code" in body["error"]
        assert "message" in body["error"]


def test_a_body_that_is_not_json_is_handled(api):
    reply = api.post("/api/sightings", content="not json at all",
                     headers={"content-type": "application/json"})

    assert reply.status_code == 422
    assert reply.json()["error"]["code"] == "validation_error"


def test_health_check(api):
    assert api.get("/api/health").json() == {"status": "ok"}


def test_a_form_that_sends_nothing_for_species_is_accepted(api):
    """A dropdown left on "I'm not sure" may send nothing, an empty box or spaces."""
    for day, value in enumerate([None, "", "   "], start=1):
        reply = api.post("/api/sightings",
                         json=a_report(species=value, sighted_on=f"2024-04-0{day}"))

        assert reply.status_code == 201, reply.json()
        assert reply.json()["species"] == "Unknown"
        assert "Unknown" in reply.json()["warnings"][0]
