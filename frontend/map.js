/* ============================================================================
   The map.

   The geometry comes from uk-map-data.js, which is generated from the Office
   for National Statistics ITL1 region boundaries and projected once, offline,
   into plain SVG paths. Drawing it needs no mapping library and no map tiles:
   the browser downloads one small file and nothing else.

   Two things are shown at once, and they answer different questions:
     - each region is shaded by how many sightings it holds, so the broad
       picture is readable at a glance;
     - each place carries a circle with its own count, for the detail.
   ========================================================================= */

(function () {
  "use strict";

  const T = Tracker;
  const el = T.el, icon = T.icon;
  const NS = "http://www.w3.org/2000/svg";

  const svg = T.svg;

  function text(content, attributes) {
    const node = svg("text", attributes);
    node.textContent = content;
    return node;
  }

  /* ---- Colours -------------------------------------------------------------
     Region shading runs through one hue, from palest to deepest, so more
     sighting always means darker. The circles keep the separate set of band
     colours from the design, which answers a different question, so the two
     are never mistaken for one another. */
  const SHADES = ["#f1f8f3", "#dcefe3", "#bfe2d2", "#9ad4c1", "#6cc0ad", "#3da795"];

  /* Where each place's name sits relative to its circle. On a map this size the
     English midlands are crowded, so the sides are chosen by hand rather than
     all labels sitting underneath and landing on one another. */
  const LABELS = {
    Glasgow:     "left",   Edinburgh:  "right",  Newcastle: "right",
    Leeds:       "right",  Manchester: "left",   Liverpool: "left",
    Sheffield:   "right",  Nottingham: "right",  Leicester: "right",
    Birmingham:  "left",   Cardiff:    "left",   Bristol:   "below",
    London:      "right",  Southampton: "below",
  };

  function shadeFor(count, highest) {
    if (!count) return SHADES[0];
    const step = Math.ceil((count / Math.max(1, highest)) * (SHADES.length - 1));
    return SHADES[Math.min(SHADES.length - 1, Math.max(1, step))];
  }

  /* ---- Working out the scale bar -------------------------------------------
     Two cities we know the real distance between, measured against their
     distance on screen, gives the number of kilometres a pixel stands for. */
  const SCALE_FROM = "London", SCALE_TO = "Edinburgh";
  const SCALE_REAL_KM = 534;          // London to Edinburgh, straight line

  function kmPerPixel(cities) {
    const a = cities[SCALE_FROM], b = cities[SCALE_TO];
    if (!a || !b) return null;
    const across = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
    return across ? SCALE_REAL_KM / across : null;
  }

  /* ---- The view, which zooming and panning change -------------------------- */

  function makeView(data) {
    return { x: 0, y: 0, w: data.width, h: data.height,
             full: { x: 0, y: 0, w: data.width, h: data.height } };
  }

  function applyView(picture, view) {
    picture.setAttribute("viewBox",
      view.x.toFixed(1) + " " + view.y.toFixed(1) + " " +
      view.w.toFixed(1) + " " + view.h.toFixed(1));
  }

  /** Zoom about the middle of what is currently shown. */
  function zoomBy(view, factor) {
    const smallest = view.full.w / 8;      // don't zoom in past this
    const widest = view.full.w;
    let width = view.w / factor;
    width = Math.min(widest, Math.max(smallest, width));
    const height = width * (view.full.h / view.full.w);

    view.x += (view.w - width) / 2;
    view.y += (view.h - height) / 2;
    view.w = width;
    view.h = height;
    keepInside(view);
  }

  /** Don't let the map be dragged off into empty space. */
  function keepInside(view) {
    view.x = Math.min(view.full.w - view.w, Math.max(0, view.x));
    view.y = Math.min(view.full.h - view.h, Math.max(0, view.y));
  }

  /* ---- Drawing -------------------------------------------------------------
     options: { places, bands, bandFor, selected, onPick }
     Returns the element to put on the page. */

  function draw(options) {
    const data = window.UK_MAP;
    if (!data) {
      return el("p", { class: "loading", text: "The map could not be loaded." });
    }

    const places = options.places || [];
    const view = makeView(data);

    /* How many sightings each region holds, for the shading. */
    const perArea = {};
    places.forEach(function (place) {
      const area = place.area || place.region_group || null;
      if (area) perArea[area] = (perArea[area] || 0) + place.count;
    });
    const busiestArea = Object.keys(perArea)
      .reduce(function (most, key) { return Math.max(most, perArea[key]); }, 0);

    const picture = svg("svg", {
      class: "uk-map", viewBox: data.viewBox, role: "group",
      "aria-label": "Map of the United Kingdom. " + places.length +
        " places have sightings; each is a button. The list view has the same information.",
    });

    /* The Republic of Ireland, drawn quietly for context only. */
    if (data.context) {
      picture.appendChild(svg("path", { d: data.context, class: "map-context" }));
    }

    /* Each region, shaded by how many sightings it holds. */
    const areaLayer = svg("g", { class: "map-areas" });
    data.areas.forEach(function (area) {
      const count = perArea[area.name] || 0;
      const shape = svg("path", {
        d: area.path, class: "map-area", fill: shadeFor(count, busiestArea),
        "data-area": area.id,
      });
      const tip = svg("title", {});
      tip.textContent = area.name + ": " + T.number(count) +
                        (count === 1 ? " sighting" : " sightings");
      shape.appendChild(tip);
      areaLayer.appendChild(shape);
    });
    picture.appendChild(areaLayer);

    /* Sea names, placed as a fraction of the whole map so they stay put. */
    const seas = [
      { label: "North Sea", at: [0.80, 0.42] },
      { label: "Irish Sea", at: [0.26, 0.60] },
      { label: "Atlantic Ocean", at: [0.08, 0.30] },
    ];
    const seaLayer = svg("g", { class: "map-seas" });
    seas.forEach(function (sea) {
      seaLayer.appendChild(text(sea.label, {
        x: (data.width * sea.at[0]).toFixed(0),
        y: (data.height * sea.at[1]).toFixed(0),
        class: "sea-label",
      }));
    });
    picture.appendChild(seaLayer);

    /* The places, largest first so a small circle is never hidden behind a
       big one. */
    const placeLayer = svg("g", { class: "map-places" });
    const labelLayer = svg("g", { class: "map-place-labels" });
    const biggest = places.reduce(function (most, p) { return Math.max(most, p.count); }, 1);

    places.slice().sort(function (a, b) { return b.count - a.count; }).forEach(function (place) {
      const at = data.cities[place.location];
      if (!at) return;                       // somewhere we have no position for

      const band = options.bandFor(options.bands, place.count);
            /* Kept deliberately small: at the whole-country view the English
         midlands hold six places within a few dozen miles, and a larger
         circle would bury its neighbour's number. Zooming in separates them. */
      const radius = 7 + 5 * Math.sqrt(place.count / biggest);
      const chosen = options.selected === place.location;

      const marker = svg("g", {
        class: "cluster" + (chosen ? " chosen" : ""), tabindex: "0", role: "button",
        "aria-label": place.location + ", " + place.count +
                      (place.count === 1 ? " sighting" : " sightings"),
        "aria-pressed": chosen ? "true" : "false",
      });
      marker.appendChild(svg("circle", {
        cx: at.x, cy: at.y, r: radius, fill: band.colour,
        stroke: "#ffffff", "stroke-width": chosen ? 3 : 2,
      }));
      marker.appendChild(text(place.count, {
        x: at.x, y: at.y + 3.6, class: "cluster-count",
      }));
      const tip = svg("title", {});
      tip.textContent = place.location + ": " + T.number(place.count) +
                        (place.count === 1 ? " sighting" : " sightings");
      marker.appendChild(tip);
      marker.addEventListener("click", function () { options.onPick(place); });
      marker.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          options.onPick(place);
        }
      });
      placeLayer.appendChild(marker);

      const side = LABELS[place.location] || "below";
      const label = { "class": "place-label" };
      if (side === "left") {
        label.x = at.x - radius - 6; label.y = at.y + 3.4;
        label["text-anchor"] = "end";
      } else if (side === "right") {
        label.x = at.x + radius + 6; label.y = at.y + 3.4;
        label["text-anchor"] = "start";
      } else {
        label.x = at.x; label.y = at.y + radius + 12;
        label["text-anchor"] = "middle";
      }
      labelLayer.appendChild(text(place.location, label));
    });
    picture.appendChild(placeLayer);
    picture.appendChild(labelLayer);

    applyView(picture, view);

    /* ---- Panning by dragging --------------------------------------------- */
    let dragging = null;
    picture.addEventListener("pointerdown", function (event) {
      if (event.target.closest(".cluster")) return;      // that is a button
      dragging = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
      picture.classList.add("is-dragging");
      picture.setPointerCapture(event.pointerId);
    });
    picture.addEventListener("pointermove", function (event) {
      if (!dragging) return;
      const box = picture.getBoundingClientRect();
      const perPixel = view.w / box.width;
      view.x = dragging.viewX - (event.clientX - dragging.x) * perPixel;
      view.y = dragging.viewY - (event.clientY - dragging.y) * perPixel;
      keepInside(view);
      applyView(picture, view);
    });
    ["pointerup", "pointercancel"].forEach(function (name) {
      picture.addEventListener(name, function () {
        dragging = null;
        picture.classList.remove("is-dragging");
      });
    });

    /* ---- The controls drawn over the map ---------------------------------- */
    function zoom(factor) {
      zoomBy(view, factor);
      applyView(picture, view);
      zoomOutButton.disabled = view.w >= view.full.w - 0.5;
      zoomInButton.disabled = view.w <= view.full.w / 8 + 0.5;
      drawScaleBar();
    }

    const zoomInButton = el("button", {
      type: "button", class: "map-button", "aria-label": "Zoom in",
      onclick: function () { zoom(1.6); },
    }, icon("plus", "17"));

    const zoomOutButton = el("button", {
      type: "button", class: "map-button", "aria-label": "Zoom out", disabled: true,
      onclick: function () { zoom(1 / 1.6); },
    }, icon("minus", "17"));

    const resetButton = el("button", {
      type: "button", class: "map-button", "aria-label": "Show the whole United Kingdom",
      onclick: function () {
        view.x = 0; view.y = 0; view.w = view.full.w; view.h = view.full.h;
        applyView(picture, view);
        zoomOutButton.disabled = true;
        zoomInButton.disabled = false;
        drawScaleBar();
      },
    }, icon("target", "17"));

    const controls = el("div", { class: "map-controls" }, [
      el("div", { class: "map-button-group" }, [zoomInButton, zoomOutButton]),
      resetButton,
    ]);

    const compass = el("div", { class: "map-compass", "aria-hidden": "true" }, [
      el("span", { class: "compass-n", text: "N" }),
      icon("north", "20"),
    ]);

    /* The scale bar is worked out from the projection rather than guessed, and
       is redrawn whenever the zoom changes. */
    const scaleBar = el("div", { class: "map-scale" });
    function drawScaleBar() {
      const perPixel = kmPerPixel(data.cities);
      T.clear(scaleBar);
      if (!perPixel) return;

      const box = picture.getBoundingClientRect();
      if (!box.width) return;
      // How many kilometres one screen pixel covers at this zoom.
      const kmPerScreenPixel = perPixel * (view.w / box.width);
      const choices = [10, 25, 50, 100, 200, 500];
      let km = choices[choices.length - 1];
      for (let i = 0; i < choices.length; i++) {
        if (choices[i] / kmPerScreenPixel <= 120) km = choices[i];
      }
      scaleBar.appendChild(el("span", { class: "scale-rule",
        style: "width:" + Math.round(km / kmPerScreenPixel) + "px" }));
      scaleBar.appendChild(el("span", { class: "scale-label", text: km + " km" }));
    }

    const frame = el("div", { class: "map-frame" }, [
      picture, controls, compass, scaleBar,
      el("p", { class: "map-credit tiny",
                text: "Boundaries: ONS ITL1 regions and Natural Earth. " +
                      "Sighting positions are generalised." }),
    ]);

    // The size is only known once it is on the page.
    requestAnimationFrame(drawScaleBar);
    window.addEventListener("resize", drawScaleBar);

    return frame;
  }

  /** The key to the shading, which belongs beside the map rather than on it. */
  function shadingLegend(places) {
    const perArea = {};
    places.forEach(function (place) {
      if (place.area) perArea[place.area] = (perArea[place.area] || 0) + place.count;
    });
    const highest = Object.keys(perArea)
      .reduce(function (most, key) { return Math.max(most, perArea[key]); }, 0);

    return el("div", { class: "shade-key" }, [
      el("p", { class: "legend-title", text: "Sightings per region" }),
      el("div", { class: "shade-strip", "aria-hidden": "true" },
        SHADES.slice(1).map(function (colour) {
          return el("span", { class: "shade-step", style: "background:" + colour });
        })),
      el("div", { class: "shade-ends" }, [
        el("span", { class: "tiny muted", text: "Fewer" }),
        el("span", { class: "tiny muted", text: highest ? T.number(highest) + " most" : "" }),
      ]),
    ]);
  }

  T.ukmap = { draw: draw, shadingLegend: shadingLegend, SHADES: SHADES };
})();
