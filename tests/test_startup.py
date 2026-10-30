"""Tests for what happens when the server starts."""
import time

from fastapi.testclient import TestClient

from backend import db, importer, main
from tests.conftest import FAKE_ELANCO


def test_starting_the_server_imports_elancos_data(tmp_path, monkeypatch):
    """A fresh copy of the project fills itself with data on the first run."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(importer, "fetch_sightings", lambda: list(FAKE_ELANCO))

    with TestClient(main.app) as client:
        # The import runs in the background, so give it a moment to finish.
        for _ in range(50):
            if client.get("/api/sightings").json()["total"] > 0:
                break
            time.sleep(0.1)

        assert client.get("/api/sightings").json()["total"] == 5


def test_the_server_still_starts_when_elanco_is_down(tmp_path, monkeypatch):
    """The site must open even with no data and no Elanco."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")

    def elanco_is_down():
        raise importer.ElancoError("could not reach Elanco")

    monkeypatch.setattr(importer, "fetch_sightings", elanco_is_down)

    with TestClient(main.app) as client:
        assert client.get("/api/health").json() == {"status": "ok"}
        assert client.get("/api/sightings").json()["total"] == 0
        assert client.get("/api/insights/locations").json()["locations"] == []


def test_a_report_can_be_saved_while_the_import_is_running(tmp_path, monkeypatch):
    """Someone using the site during a data refresh must not be turned away."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")

    slow = list(FAKE_ELANCO)

    def slow_elanco():
        time.sleep(0.5)      # pretend Elanco is slow to answer
        return slow

    monkeypatch.setattr(importer, "fetch_sightings", slow_elanco)

    with TestClient(main.app) as client:
        reply = client.post("/api/sightings", json={
            "sighted_on": "2024-04-01", "lat": 51.5074, "lon": -0.1278,
            "species": "Marsh tick",
        })

        assert reply.status_code == 201


def test_restarting_soon_after_does_not_ask_elanco_again(tmp_path, monkeypatch):
    """Elanco limits how often it can be called, and the server reloads on every
    code change while developing. Data that is already fresh is left alone."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")

    calls = []

    def counted():
        calls.append(1)
        return list(FAKE_ELANCO)

    monkeypatch.setattr(importer, "fetch_sightings", counted)

    for _ in range(3):
        with TestClient(main.app) as client:
            for _ in range(50):
                if client.get("/api/sightings").json()["total"] > 0:
                    break
                time.sleep(0.1)

    assert len(calls) == 1


def test_stale_data_is_refreshed(tmp_path, monkeypatch):
    """Once the data is old enough, the next start fetches it again."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(importer, "fetch_sightings", lambda: list(FAKE_ELANCO))
    monkeypatch.setattr(importer, "FRESH_FOR_MINUTES", 0)   # nothing counts as fresh

    calls = []
    real_import = importer.import_elanco
    monkeypatch.setattr(importer, "import_elanco",
                        lambda: (calls.append(1), real_import())[1])

    for _ in range(2):
        with TestClient(main.app) as client:
            for _ in range(50):
                if client.get("/api/sightings").json()["total"] > 0:
                    break
                time.sleep(0.1)

    assert len(calls) == 2
