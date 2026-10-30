"""Tests for the first requirement: consuming and processing Elanco's data.

These cover large datasets, duplicates and incomplete data.
"""
from backend.cleaning import clean_record
from backend.importer import import_elanco


def test_import_counts_everything_it_did(api):
    """The import reports exactly what happened to each record."""
    summary = import_elanco()

    assert summary["fetched"] == 8
    assert summary["saved"] == 5        # 8 minus one repeat and two bad dates
    assert summary["duplicates"] == 1   # record 4 repeats record 1
    assert summary["rejected"] == 2     # no date, and a date in the future
    assert summary["incomplete"] == 1   # the city we don't know
    assert summary["error"] is None


def test_importing_twice_adds_nothing(api):
    """Elanco's data is fetched on every start, so this must be safe to repeat."""
    import_elanco()
    second = import_elanco()

    assert second["saved"] == 0
    # The 5 we already hold, plus the repeat inside Elanco's own data.
    assert second["duplicates"] == 6


def test_a_record_with_no_date_is_rejected_with_a_reason(api):
    summary = import_elanco()
    reasons = " ".join(summary["rejected_examples"])

    assert "date" in reasons


def test_an_unknown_city_is_kept_but_stays_off_the_map(loaded):
    """Incomplete data is not thrown away, it is flagged instead."""
    everything = loaded.get("/api/sightings").json()
    atlantis = [s for s in everything["items"] if s["location"] == "Atlantis"][0]

    assert atlantis["is_complete"] == 0
    assert atlantis["lat"] is None

    on_the_map = loaded.get("/api/sightings?on_map_only=true").json()
    assert all(s["location"] != "Atlantis" for s in on_the_map["items"])


def test_odd_capitals_in_a_city_name_are_tidied(loaded):
    """"london" and "London" must not become two different places."""
    places = loaded.get("/api/insights/locations").json()["locations"]
    names = [p["location"] for p in places]

    assert names.count("London") == 1


def test_a_date_with_a_time_zone_does_not_stop_the_import(loaded):
    """One oddly written date should cost us that record at most, not the rest."""
    cardiff = loaded.get("/api/sightings?city=Cardiff").json()

    assert cardiff["total"] == 1


def test_dates_are_read_whichever_way_they_are_written():
    written_differently = [
        "2024-01-02T10:00:00",
        "2024-01-02T10:00:00Z",
        "2024-01-02T10:00:00+01:00",
        "2024-01-02",
    ]
    for value in written_differently:
        record = clean_record({"date": value, "species": "Marsh tick", "location": "London"})
        assert record["sighted_on"] == "2024-01-02"


def test_one_unusable_record_cannot_stop_the_others(api, monkeypatch):
    """A record of a shape we never expected is skipped, not fatal."""
    from backend import importer
    monkeypatch.setattr(importer, "fetch_sightings", lambda: [
        "this is not a record at all",
        {"date": "2024-01-01T00:00:00", "species": "Marsh tick", "location": "Leeds"},
    ])

    summary = import_elanco()

    assert summary["saved"] == 1
    assert summary["rejected"] == 1


def test_paging_lets_the_frontend_take_large_data_a_piece_at_a_time(loaded):
    first = loaded.get("/api/sightings?limit=2&offset=0").json()
    second = loaded.get("/api/sightings?limit=2&offset=2").json()

    assert first["total"] == second["total"]          # the total never changes
    assert len(first["items"]) == 2
    first_ids = {s["id"] for s in first["items"]}
    second_ids = {s["id"] for s in second["items"]}
    assert first_ids.isdisjoint(second_ids)           # no sighting appears twice
