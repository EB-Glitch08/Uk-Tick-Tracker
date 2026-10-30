/* ============================================================================
   Explore sightings — the map screen.

   It asks the API for the places with sightings, the totals per area and the
   activity over time, then draws them. Everything on screen comes from the
   API: nothing here is hard-coded sample data.
   ========================================================================= */

(function () {
  "use strict";

  const T = Tracker;
  const el = T.el, icon = T.icon;

  const SPECIES = T.SPECIES;
  const CITIES = T.CITIES;

  /* The colours a cluster can take, from fewest reports to most. They differ
     in lightness as well as hue, so they can still be told apart by someone
     who doesn't see colour in the usual way. */
  const BAND_COLOURS = ["#1b4f9c", "#0f8f84", "#4e8f3b", "#b9810f", "#c9472f", "#a11360"];

  /** A round number near the one given: 1, 2, 5, 10, 20, 25, 50, 100 and so on. */
  function roundStep(rough) {
    const power = Math.pow(10, Math.floor(Math.log10(Math.max(1, rough))));
    const steps = [1, 2, 2.5, 5, 10];
    for (let i = 0; i < steps.length; i++) {
      if (rough <= steps[i] * power) return Math.max(1, Math.round(steps[i] * power));
    }
    return Math.max(1, Math.round(10 * power));
  }

  /* The bands are worked out from the sightings actually on screen rather than
     fixed in advance. With every filter removed a city holds dozens of records,
     while a single month might hold two or three; fixed bands would colour
     every circle the same in one case and leave five colours unused in the
     other. */
  function makeBands(places) {
    const highest = places.reduce(function (most, p) { return Math.max(most, p.count); }, 1);
    const step = roundStep(highest / BAND_COLOURS.length);

    return BAND_COLOURS.map(function (colour, index) {
      const from = index * step + 1;
      const to = index === BAND_COLOURS.length - 1 ? Infinity : (index + 1) * step;
      const range = to === Infinity ? from + "+ reports" :
                    (from === to ? from + " report" + (from === 1 ? "" : "s")
                                 : from + "–" + to + " reports");
      return {
        from: from, upTo: to, colour: colour,
        label: range + (index === 0 ? " · fewest"
                      : index === BAND_COLOURS.length - 1 ? " · most" : ""),
      };
    });
  }

  function bandFor(bands, count) {
    for (let i = 0; i < bands.length; i++) if (count <= bands[i].upTo) return bands[i];
    return bands[bands.length - 1];
  }

  /* The map itself is drawn by map.js, from the real boundary data in
     uk-map-data.js. This screen only decides what to put on it. */

  /* ---- What the user has chosen ------------------------------------------- */

  const EARLIEST = "2012-01-01";
  const filters = { from: "", to: "", city: "", species: "", view: "map", place: null };

  function chosenInterval() {
    if (!filters.from || !filters.to) return "month";
    const days = (new Date(filters.to) - new Date(filters.from)) / 86400000;
    return days <= 120 ? "week" : "month";
  }

  async function loadEverything() {
    const common = { date_from: filters.from || null, date_to: filters.to || null,
                     species: filters.species || null };
    const withCity = Object.assign({}, common, { city: filters.city || null });

    // Asked for together rather than one after another, so the screen fills in
    // one go instead of in four steps.
    const answers = await Promise.all([
      T.api("/api/insights/locations" + T.query(common)),
      T.api("/api/insights/regions" + T.query(common)),
      T.api("/api/insights/trends" + T.query(
        Object.assign({ interval: chosenInterval() }, withCity))),
      T.api("/api/sightings" + T.query(Object.assign({ limit: 50 }, withCity))),
    ]);
    return { places: answers[0], regions: answers[1], trend: answers[2], listed: answers[3] };
  }

  /* ---- The filter bar ------------------------------------------------------ */

  const DATE_PRESETS = [
    { id: "all",    label: "All dates", from: "", to: "" },
    { id: "2024",   label: "2024", from: "2024-01-01", to: "2024-12-31" },
    { id: "2023",   label: "2023", from: "2023-01-01", to: "2023-12-31" },
    { id: "2022",   label: "2022", from: "2022-01-01", to: "2022-12-31" },
    { id: "recent", label: "The last three months of data", from: "2024-10-01", to: "2024-12-31" },
    { id: "custom", label: "Choose exact dates…" },
  ];

  function currentPreset() {
    const found = DATE_PRESETS.filter(function (p) {
      return p.id !== "custom" && p.from === filters.from && p.to === filters.to;
    })[0];
    return found ? found.id : "custom";
  }

  function filterBar(onChange) {
    const preset = currentPreset();

    const dateChoice = el("select", {
      id: "f-dates", class: "field",
      onchange: function (event) {
        const chosen = DATE_PRESETS.filter(function (p) { return p.id === event.target.value; })[0];
        if (chosen.id === "custom") {
          filters.from = filters.from || EARLIEST;
          filters.to = filters.to || "2024-12-31";
        } else {
          filters.from = chosen.from;
          filters.to = chosen.to;
        }
        onChange();
      },
    }, DATE_PRESETS.map(function (p) {
      return el("option", { value: p.id, selected: p.id === preset, text: p.label });
    }));

    const exactDates = el("div", { class: "field-pair", hidden: preset !== "custom" }, [
      el("label", { class: "sr-only", for: "f-from", text: "Earliest date" }),
      el("input", { type: "date", id: "f-from", class: "field", value: filters.from, min: EARLIEST,
                    onchange: function (e) { filters.from = e.target.value; onChange(); } }),
      el("span", { class: "tiny muted", text: "to" }),
      el("label", { class: "sr-only", for: "f-to", text: "Latest date" }),
      el("input", { type: "date", id: "f-to", class: "field", value: filters.to, min: EARLIEST,
                    onchange: function (e) { filters.to = e.target.value; onChange(); } }),
    ]);

    const place = el("input", {
      id: "f-city", class: "field", type: "text", list: "city-list",
      placeholder: "All United Kingdom", value: filters.city, autocomplete: "off",
      "aria-describedby": "f-city-help",
      onchange: function (event) {
        const typed = event.target.value.trim();
        const match = CITIES.filter(function (c) {
          return c.toLowerCase() === typed.toLowerCase();
        })[0];
        filters.city = match || "";
        filters.place = match || null;
        event.target.value = match || "";
        onChange();
      },
    });

    const speciesChoice = el("select", {
      id: "f-species", class: "field",
      onchange: function (e) { filters.species = e.target.value; onChange(); },
    }, [el("option", { value: "", text: "All species, including unsure" })]
      .concat(SPECIES.map(function (s) {
        return el("option", { value: s.name, selected: filters.species === s.name, text: s.name });
      }))
      .concat([el("option", { value: "Unknown", selected: filters.species === "Unknown",
                              text: "Unknown · species not given" })]));

    return el("form", { class: "filters", "aria-label": "Filter the sightings",
                        onsubmit: function (e) { e.preventDefault(); } }, [
      el("div", { class: "filter filter-dates" }, [
        el("label", { class: "filter-label", for: "f-dates", text: "Date range" }),
        dateChoice, exactDates,
      ]),
      el("div", { class: "filter filter-place" }, [
        el("label", { class: "filter-label", for: "f-city", text: "Location" }),
        el("div", { class: "field-with-icon" }, [place, icon("search", "14")]),
        el("datalist", { id: "city-list" }, CITIES.map(function (c) {
          return el("option", { value: c });
        })),
        el("p", { id: "f-city-help", class: "sr-only",
                  text: "Type a city name, or leave it empty for the whole United Kingdom." }),
      ]),
      el("div", { class: "filter filter-species" }, [
        el("label", { class: "filter-label", for: "f-species", text: "Species" }),
        speciesChoice,
      ]),
      el("button", {
        type: "button", class: "btn-reset",
        onclick: function () {
          filters.from = ""; filters.to = ""; filters.city = "";
          filters.species = ""; filters.place = null;
          onChange();
        },
      }, [icon("reset", "14"), "Reset filters"]),
      el("p", { class: "results-meta tiny muted", id: "results-meta", role: "status" }),
    ]);
  }

  /* ---- The map ------------------------------------------------------------- */

  function legend(bands) {
    return el("div", { class: "map-legend" }, [
      el("p", { class: "legend-title", text: "Reports per place" }),
      el("ul", { class: "legend-list" }, bands.map(function (band) {
        return el("li", {}, [
          el("span", { class: "legend-dot", style: "background:" + band.colour }),
          el("span", { text: band.label }),
        ]);
      })),
      el("p", { class: "legend-note tiny",
                text: "Numbers show how many sightings are recorded at that place. " +
                      "An empty area means nothing has been reported there, " +
                      "not that there are no ticks." }),
    ]);
  }

  /* ---- The list view, which is also the map's accessible equivalent -------- */

  function listView(sightings) {
    if (!sightings.length) {
      return el("p", { class: "loading", text: "No sightings match these filters." });
    }
    return el("div", { class: "table-wrap" },
      el("table", { class: "table" }, [
        el("caption", { class: "sr-only",
                        text: "Sightings matching the current filters, most recent first." }),
        el("thead", {}, el("tr", {}, [
          el("th", { scope: "col", text: "Date" }),
          el("th", { scope: "col", text: "Place" }),
          el("th", { scope: "col", text: "Species" }),
          el("th", { scope: "col", text: "Source" }),
          el("th", { scope: "col", text: "Details" }),
        ])),
        el("tbody", {}, sightings.map(function (s) {
          return el("tr", {}, [
            el("td", { text: T.prettyDate(s.sighted_on) }),
            el("td", { text: s.location || "Not placed" }),
            el("td", { text: s.species }),
            el("td", {}, el("span", {
              class: "chip " + (s.source === "user" ? "chip-mint" : "chip-grey"),
              text: s.source === "user" ? "Community" : "Elanco data",
            })),
            el("td", {}, el("a", { href: "#/sighting/" + s.id,
                                   "aria-label": "View the sighting from " +
                                     T.prettyDate(s.sighted_on) + " at " + (s.location || "an unknown place"),
                                   text: "View" })),
          ]);
        })),
      ]));
  }

  /* ---- The panel beside the map -------------------------------------------- */

  /* The API fills in the quiet periods so a chart doesn't draw a straight line
     over a gap. That is right inside the data, but a stretch of empty months at
     either end only squashes the part worth looking at, so those are trimmed. */
  function trimEmptyEnds(points) {
    let first = 0;
    let last = points.length - 1;
    while (first <= last && points[first].count === 0) first++;
    while (last >= first && points[last].count === 0) last--;
    return first > last ? [] : points.slice(first, last + 1);
  }

  /* Elanco's records run from 2012, so over the whole dataset a chart of months
     would be a hundred and fifty bars, most of them near zero. Past about three
     years the months are rolled up into years, which is the shape worth looking
     at; a shorter range keeps its months, and a few weeks keeps its weeks. */
  const MONTHS_BEFORE_YEARLY = 36;

  function chartPoints(points, interval) {
    const trimmed = trimEmptyEnds(points);

    if (interval === "month" && trimmed.length > MONTHS_BEFORE_YEARLY) {
      const years = {};
      trimmed.forEach(function (point) {
        const year = String(point.period).slice(0, 4);
        years[year] = (years[year] || 0) + point.count;
      });
      return {
        grain: "year",
        points: Object.keys(years).sort().map(function (year) {
          return { period: year, count: years[year] };
        }).slice(-10),
      };
    }

    return { grain: interval, points: trimmed.slice(-(interval === "week" ? 8 : 12)) };
  }

  /** "2024-03" -> "Mar 24";  "2024-03-04" -> "4 Mar" */
  function periodLabel(period) {
    const bits = String(period).split("-");
    if (bits.length === 1) return bits[0];           // a whole year
    if (bits.length === 2) return T.MONTHS[Number(bits[1]) - 1] + " " + bits[0].slice(2);
    return Number(bits[2]) + " " + T.MONTHS[Number(bits[1]) - 1];
  }

  function overview(data) {
    const places = data.places.locations;
    const latest = places.reduce(function (newest, p) {
      return (!newest || p.latest > newest) ? p.latest : newest;
    }, null);

    const areas = data.regions.areas;
    const biggest = areas.reduce(function (most, a) { return Math.max(most, a.count); }, 1);

    const chart = chartPoints(data.trend.points, chosenInterval());
    const points = chart.points;
    const tallest = points.reduce(function (most, p) { return Math.max(most, p.count); }, 1);
    const grainName = { week: "Weekly", month: "Monthly", year: "Yearly" }[chart.grain];

    return el("aside", { class: "card overview", "aria-label": "Summary of the sightings shown" }, [
      el("div", { class: "panel-title" }, [
        el("h2", { text: "At a glance" }),
        el("span", { class: "panel-note", text: "Sample data" }),
      ]),
      el("div", { class: "metrics" }, [
        el("div", { class: "metric" }, [
          el("p", { class: "metric-value", text: T.number(data.places.total) }),
          el("p", { class: "metric-label", text: "Sightings on the map" }),
        ]),
        el("div", { class: "metric" }, [
          el("p", { class: "metric-value", text: T.number(places.length) }),
          el("p", { class: "metric-label", text: "Places reporting" }),
        ]),
      ]),
      latest ? el("p", { class: "tiny muted", text: "Most recent: " + T.prettyDate(latest) }) : null,

      el("div", { class: "divider" }),
      el("div", { class: "panel-title" }, [
        el("h2", { text: "Reports by region" }),
        el("span", { class: "panel-note", text: "All places" }),
      ]),
      areas.length
        ? el("ul", { class: "region-list" }, areas.map(function (area) {
            return el("li", {}, [
              el("span", { class: "region-name", text: area.area }),
              el("span", { class: "region-track" },
                 el("span", { class: "region-bar",
                              style: "width:" + Math.round((area.count / biggest) * 100) + "%" })),
              el("span", { class: "region-count", text: T.number(area.count) }),
            ]);
          }))
        : el("p", { class: "tiny muted", text: "No sightings match these filters." }),

      el("div", { class: "divider" }),
      el("div", { class: "panel-title" }, [
        el("h2", { text: grainName + " activity" }),
        el("span", { class: "panel-note", text: "Reports, not risk" }),
      ]),
      points.length
        ? el("div", {
            class: "bars", role: "img",
            "aria-label": "Activity over time. " + points.map(function (p) {
              return periodLabel(p.period) + ", " + p.count;
            }).join(". "),
            tabindex: "0",
          }, points.map(function (point, index) {
            const last = index === points.length - 1;
            return el("div", { class: "bar-col",
                               title: periodLabel(point.period) + ": " + point.count }, [
              el("span", { class: "bar-value", text: point.count }),
              el("span", { class: "bar" + (last ? " bar-latest" : ""),
                           style: "height:" + Math.max(2, Math.round((point.count / tallest) * 62)) + "px" }),
              el("span", { class: "bar-label", text: periodLabel(point.period) }),
            ]);
          }))
        : el("p", { class: "tiny muted", text: "Nothing to chart for these filters." }),
      el("p", { class: "tiny muted",
                text: chart.grain === "week"
                  ? "Weeks beginning on a Monday. Counts reflect reporting, not how many ticks there are."
                  : "Counts reflect reporting activity, not how many ticks there are." }),
    ]);
  }

  /* ---- The panel that opens when a place on the map is chosen -------------- */

  function placePanel(place, sightings, onClose) {
    const here = sightings.filter(function (s) {
      return s.location === place.location;
    }).slice(0, 5);

    return el("div", { class: "place-card", role: "region",
                       "aria-label": "Sightings at " + place.location }, [
      el("div", { class: "place-head" }, [
        el("div", {}, [
          el("h3", { text: place.location }),
          el("p", { class: "tiny muted",
                    text: place.region + " · " + T.number(place.count) +
                          (place.count === 1 ? " sighting" : " sightings") }),
        ]),
        el("button", { type: "button", class: "icon-btn", "aria-label": "Close this panel",
                       onclick: onClose }, icon("close", "14")),
      ]),
      el("ul", { class: "place-species" }, place.species.slice(0, 5).map(function (s) {
        return el("li", {}, [
          el("span", { text: s.species }),
          el("span", { class: "muted", text: T.number(s.count) }),
        ]);
      })),
      here.length
        ? el("ul", { class: "place-recent" }, here.map(function (s) {
            return el("li", {}, el("a", { href: "#/sighting/" + s.id }, [
              el("span", { text: T.prettyDate(s.sighted_on) }),
              el("span", { class: "muted", text: s.species }),
            ]));
          }))
        : null,
      el("a", { class: "btn btn-quiet btn-small", href: "#/report",
                text: "Report a sighting here" }),
    ]);
  }

  /* ---- Putting the screen together ----------------------------------------- */

  /* Each draw takes a number. If another one starts while this one is still
     waiting for the API, the older answer is thrown away when it arrives.
     Without this, changing a filter or moving between screens quickly could
     leave the slower answer painting over the newer one, or leave the screen
     stuck on "Loading…" for good. */
  let latestDraw = 0;

  async function render() {
    const view = document.getElementById("view-explore");

    // The heading is drawn once; only the part below it is redrawn as filters change.
    if (!view.querySelector(".explore-body")) {
      T.clear(view);
      view.appendChild(el("div", { class: "page-head" }, [
        el("div", {}, [
          el("p", { class: "eyebrow", text: "UK tick tracker" }),
          el("h1", { id: "explore-title", text: "Explore tick sightings" }),
          el("p", { class: "lede",
                    text: "Sightings reported across the UK. Choose a place on the map to see " +
                          "what has been found there, and check your pets after time outdoors." }),
        ]),
        el("span", { class: "chip chip-mint" }, [icon("users", "13"), "Community observations"]),
      ]));
      view.appendChild(el("div", { class: "explore-body" }));
    }

    const body = T.clear(view.querySelector(".explore-body"));
    body.appendChild(filterBar(function () { render(); }));

    const area = el("div", { class: "map-row" },
                    el("p", { class: "loading", text: "Loading sightings…" }));
    body.appendChild(area);

    const thisDraw = ++latestDraw;

    let data;
    try {
      data = await loadEverything();
    } catch (problem) {
      if (thisDraw !== latestDraw) return;
      T.clear(area).appendChild(T.errorPanel(problem, function () { render(); }));
      return;
    }
    if (thisDraw !== latestDraw) return;   // a newer draw has already started
    T.clear(area);

    const toggle = el("div", { class: "map-toggle", role: "group",
                               "aria-label": "How to show the sightings" }, [
      el("button", { type: "button", class: "toggle" + (filters.view === "map" ? " on" : ""),
                     "aria-pressed": filters.view === "map" ? "true" : "false",
                     onclick: function () { filters.view = "map"; render(); } },
         [icon("map", "14"), "Map"]),
      el("button", { type: "button", class: "toggle" + (filters.view === "list" ? " on" : ""),
                     "aria-pressed": filters.view === "list" ? "true" : "false",
                     onclick: function () { filters.view = "list"; render(); } },
         [icon("list", "14"), "List"]),
    ]);

    const mapBox = el("div", { class: "map-box" }, toggle);

    if (filters.view === "map") {
      const chosen = filters.place
        ? data.places.locations.filter(function (p) { return p.location === filters.place; })[0]
        : null;

      const bands = makeBands(data.places.locations);
      const drawing = el("div", { class: "map-figure" }, [
        el("div", { class: "map-keys" }, [
          T.ukmap.shadingLegend(data.places.locations),
          legend(bands),
        ]),
        T.ukmap.draw({
          places: data.places.locations,
          bands: bands,
          bandFor: bandFor,
          selected: filters.place,
          onPick: function (place) {
            filters.place = place.location;
            filters.city = place.location;
            render();
          },
        }),
      ]);
      mapBox.appendChild(drawing);
      if (chosen) {
        mapBox.appendChild(placePanel(chosen, data.listed.items, function () {
          filters.place = null;
          filters.city = "";
          render();
        }));
      }
      mapBox.appendChild(el("p", { class: "map-foot tiny muted",
        text: "Positions are approximate. Elanco's records sit at the city centre, and a " +
              "person's own report is rounded to about a kilometre." }));
    } else {
      mapBox.appendChild(listView(data.listed.items));
      if (data.listed.total > data.listed.items.length) {
        mapBox.appendChild(el("p", { class: "map-foot tiny muted",
          text: "Showing the " + data.listed.items.length + " most recent of " +
                T.number(data.listed.total) + ". Narrow the filters to see the rest." }));
      }
    }

    area.appendChild(mapBox);
    area.appendChild(overview(data));

    const meta = document.getElementById("results-meta");
    if (meta) {
      meta.textContent = T.number(data.places.total) + " sightings · " +
                         data.places.locations.length + " places";
    }
  }

  T.register("explore", { show: function () { render(); } });
})();
