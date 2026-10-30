"""Shared setup for the tests.

Every test runs against a fresh, empty database in a temporary folder, and
against a pretend version of Elanco's API, so the tests are quick, repeatable
and never touch the real data or the real service.
"""
import sys
from pathlib import Path

import pytest

# Make sure "backend" can be imported when pytest is run from the project folder.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import db  # noqa: E402


# A small set of records shaped exactly like Elanco's, including the awkward
# ones: a city we don't know, a missing date, a date in the future and a repeat.
FAKE_ELANCO = [
    {"id": "1", "date": "2024-03-01T08:00:00", "species": "Marsh tick",
     "latinName": "Ixodes apronophorus", "location": "London"},
    {"id": "2", "date": "2024-03-02T09:30:00", "species": "Marsh tick",
     "latinName": "Ixodes apronophorus", "location": "london"},      # odd capitals
    {"id": "3", "date": "2023-07-15T12:00:00", "species": "Tree-hole tick",
     "latinName": "Ixodes arboricola", "location": "Glasgow"},
    {"id": "4", "date": "2024-03-01T08:00:00", "species": "Marsh tick",
     "latinName": "Ixodes apronophorus", "location": "London"},      # exact repeat of 1
    {"id": "5", "date": "2024-05-05T10:00:00", "species": "Passerine tick",
     "latinName": "Dermacentor frontalis", "location": "Atlantis"},  # city we don't know
    {"id": "6", "date": None, "species": "Marsh tick", "location": "Leeds"},  # no date
    {"id": "7", "date": "2099-01-01T00:00:00", "species": "Marsh tick",
     "location": "Leeds"},                                           # in the future
    {"id": "8", "date": "2024-06-01T06:00:00Z", "species": "Fox/badger tick",
     "latinName": "Ixodes canisuga", "location": "Cardiff"},         # carries a time zone
]


@pytest.fixture
def api(tmp_path, monkeypatch):
    """A test client for the website, with an empty database and a fake Elanco.

    The real server imports Elanco's data as it starts. Here that is switched
    off, so each test begins with nothing and decides for itself what to load.
    The start-up import has a test of its own in test_startup.py.
    """
    from fastapi.testclient import TestClient

    # Point the database at a brand new file for this test only.
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")

    # Answer the Elanco call with our own records instead of going online.
    from backend import importer
    monkeypatch.setattr(importer, "fetch_sightings", lambda: list(FAKE_ELANCO))

    from backend import main
    monkeypatch.setattr(main, "import_in_background", lambda: None)

    with TestClient(main.app) as client:
        yield client


@pytest.fixture
def loaded(api):
    """The same client, with the fake Elanco data already imported."""
    from backend.importer import import_elanco
    import_elanco()
    return api
