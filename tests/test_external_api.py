"""Tests for the way we cope when Elanco's API misbehaves."""
import pytest
import requests

from backend import elanco
from backend.elanco import ElancoError, fetch_sightings
from backend.importer import import_elanco


class FakeResponse:
    """Stands in for a reply from Elanco."""

    def __init__(self, status_code, body=None):
        self.status_code = status_code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("not JSON")
        return self._body


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    """Don't actually sleep between retries while testing."""
    monkeypatch.setattr(elanco.time, "sleep", lambda seconds: None)


def replies_with(monkeypatch, *responses):
    """Make Elanco reply with these, one per attempt."""
    queue = list(responses)
    calls = []

    def fake_get(url, timeout=None):
        calls.append(url)
        reply = queue.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(elanco.requests, "get", fake_get)
    return calls


def test_a_server_error_is_retried_and_then_succeeds(monkeypatch):
    calls = replies_with(monkeypatch, FakeResponse(500), FakeResponse(200, [{"id": "1"}]))

    assert fetch_sightings() == [{"id": "1"}]
    assert len(calls) == 2


def test_being_rate_limited_is_retried(monkeypatch):
    calls = replies_with(monkeypatch, FakeResponse(429), FakeResponse(200, []))

    assert fetch_sightings() == []
    assert len(calls) == 2


def test_it_gives_up_after_three_tries(monkeypatch):
    calls = replies_with(monkeypatch, FakeResponse(500), FakeResponse(500), FakeResponse(500))

    with pytest.raises(ElancoError):
        fetch_sightings()
    assert len(calls) == 3


def test_a_wrong_address_is_not_retried(monkeypatch):
    """A 404 won't fix itself, so there is no point asking again."""
    calls = replies_with(monkeypatch, FakeResponse(404))

    with pytest.raises(ElancoError):
        fetch_sightings()
    assert len(calls) == 1


def test_no_internet_raises_our_own_error(monkeypatch):
    replies_with(monkeypatch, requests.ConnectionError("no network"),
                 requests.ConnectionError("no network"),
                 requests.ConnectionError("no network"))

    with pytest.raises(ElancoError):
        fetch_sightings()


def test_a_reply_that_is_not_a_list_is_refused(monkeypatch):
    replies_with(monkeypatch, FakeResponse(200, {"items": []}))

    with pytest.raises(ElancoError):
        fetch_sightings()


def test_the_site_keeps_working_when_elanco_is_down(api, monkeypatch):
    """The most important one: Elanco being down must not take our site down."""
    from backend import importer
    monkeypatch.setattr(importer, "fetch_sightings",
                        lambda: (_ for _ in ()).throw(ElancoError("Elanco is down")))

    summary = import_elanco()

    assert summary["error"] == "Elanco is down"
    assert summary["saved"] == 0
    assert api.get("/api/health").json() == {"status": "ok"}
    assert api.get("/api/sightings").status_code == 200
