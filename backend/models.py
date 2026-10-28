"""What a user's sighting report looks like, and the rules it must pass.

Pydantic checks the data automatically when the form is sent to our API.
If a rule fails, FastAPI replies with an error saying which field was wrong.
"""
from datetime import date
from typing import Optional
from pydantic import BaseModel, Field, field_validator


class SightingIn(BaseModel):
    """A new sighting, exactly as the report form sends it."""

    sighted_on: date                                   # the day the tick was seen
    # Rough box around the UK. Anything outside it is rejected.
    lat: float = Field(ge=49.8, le=60.9)               # latitude: south to north
    lon: float = Field(ge=-8.7, le=1.8)                # longitude: west to east
    location: Optional[str] = Field(default=None, max_length=100)   # optional place name
    species: str = Field(default="Unknown", max_length=100)         # "Unknown" if they can't tell
    notes: Optional[str] = Field(default=None, max_length=500)      # optional free text

    @field_validator("sighted_on")
    @classmethod
    def not_in_future(cls, value):
        """A tick can't have been seen tomorrow."""
        if value > date.today():
            raise ValueError("The date can't be in the future.")
        return value
