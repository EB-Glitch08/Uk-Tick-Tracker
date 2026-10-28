"""Turns every kind of error into the same JSON shape, so the frontend can handle them all one way.

    {"error": {"code": "...", "message": "...", "fields": [{"field": "...", "message": "..."}]}}
"""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("tick-tracker")

# A short, machine-readable code for each status we use.
CODES = {404: "not_found", 409: "conflict", 422: "validation_error"}


def error_response(status_code, code, message, fields=None):
    """Build the standard error reply."""
    body = {"code": code, "message": message}
    if fields:
        body["fields"] = fields
    return JSONResponse(status_code=status_code, content={"error": body})


def register_error_handlers(app: FastAPI):
    """Plug the handlers into the app. Called once from main.py."""

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError):
        # Pydantic gives a technical list. Turn each item into {field, message}.
        fields = []
        for item in exc.errors():
            # loc looks like ("body", "lat") or ("query", "interval"): the last part is the field.
            field = item["loc"][-1] if item["loc"] else "request"
            if not isinstance(field, str):
                field = "request"      # e.g. the body wasn't valid JSON at all
            message = item["msg"].removeprefix("Value error, ")
            fields.append({"field": field, "message": message})
        return error_response(422, "validation_error", "Some of the details are not valid.", fields)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, exc: StarletteHTTPException):
        # Covers our own HTTPException errors and FastAPI's built-in 404 for unknown addresses.
        code = CODES.get(exc.status_code, "http_error")
        return error_response(exc.status_code, code, str(exc.detail))

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception):
        # Log the real problem for us, but don't show technical details to the user.
        logger.exception("Unexpected error on %s %s", request.method, request.url.path)
        return error_response(500, "server_error", "Something went wrong on our side. Please try again.")