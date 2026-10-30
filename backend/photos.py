"""Letting someone add a photograph to the sighting they reported.

A photograph is useful evidence, but a file arriving from the internet is the
least trustworthy thing this application handles, so every part of it is
checked before anything is written to disk:

- the file must really be a JPEG or a PNG, judged by the bytes themselves and
  not by what the browser claims it is;
- it must be no larger than the limit, counted as it arrives rather than
  trusting a size the browser reports;
- the name it is saved under is one we make up, never the one it arrived with,
  so a name like "../../passwords" can't lead anywhere.
"""
import re
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from backend import db
from backend.db import get_connection

router = APIRouter()


def upload_dir():
    """The folder photographs live in, beside the database.

    This is worked out when it is needed rather than once at the start, so that
    the tests, which use a database of their own, keep their photographs with it
    instead of among the real ones.
    """
    return db.DB_PATH.parent / "uploads"

MAX_BYTES = 10 * 1024 * 1024        # 10 MB, as the form promises
CHUNK = 64 * 1024                   # read the file 64 KB at a time

# The first few bytes of a file say what it really is. These are the two we accept.
SIGNATURES = {
    b"\xff\xd8\xff": ".jpg",                            # JPEG
    b"\x89PNG\r\n\x1a\n": ".png",                       # PNG
}


def extension_for(first_bytes):
    """The file extension if these opening bytes are an image we accept."""
    for signature, extension in SIGNATURES.items():
        if first_bytes.startswith(signature):
            return extension
    return None


@router.post("/api/sightings/{sighting_id}/photo", status_code=201)
async def add_photo(sighting_id: int, photo: UploadFile = File(...)):
    """Attach a photograph to a sighting that has already been reported."""
    conn = get_connection()
    try:
        exists = conn.execute(
            "SELECT id FROM sightings WHERE id = ?", (sighting_id,)
        ).fetchone()
    finally:
        conn.close()

    if exists is None:
        raise HTTPException(status_code=404, detail="That sighting could not be found.")

    # Read the opening bytes first, so a file that isn't an image is turned away
    # before any of it is written to disk.
    first = await photo.read(len(max(SIGNATURES, key=len)))
    extension = extension_for(first)
    if extension is None:
        raise HTTPException(status_code=422, detail="The photo must be a JPG or PNG image.")

    folder = upload_dir()
    folder.mkdir(parents=True, exist_ok=True)
    saved_as = f"{uuid.uuid4().hex}{extension}"         # our name, not theirs
    destination = folder / saved_as

    written = len(first)
    try:
        with open(destination, "wb") as out:
            out.write(first)
            while True:
                chunk = await photo.read(CHUNK)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_BYTES:
                    raise HTTPException(status_code=413,
                                        detail="The photo must be 10 MB or smaller.")
                out.write(chunk)
    except Exception:
        # Don't leave half a file behind if anything went wrong.
        destination.unlink(missing_ok=True)
        raise

    image_path = f"/uploads/{saved_as}"
    conn = get_connection()
    try:
        conn.execute("UPDATE sightings SET image_path = ? WHERE id = ?",
                     (image_path, sighting_id))
        conn.commit()
    finally:
        conn.close()

    return {"id": sighting_id, "image_path": image_path, "bytes": written,
            "message": "Photo added."}


# A name we made ourselves: 32 hex characters and one of our two extensions.
SAFE_NAME = re.compile(r"^[0-9a-f]{32}\.(jpg|png)$")

CONTENT_TYPES = {".jpg": "image/jpeg", ".png": "image/png"}


@router.get("/uploads/{filename}")
def get_photo(filename: str):
    """Serve a photograph someone added to a sighting.

    Only names of the exact shape we hand out are served. Anything else is a
    404, so no request can wander out of this folder into the rest of the disk.
    """
    if not SAFE_NAME.match(filename):
        raise HTTPException(status_code=404, detail="That photo could not be found.")

    path = upload_dir() / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="That photo could not be found.")

    return FileResponse(path, media_type=CONTENT_TYPES[path.suffix])
