# UK Tick Tracker — architecture decisions

Emmanuel Boachie · Elanco placement technical task

A working MVP: a FastAPI application with a SQLite database and a plain HTML,
CSS and JavaScript front end, run by uvicorn. This note explains how it is put
together, why, and what I would change with longer.

## 1. The shape of the system

Elanco's API is the upstream supplier. Our SQLite database is a local copy of
it, plus the sightings people report here. For everything to do with sightings,
our FastAPI application is the only thing the browser talks to.

There is one deliberate exception. The report form turns a postcode into
coordinates by calling `api.postcodes.io` from the browser, so that lookup does
not pass through our server. It is a public, free service that needs no key, it
is not on the path for anything else, and the form falls back to a list of
places when it cannot be reached. Putting it behind our own endpoint would be
tidier, and is listed under section 9.

```
   +---------------------------+
   |  Elanco sample data API   |   read-only, rate limited (429)
   |  /data/tick-sightings     |
   +------------+--------------+
                | HTTPS, retried with backoff
                v
   +---------------------------+
   |  importer (elanco.py,     |   fetch -> clean -> insert
   |  cleaning.py, importer.py)|   background thread, at startup
   +------------+--------------+
                |
                v
   +---------------------------+
   |  SQLite  (data/ticks.db)  |   one `sightings` table, holding
   |  source = 'elanco'        |   both sources; indexes, WAL,
   |  source = 'user'          |   UNIQUE dedupe_key
   +------------+--------------+
         ^           |
         |           v
         |   +----------------------------------------+
         |   |  FastAPI endpoints                     |
         |   |  /api/sightings, /{id}, /nearby        |
         |   |  /api/places, /api/health              |
         |   |  /api/insights/locations | regions     |
         |   |  /api/insights/trends                  |
         |   +------------------+---------------------+
         |                      |  JSON
         |                      v
         |   +----------------------------------------+
         |   |  Browser: index.html + 5 JS files,     |
         |   |  served as static files by the same    |
         |   |  FastAPI app (StaticFiles on "/")      |
         |   +------------------+---------------------+
         |                      |
         +----------------------+
           POST /api/sightings            (the report form writing back in)
           POST /api/sightings/{id}/photo
```

The alternative was to let the browser call Elanco directly. I chose not to for
four reasons: the page needs Elanco's records and our own reports in one answer,
and only something holding both can combine them; filtering and counting belong
on the server, close to the data; if Elanco is down our own copy keeps working
where a browser calling it directly would show an empty page; and Elanco rate
limits with HTTP 429, so one server fetching once is kinder than every visitor
fetching for themselves.

## 2. How the data is consumed

The import runs in a background thread started in the FastAPI lifespan hook
(`main.py`), not inline, so the site answers requests immediately even if
Elanco takes fifteen seconds or never answers. It runs on every start, not only
the first, so new upstream records are picked up; re-running is safe because
duplicates are blocked by the database. The data counts as fresh for fifteen
minutes (`FRESH_FOR_MINUTES`), because a development server reloads on every
file save and refetching a thousand records each time would earn a 429.

`elanco.py` retries up to three times. Timeouts, connection failures and 5xx
replies get a short pause that lengthens each attempt; a 429 waits sixty
seconds, as Elanco asks. A 404 is not retried, because it will not fix itself.
If all three attempts fail, the importer catches the error, puts it in the
summary it returns and logs a warning, so the site carries on with the data it
already holds.

## 3. How the data is cleaned and made trustworthy

`cleaning.py` turns one raw record into one storable row. City names are
title-cased, so `"london "` and `"London"` do not become two places, then
looked up in `cities.py` for coordinates and a region, since Elanco gives a
city name but no position.

A record with no readable date, or a date in the future, is rejected, because
without a date a sighting cannot appear on a timeline or a trend. Rejections
are counted with up to five example reasons, so the import reports what it
threw away. A record whose city we do not recognise is kept but flagged
`is_complete = 0`, which holds it off the map while leaving it in the totals
and the searchable list. Losing a real sighting to a short city list seemed
worse than showing it without a position.

Duplicates are stopped by a `UNIQUE` constraint on `dedupe_key`, so the
database enforces the rule rather than our remembering to check. The two
sources need different keys. An Elanco record carries a full timestamp, so its
key uses that timestamp, the species and the city, which identifies it exactly.
A person's report has no time, and two people describing the same tick will not
give identical coordinates, so its key uses the day, the species and the
coordinates rounded to about 100 metres — tight enough to admit a genuine
second sighting, loose enough to catch a double submission.

## 4. How the data is presented

The map does not download the sightings. `GET /api/insights/locations` groups
in SQL and returns one row per place with its total, species breakdown and most
recent date. That is the answer to handling large datasets: the response size
depends on the number of places, not the number of records, so it stays small
whether the table holds a thousand rows or a million. `/api/insights/regions`
and `/api/insights/trends` work the same way.

Where rows are genuinely needed, `/api/sightings` pages them with `limit`
(capped at 500) and `offset`, returning the matching `total` so the front end
can say how much it is not showing. Indexes cover the filter columns — date,
location, species, region — plus a combined index on
`(is_complete, sighted_on)` for the map. The one query that cannot be done in
SQL is `/api/sightings/nearby`, since SQLite has no spatial function, so SQL
cuts out a bounding box and only those rows are measured in Python.

## 5. Error handling

Every failure leaves the API in the same shape:

```json
{"error": {"code": "...", "message": "...", "fields": [{"field": "...", "message": "..."}]}}
```

`errors.py` registers three handlers: one for Pydantic's
`RequestValidationError`, one for `HTTPException`, and a catch-all. The front
end therefore has one way to read any problem, and `app.js` handles them all in
a single `api()` function.

Validation is Pydantic (`models.py`): the date must not be in the future,
latitude and longitude must sit in a box around the UK, and the text fields
have length limits. A failed rule becomes a 422 naming the field, so the form
can put the message beside the right input. A missing sighting or photo is a
404, a repeated report a 409 raised when the `UNIQUE` constraint fires, and an
unexpected error is logged in full but returned as a 500 that gives nothing
technical away.

## 6. Privacy

Someone reporting a tick usually does it where they found it, which may be
their home or a walk they take often. The report is stored exactly as given,
because the precise position is what makes the data worth holding, but
`public_view()` in `helpers.py` rounds it to two decimal places, about a
kilometre, on the way out and labels it `"about 1 km"`. Elanco's records sit on
a city centre and describe nobody in particular, so they are served untouched
and labelled `"city centre"`.

## 7. Front-end structure

There is no build step and nothing to install: `index.html` loads five plain
scripts in order. For an MVP that is a deliberate trade — a reviewer can open
the folder and read it, the FastAPI app serves it with one `StaticFiles` mount,
and there is no toolchain to go stale. One script owns one screen, so no file
becomes unmanageable, and `app.js` holds the shared `Tracker` object: the API
wrapper, an element builder, formatting, the species and city lists, and the
router. Routing is by URL hash (`#/explore`, `#/sighting/42`), so every screen
can be linked to and shared with no server-side routing.

The map is a hand-drawn inline SVG outline of Great Britain with a fixed
projection, shared by the explore and detail screens. A mapping library would
have meant a third-party script, tiles from someone else's server and a
dependency to keep current, for a map that only ever shows fourteen cities.

## 8. Testing

There are 83 tests, run with pytest. They use a fake Elanco and a fresh
temporary database per test, so the suite is fast, needs no network and never
touches the real service. `test_data_handling.py` covers the import counts,
re-importing safely, odd capitals, unknown cities, date formats and paging;
`test_endpoints.py` reporting, validation, filters, insight endpoints and the
error shape; `test_external_api.py` retries, 429, giving up and the site
staying up when Elanco is down; `test_detail_and_nearby.py` the detail
endpoint, nearby search, region grouping and privacy rounding; `test_photos.py`
a real image accepted, a fake one refused, the size cap and the invented
filename; and `test_startup.py` the background import, the freshness window and
a report saved mid-import. GitHub Actions runs the suite on every push and pull
request, on Python 3.11 and 3.13.

## 9. What I would change with more time

- Replace the hand-drawn outline with real boundary data, so the coastline is
  accurate and Northern Ireland and the islands appear.
- `nearest_city` claims any sighting within 150 km, which is too generous: a
  sighting in the Highlands is attached to Edinburgh, and Northern Ireland is
  excluded because no city there is listed. Real boundaries would place a
  sighting properly instead of guessing.
- The filter-building logic is duplicated — `search.py` builds its own `WHERE`
  clause and `insights.py` has `build_where` doing nearly the same thing. They
  should be one shared helper.
- SQLite and a background thread suit one process. Several servers would need a
  real database such as PostgreSQL, and the import moved to a scheduled job so
  it runs once rather than once per server.
- There is no authentication and no moderation: anyone can post a report and
  nobody reviews it. A real version needs accounts, rate limiting and a way to
  reject a bad report.
- Photos go to local disk, so a second server or a lost volume loses them. They
  belong in object storage, with the database holding only the key.
- The trends chart begins at the first month with data rather than at the start
  of the requested range, so a filtered range can look narrower than it is.
  `fill_gaps` should pad out to the requested `date_from` and `date_to`.
- The postcode lookup runs from the browser against `api.postcodes.io`. Moving
  it behind our own endpoint would keep every outside call in one place, let the
  answers be cached, and stop the site depending on a third party the browser
  may not be able to reach.
