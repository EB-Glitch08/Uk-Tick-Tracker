/* ============================================================================
   Sighting detail — one sighting, and what else has been reported around it.

   Reached from the map, from the list, or from a link someone has shared:
   #/sighting/42
   ========================================================================= */

(function () {
  "use strict";

  const T = Tracker;
  const el = T.el, icon = T.icon;

  const NEARBY_KM = 10;

  /* ---- A small map with this sighting marked ------------------------------ */

  function miniMap(sighting, nearby) {
    const data = window.UK_MAP;
    if (!data || !data.project) {
      return el("p", { class: "loading", text: "The map could not be loaded." });
    }

    const here = data.project(sighting.lat, sighting.lon);

    /* Shown close in, around the sighting, rather than the whole country: at
       this zoom the surrounding reports are far enough apart to tell apart. */
    const span = data.width / 3.2;
    const box = {
      x: Math.min(data.width - span, Math.max(0, here.x - span / 2)),
      y: Math.min(data.height - span * 1.25, Math.max(0, here.y - span * 0.625)),
    };

    const picture = T.svg("svg", {
      viewBox: box.x.toFixed(1) + " " + box.y.toFixed(1) + " " +
               span.toFixed(1) + " " + (span * 1.25).toFixed(1),
      class: "uk-map mini-map", role: "img",
      "aria-label": "Map showing this sighting near " +
                    (sighting.location || "an approximate position") +
                    ", with " + nearby.length + " other reports around it.",
    });

    if (data.context) {
      picture.appendChild(T.svg("path", { d: data.context, class: "map-context" }));
    }
    data.areas.forEach(function (area) {
      picture.appendChild(T.svg("path", { d: area.path, class: "map-area", fill: "#dcefe3" }));
    });

    // Everything else in the area, drawn small and quiet.
    nearby.forEach(function (other) {
      if (other.lat === null || other.lon === null) return;
      const at = data.project(other.lat, other.lon);
      picture.appendChild(T.svg("circle", {
        cx: at.x, cy: at.y, r: 3.4, fill: "#6f9fb5", stroke: "#ffffff", "stroke-width": 1.2,
      }));
    });

    // The one being looked at: a ring around it so it stands out.
    picture.appendChild(T.svg("circle", {
      cx: here.x, cy: here.y, r: 11, fill: "none", stroke: "#40dbcc", "stroke-width": 2.4,
    }));
    picture.appendChild(T.svg("circle", {
      cx: here.x, cy: here.y, r: 5.5, fill: "#006fa7", stroke: "#ffffff", "stroke-width": 1.8,
    }));

    const label = T.svg("text", {
      x: here.x, y: here.y + 24, class: "place-label", style: "font-size:7px",
    });
    label.textContent = sighting.location || "This sighting";
    picture.appendChild(label);

    return picture;
  }

  /* ---- The sidebar -------------------------------------------------------- */

  function attribute(label, value, note, iconName) {
    return el("div", { class: "attribute" }, [
      el("p", { class: "attribute-label", text: label }),
      iconName
        ? el("p", { class: "attribute-value with-icon" }, [icon(iconName, "18"), value])
        : el("p", { class: "attribute-value", text: value }),
      note ? el("p", { class: "attribute-note", text: note }) : null,
    ]);
  }

  function verification(sighting) {
    const fromAPerson = sighting.source === "user";
    return el("div", { class: "verification" }, [
      el("span", { class: "chip " + (fromAPerson ? "chip-warn" : "chip-mint") }, [
        icon(fromAPerson ? "clock" : "check", "13"),
        fromAPerson ? "Not reviewed · community report" : "From Elanco's dataset",
      ]),
      el("p", { class: "tiny muted",
                text: fromAPerson
                  ? "The species and what it was found on were supplied by the person " +
                    "reporting it and have not been independently confirmed. This is not a diagnosis."
                  : "Supplied by Elanco's tick sightings API as sample data for this project." }),
    ]);
  }

  /** "2024-04-17" -> "17 Apr 24". The year is kept: without it, entries from
      different years look as though they are in the wrong order. */
  function shortDate(iso) {
    const bits = String(iso).slice(0, 10).split("-");
    return Number(bits[2]) + " " + T.MONTHS[Number(bits[1]) - 1] + " " + bits[0].slice(2);
  }

  function timeline(sighting, nearby) {
    const entries = [{ sighting: sighting, isThisOne: true }].concat(
      nearby.slice(0, 6).map(function (other) {
        return { sighting: other, isThisOne: false };
      })
    ).sort(function (a, b) {
      return a.sighting.sighted_on < b.sighting.sighted_on ? 1 : -1;
    });

    return el("ol", { class: "timeline" }, entries.map(function (entry) {
      const s = entry.sighting;
      const where = entry.isThisOne ? "This sighting"
                  : (s.location ? "Near " + s.location : "Nearby");
      const what = [s.host, s.species].filter(Boolean).join(" · ");

      return el("li", { class: "timeline-entry" + (entry.isThisOne ? " is-this" : "") }, [
        el("span", { class: "timeline-dot", "aria-hidden": "true" }),
        el("span", { class: "timeline-date", text: shortDate(s.sighted_on) }),
        el("span", { class: "timeline-event" }, [
          entry.isThisOne
            ? el("span", { class: "timeline-title", text: where })
            : el("a", { class: "timeline-title", href: "#/sighting/" + s.id, text: where }),
          el("span", { class: "timeline-what", text: what || "Species not given" }),
          s.distance_km !== undefined
            ? el("span", { class: "timeline-what", text: s.distance_km + " km away" })
            : null,
        ]),
      ]);
    }));
  }

  function shareButton(sighting) {
    const link = location.origin + location.pathname + "#/sighting/" + sighting.id;

    return el("button", {
      type: "button", class: "btn-flat",
      onclick: async function (event) {
        const button = event.currentTarget;
        let said = "Link copied";
        try {
          if (navigator.share) {
            await navigator.share({ title: "A tick sighting on the UK Tick Tracker", url: link });
            return;
          }
          await navigator.clipboard.writeText(link);
        } catch (problem) {
          // Copying can be refused, and a share sheet can be dismissed. Show
          // the link instead so it can still be copied by hand.
          said = link;
        }
        const note = button.parentElement.parentElement.querySelector(".share-note");
        if (note) { note.textContent = said; note.hidden = false; }
      },
    }, [icon("share"), "Share"]);
  }

  /* ---- Drawing the whole screen -------------------------------------------- */

  /* As on the map screen: a draw that has been overtaken throws its answer
     away rather than painting over the newer one. */
  let latestDraw = 0;

  async function render(id) {
    const thisDraw = ++latestDraw;
    const view = T.clear(document.getElementById("view-detail"));
    view.appendChild(el("p", { class: "loading", text: "Loading this sighting…" }));

    let sighting, nearby;
    try {
      sighting = await T.api("/api/sightings/" + encodeURIComponent(id));
      nearby = (sighting.lat !== null && sighting.lon !== null)
        ? await T.api("/api/sightings/nearby" + T.query({
            lat: sighting.lat, lon: sighting.lon, within_km: NEARBY_KM,
            exclude_id: sighting.id, limit: 50,
          }))
        : { total: 0, items: [] };
    } catch (problem) {
      if (thisDraw !== latestDraw) return;
      T.clear(view);
      view.appendChild(el("div", { class: "page-head" },
        el("div", {}, [
          el("p", { class: "eyebrow", text: "Explore / sighting detail" }),
          el("h1", { id: "detail-title", text: "Sighting not found" }),
        ])));
      view.appendChild(T.errorPanel(problem));
      view.appendChild(el("p", { style: "margin-top:16px" },
        el("a", { class: "btn btn-quiet", href: "#/explore" }, [icon("back", "14"), "Back to the map"])));
      return;
    }

    if (thisDraw !== latestDraw) return;
    T.clear(view);

    const place = sighting.location || "An unnamed place";
    const latin = T.latinFor(sighting.species);

    view.appendChild(el("div", { class: "page-head" }, [
      el("div", {}, [
        el("p", { class: "eyebrow", text: "Explore / sighting detail" }),
        el("h1", { id: "detail-title", text: "Sighting near " + place }),
        el("p", { class: "lede",
                  text: "One reported sighting and the reports around it. The marker shows an " +
                        "approximate area, not an exact address." }),
      ]),
      el("a", { class: "btn btn-quiet", href: "#/explore" },
         [icon("back", "14"), "Back to all sightings"]),
    ]));

    const body = el("div", { class: "detail-row" });

    /* --- left: the map --- */
    const mapBox = el("div", { class: "map-box" });
    if (sighting.lat !== null && sighting.lon !== null) {
      mapBox.appendChild(el("div", { class: "map-figure" }, miniMap(sighting, nearby.items)));
    } else {
      mapBox.appendChild(el("p", { class: "loading",
        text: "This sighting has no position, so it cannot be shown on the map." }));
    }
    mapBox.appendChild(el("p", { class: "msg msg-ok map-foot" }, [
      icon("leaf", "15"),
      el("span", {}, [
        el("strong", { text: "A place to be aware of, not a place to avoid. " }),
        "Ticks can be present wherever there is suitable habitat. Directions open the " +
        "approximate area only; always use public paths and respect private land.",
      ]),
    ]));

    /* --- right: the details --- */
    const sidebar = el("aside", { class: "card detail-side", "aria-label": "About this sighting" }, [
      el("div", { class: "detail-top" }, [
        el("span", { class: "chip chip-mint" },
           [icon("calendar", "13"), "Reported · " + T.prettyDate(sighting.sighted_on)]),
      ]),

      el("div", { class: "detail-place" }, [
        el("h2", { class: "detail-heading", text: place }),
        el("p", { class: "detail-precision" }, [
          icon("pin", "14"),
          el("span", { text: sighting.precision === "about 1 km"
            ? "Location rounded to about 1 km"
            : "Placed at the city centre" }),
        ]),
      ]),

      el("div", { class: "detail-actions" }, [
        shareButton(sighting),
        el("a", {
          class: "btn-flat", target: "_blank", rel: "noopener",
          href: "https://www.google.com/maps/dir/?api=1&destination=" +
                sighting.lat + "," + sighting.lon,
        }, [icon("directions"), "Get directions"]),
      ]),
      el("p", { class: "share-note tiny muted", hidden: true, role: "status" }),

      el("div", { class: "divider thin" }),

      el("div", { class: "attributes" }, [
        attribute("Reported species", sighting.species, latin),
        sighting.host ? attribute("Found on", sighting.host, null, T.hostIcon(sighting.host)) : null,
      ]),

      verification(sighting),

      sighting.notes
        ? el("div", { class: "reporter-note" }, [
            el("p", { class: "attribute-label", text: "Reporter’s note" }),
            el("p", { class: "note-text", text: "“" + sighting.notes + "”" }),
          ])
        : null,

      sighting.image_path
        ? el("div", { class: "reporter-note" }, [
            el("p", { class: "attribute-label", text: "Photo added by the reporter" }),
            el("img", { class: "report-photo", src: sighting.image_path,
                        alt: "Photograph submitted with this sighting." }),
          ])
        : null,

      el("div", { class: "divider thin" }),

      el("div", { class: "panel-title" }, [
        el("h2", { class: "detail-heading-sm", text: "Nearby activity" }),
        el("span", { class: "panel-note", text: "Within about " + NEARBY_KM + " km" }),
      ]),
      el("p", { class: "tiny muted",
                text: nearby.total
                  ? T.number(nearby.total) + (nearby.total === 1 ? " other report" : " other reports") +
                    " nearby · most recent first"
                  : "Nothing else has been reported within " + NEARBY_KM + " km." }),
      timeline(sighting, nearby.items),

      nearby.total > 6 && sighting.location
        ? el("a", { class: "more-link", href: "#/explore",
                    text: "View all " + T.number(nearby.total) + " nearby reports →" })
        : null,
    ]);

    body.appendChild(mapBox);
    body.appendChild(sidebar);
    view.appendChild(body);
  }

  T.register("detail", { show: function (id) { render(id); } });
})();
