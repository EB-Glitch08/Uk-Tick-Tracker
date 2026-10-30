"""Tests for adding a photograph to a sighting.

An uploaded file is the least trustworthy thing the application handles, so
these tests are mostly about what happens when the file is wrong.
"""
import struct
import zlib

from backend.photos import upload_dir


def a_real_png(width=4, height=4):
    """The bytes of a genuine, very small PNG."""
    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    rows = b"".join(b"\x00" + b"\xff\x00\x00" * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


A_REAL_JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 200 + b"\xff\xd9"


def a_sighting(api):
    return api.post("/api/sightings", json={
        "sighted_on": "2024-04-01", "lat": 51.5074, "lon": -0.1278,
        "species": "Marsh tick",
    }).json()["id"]


def test_a_photo_can_be_added_to_a_sighting(api):
    sighting_id = a_sighting(api)

    reply = api.post(f"/api/sightings/{sighting_id}/photo",
                     files={"photo": ("tick.png", a_real_png(), "image/png")})

    assert reply.status_code == 201
    body = reply.json()
    assert body["image_path"].startswith("/uploads/")
    assert body["image_path"].endswith(".png")

    # and the sighting now points at it
    assert api.get(f"/api/sightings/{sighting_id}").json()["image_path"] == body["image_path"]


def test_the_photo_can_then_be_fetched(api):
    sighting_id = a_sighting(api)
    path = api.post(f"/api/sightings/{sighting_id}/photo",
                    files={"photo": ("tick.png", a_real_png(), "image/png")}).json()["image_path"]

    served = api.get(path)

    assert served.status_code == 200
    assert served.content.startswith(b"\x89PNG")


def test_a_jpeg_is_accepted_too(api):
    sighting_id = a_sighting(api)

    reply = api.post(f"/api/sightings/{sighting_id}/photo",
                     files={"photo": ("tick.jpg", A_REAL_JPEG, "image/jpeg")})

    assert reply.status_code == 201
    assert reply.json()["image_path"].endswith(".jpg")


def test_a_file_that_is_not_an_image_is_refused(api):
    sighting_id = a_sighting(api)

    reply = api.post(f"/api/sightings/{sighting_id}/photo",
                     files={"photo": ("notes.txt", b"just some text", "text/plain")})

    assert reply.status_code == 422
    assert "JPG or PNG" in reply.json()["error"]["message"]


def test_a_file_pretending_to_be_an_image_is_refused(api):
    """The browser can claim anything, so the bytes decide, not the label."""
    sighting_id = a_sighting(api)

    reply = api.post(f"/api/sightings/{sighting_id}/photo",
                     files={"photo": ("sneaky.png", b"MZ\x90\x00 this is a program",
                                      "image/png")})

    assert reply.status_code == 422


def test_a_refused_file_is_not_written_to_disk(api):
    sighting_id = a_sighting(api)
    before = set(upload_dir().glob("*")) if upload_dir().exists() else set()

    api.post(f"/api/sightings/{sighting_id}/photo",
             files={"photo": ("sneaky.png", b"not an image at all", "image/png")})

    after = set(upload_dir().glob("*")) if upload_dir().exists() else set()
    assert after == before


def test_a_photo_that_is_too_big_is_refused(api, monkeypatch):
    from backend import photos
    monkeypatch.setattr(photos, "MAX_BYTES", 500)       # pretend the limit is tiny
    sighting_id = a_sighting(api)

    reply = api.post(f"/api/sightings/{sighting_id}/photo",
                     files={"photo": ("big.png", a_real_png(200, 200), "image/png")})

    assert reply.status_code == 413
    assert "10 MB" in reply.json()["error"]["message"] or "smaller" in reply.json()["error"]["message"]


def test_the_name_the_file_arrived_with_is_never_used(api):
    """A name like this must not decide where the file is written."""
    sighting_id = a_sighting(api)

    path = api.post(
        f"/api/sightings/{sighting_id}/photo",
        files={"photo": ("../../escaped.png", a_real_png(), "image/png")},
    ).json()["image_path"]

    assert ".." not in path
    assert "escaped" not in path


def test_a_photo_for_a_sighting_that_does_not_exist_is_refused(api):
    reply = api.post("/api/sightings/999999/photo",
                     files={"photo": ("tick.png", a_real_png(), "image/png")})

    assert reply.status_code == 404


def test_a_report_with_no_photo_is_perfectly_normal(api):
    sighting_id = a_sighting(api)

    assert api.get(f"/api/sightings/{sighting_id}").json()["image_path"] is None


def test_a_made_up_photo_name_is_not_served(api):
    """Only names of the shape we hand out are served."""
    for name in ["../../backend/main.py", "..%2F..%2Fsecret", "anything.png", "notes.txt"]:
        assert api.get(f"/uploads/{name}").status_code == 404


def test_photos_are_kept_with_the_database_they_belong_to(api, tmp_path):
    """The test database is in a folder of its own, and so are its photos."""
    from backend.photos import upload_dir

    assert upload_dir().parent == tmp_path
