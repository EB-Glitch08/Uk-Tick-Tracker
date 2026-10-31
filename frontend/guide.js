/* ============================================================================
   The tick guide — recognising ticks, avoiding bites, and when they are about.

   A note on the species descriptions. Elanco's sample data uses five species
   names. Rather than invent biology for each one, the cards below say what the
   name itself refers to, and pair it with the general signs that are true of
   UK ticks. The prevention and removal advice is the UK public health guidance,
   credited at the foot of the page. Anything species-specific a vet would need
   is deliberately left out.
   ========================================================================= */

(function () {
  "use strict";

  const T = Tracker;
  const el = T.el, icon = T.icon;

  /* What each name in the dataset refers to, and where that suggests a tick
     would be found. Nothing here goes beyond what the name itself says. */
  const NOTES = {
    "Passerine tick": {
      named: "Passerines are the perching birds: thrushes, finches, sparrows and the like.",
      where: "Wherever those birds feed and nest — hedgerows, woodland edges and gardens.",
      tint: "#1b4f9c",
    },
    "Fox/badger tick": {
      named: "Named after foxes and badgers, wild mammals of woodland edges and field margins.",
      where: "Around setts, earths and the paths wild mammals use, which often cross " +
             "farmland and green space.",
      tint: "#8a5a1f",
    },
    "Southern rodent tick": {
      named: "Rodents here means small mammals such as mice and voles.",
      where: "Rough grass, hedge bottoms and leaf litter, where small mammals shelter.",
      tint: "#4e8f3b",
    },
    "Tree-hole tick": {
      named: "Tree holes are the cavities where hole-nesting birds roost and breed.",
      where: "Mature woodland and parkland with old trees.",
      tint: "#0f8f84",
    },
    "Marsh tick": {
      named: "Marshes are permanently wet, low-lying ground.",
      where: "Damp grassland, fens and the edges of wetland.",
      tint: "#6d4ea8",
    },
  };

  /* Signs that hold for UK ticks generally, whatever the species. */
  const GENERAL_SIGNS =
    "Adults and nymphs have eight legs; larvae have six. They range from about the size of a " +
    "poppy seed to a small pea, and get larger and darker as they feed.";

  /* Bite prevention, grouped the way a reader actually uses it: things to do
     before heading out, then how to check afterwards. Wording and facts are
     unchanged from the UKHSA leaflet — only the grouping is new. */
  const PREVENTION_GROUPS = [
    {
      title: "Before you go out",
      tips: [
        { icon: "leaf", title: "Keep to the path",
          text: "Walk on clearly defined paths so you don't brush against vegetation." },
        { icon: "eye", title: "Wear light colours",
          text: "Ticks are far easier to spot and brush off pale clothing." },
        { icon: "shield", title: "Use a repellent",
          text: "Repellents such as DEET, applied as the label directs." },
        { icon: "pin", title: "Know where ticks gather",
          text: "Moist places with leaf litter or longer grass: woodland, grassland, " +
                "moorland and heathland, and some urban parks and gardens." },
      ],
    },
    {
      title: "Checking yourself and pets",
      tips: [
        { icon: "paw", title: "Make checking a habit",
          text: "Check clothes and skin while you are out and again when you get home. " +
                "Check children and pets too." },
        { icon: "search", title: "Check the likely spots",
          text: "On the body they gather in skin folds — the armpits, groin, waistband, " +
                "the back of the neck and the hairline." },
      ],
    },
  ];

  const REMOVAL = [
    "Remove a tick as soon as you find one, using fine-tipped tweezers or a tick removal tool.",
    "Grasp it as close to the skin as you can.",
    "Pull upwards slowly and firmly. Mouthparts left behind can cause a local infection.",
    "Clean the bite with soap and water, or an antibacterial wash.",
    "Watch the area for several weeks.",
  ];

  /* ---- An illustration, drawn rather than photographed ---------------------- */

  function tickDrawing(tint) {
    const picture = T.svg("svg", {
      viewBox: "0 0 120 90", class: "tick-art", role: "img",
      "aria-label": "A simple illustration of a tick, shown from above.",
    }, []);

    picture.appendChild(T.svg("rect", { x: 0, y: 0, width: 120, height: 90, fill: "#f2f7f1" }));

    // Eight legs, four each side.
    [[-1, 0], [-1, 1], [-1, 2], [-1, 3], [1, 0], [1, 1], [1, 2], [1, 3]].forEach(function (leg) {
      const side = leg[0], row = leg[1];
      const y = 42 + row * 7;
      picture.appendChild(T.svg("path", {
        d: "M" + (60 + side * 12) + "," + y +
           " q" + (side * 12) + "," + (row < 2 ? -6 : 6) + " " + (side * 22) + "," + (row < 2 ? -3 : 7),
        stroke: tint, "stroke-width": 2.6, fill: "none", "stroke-linecap": "round",
      }));
    });

    picture.appendChild(T.svg("ellipse", { cx: 60, cy: 52, rx: 17, ry: 21, fill: tint }));
    picture.appendChild(T.svg("ellipse", { cx: 60, cy: 45, rx: 11, ry: 11,
                                             fill: "#ffffff", opacity: "0.22" }));
    picture.appendChild(T.svg("circle", { cx: 60, cy: 28, r: 7, fill: tint }));
    picture.appendChild(T.svg("path", { d: "M56,22 l-4,-6 M64,22 l4,-6", stroke: tint,
                                          "stroke-width": 2.6, "stroke-linecap": "round" }));
    return picture;
  }

  /* ---- Seasonal activity, worked out from the sightings we hold ------------- */

  function byCalendarMonth(points) {
    const totals = new Array(12).fill(0);
    points.forEach(function (point) {
      const month = Number(String(point.period).split("-")[1]);
      if (month >= 1 && month <= 12) totals[month - 1] += point.count;
    });
    return totals;
  }

  function seasonChart(totals) {
    const tallest = Math.max.apply(null, totals.concat([1]));
    const busiest = totals.indexOf(tallest);

    return el("div", {
      class: "season", role: "img",
      "aria-label": "Sightings by month of the year. " + totals.map(function (count, i) {
        return T.MONTHS_LONG[i] + ", " + count;
      }).join(". "),
    }, totals.map(function (count, index) {
      return el("div", { class: "season-col", title: T.MONTHS_LONG[index] + ": " + count }, [
        el("span", { class: "season-bar" + (index === busiest ? " season-peak" : ""),
                     style: "height:" + Math.max(3, Math.round((count / tallest) * 110)) + "px" }),
        el("span", { class: "season-label", text: T.MONTHS[index].charAt(0) }),
      ]);
    }));
  }

  /* ---- The screen ---------------------------------------------------------- */

  let places = [];
  let chosenPlace = "";

  function speciesCard(species, count) {
    const note = NOTES[species.name] || { named: "", where: "", tint: "#4e8f3b" };
    return el("article", { class: "species-card" }, [
      tickDrawing(note.tint),
      el("div", { class: "species-body" }, [
        el("h3", { class: "detail-heading-sm", text: species.name }),
        el("p", { class: "attribute-note", text: species.latin }),
        el("span", { class: "chip chip-grey",
                     text: count === null ? "In the dataset"
                           : T.number(count) + (count === 1 ? " sighting" : " sightings") +
                             " recorded" }),
        el("div", { class: "species-fact" }, [
          el("p", { class: "attribute-label", text: "What the name refers to" }),
          el("p", { class: "note-text", text: note.named }),
        ]),
        el("div", { class: "species-fact" }, [
          el("p", { class: "attribute-label", text: "Where that suggests looking" }),
          el("p", { class: "note-text", text: note.where }),
        ]),
      ]),
    ]);
  }

  let latestDraw = 0;

  async function render() {
    const thisDraw = ++latestDraw;
    const view = T.clear(document.getElementById("view-guide"));
    view.appendChild(el("p", { class: "loading", text: "Loading the guide…" }));

    let counts = {}, monthTotals = new Array(12).fill(0);
    try {
      if (!places.length) places = (await T.api("/api/places")).places;

      const locations = await T.api("/api/insights/locations");
      locations.locations.forEach(function (place) {
        place.species.forEach(function (s) {
          counts[s.species] = (counts[s.species] || 0) + s.count;
        });
      });

      const trend = await T.api("/api/insights/trends" +
        T.query({ interval: "month", city: chosenPlace || null }));
      monthTotals = byCalendarMonth(trend.points);
    } catch (problem) {
      if (thisDraw !== latestDraw) return;
      T.clear(view).appendChild(T.errorPanel(problem, function () { render(); }));
      return;
    }
    if (thisDraw !== latestDraw) return;

    T.clear(view);

    view.appendChild(el("div", { class: "page-head" }, [
      el("div", {}, [
        el("p", { class: "eyebrow", text: "The tick guide" }),
        el("h1", { id: "guide-title", text: "Your guide to ticks in the UK" }),
        el("p", { class: "lede", text: "A practical guide for pet owners: recognise the clues, " +
                  "build safer habits, and know when to ask your vet." }),
      ]),
      el("span", { class: "chip chip-mint" }, [icon("bug", "13"), "Pet-owner field notes"]),
    ]));

    /* These jump to sections further down THIS page. A plain "#id" href would
       otherwise be picked up by the app's hash router (it treats location.hash
       as the page to show) and bounce the reader to Explore instead of
       scrolling — so the click is handled here and the hash is never touched. */
    function jumpTo(id) {
      return function (event) {
        event.preventDefault();
        const target = document.getElementById(id);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      };
    }

    view.appendChild(el("nav", { class: "guide-nav", "aria-label": "Sections of this guide" }, [
      el("a", { href: "#guide-prevention", text: "Bite prevention", onclick: jumpTo("guide-prevention") }),
      el("a", { href: "#guide-season", text: "Seasonal activity", onclick: jumpTo("guide-season") }),
      el("span", { class: "tiny muted",
                   text: "Illustrations are indicative, not a diagnostic tool." }),
    ]));

    view.appendChild(el("div", { class: "msg msg-ok guide-banner" }, [
      icon("search", "17"),
      el("div", {}, [
        el("p", {}, el("strong", { text: "Not every tick looks the same." })),
        el("p", { text: GENERAL_SIGNS + " These are useful clues, not a definite " +
                        "identification — choose “Unknown” when reporting if you aren't sure." }),
      ]),
    ]));

    /* --- species --- */
    view.appendChild(el("h2", { class: "section-title",
                                text: "The species in this data" }));
    view.appendChild(el("p", { class: "lede small",
      text: "Elanco's dataset records these five names. Each card explains what the name " +
            "refers to and how many sightings are held, rather than offering a species-level " +
            "identification, which needs an expert." }));
    view.appendChild(el("div", { class: "species-grid" },
      T.SPECIES.map(function (s) {
        return speciesCard(s, counts[s.name] === undefined ? null : counts[s.name]);
      })));

    /* --- prevention and removal --- */
    view.appendChild(el("h2", { id: "guide-prevention", class: "section-title",
                                text: "Bite prevention" }));
    view.appendChild(el("p", { class: "lede small",
      text: "Most bites are avoided with a few habits before you go out and a quick check " +
            "once you're back. What to do if one has already attached is covered too." }));
    view.appendChild(el("div", { class: "two-up" }, [
      el("section", { class: "card" }, PREVENTION_GROUPS.map(function (group) {
        return el("div", { class: "prevention-group" }, [
          el("h3", { class: "step-title", text: group.title }),
          el("ul", { class: "next-steps" }, group.tips.map(function (tip) {
            return el("li", {}, [icon(tip.icon, "17"), el("div", {}, [
              el("p", { class: "attribute-value", text: tip.title }),
              el("p", { class: "tiny muted", text: tip.text }),
            ])]);
          })),
        ]);
      })),
      el("section", { class: "card" }, [
        el("h3", { class: "step-title", text: "If you find one attached" }),
        el("ol", { class: "tips" }, REMOVAL.map(function (line) {
          return el("li", { text: line });
        })),
        el("div", { class: "msg msg-warn" }, [icon("alert", "15"),
          el("span", { text: "See a GP promptly if you feel unwell with flu-like symptoms, or a " +
                      "spreading circular rash appears — usually within one to four weeks. " +
                      "For a pet, contact your veterinary practice." })]),
      ]),
    ]));

    /* --- seasonal activity --- */
    view.appendChild(el("section", { class: "card", id: "guide-season" }, [
      el("div", { class: "panel-title" }, [
        el("h2", { class: "detail-heading-sm", text: "When are sightings reported?" }),
        el("span", { class: "panel-note", text: "From the sightings we hold" }),
      ]),
      el("p", { class: "lede small",
        text: "Ticks are present all year in the UK and most active between spring and " +
              "autumn. The chart below counts our sightings by the month they were reported, " +
              "for the whole UK or for one place you choose." }),
      el("div", { class: "field-head" }, [
        el("div", { class: "filter filter-place" }, [
          el("label", { class: "filter-label", for: "season-place", text: "Show the year for" }),
          el("select", { id: "season-place", class: "field",
                         onchange: function (e) { chosenPlace = e.target.value; render(); } },
            [el("option", { value: "", text: "the whole United Kingdom" })].concat(
              places.map(function (p) {
                return el("option", { value: p.name, selected: chosenPlace === p.name, text: p.name });
              }))),
        ]),
      ]),
      seasonChart(monthTotals),
      el("p", { class: "tiny muted",
        text: "This counts reported sightings, not how many ticks there are." }),
    ]));

    view.appendChild(el("div", { class: "msg msg-ok guide-foot" }, [
      icon("bug", "17"),
      el("span", { text: "A sighting is still useful even when you can't identify the species." }),
      el("a", { class: "more-link", href: "#/report", text: "Report a sighting →" }),
    ]));

    view.appendChild(el("p", { class: "tiny muted sources" }, [
      "General guidance on this page follows the UK Health Security Agency tick leaflet ",
      el("a", { href: "https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/694158/PHE_Tick_Leaflet.pdf",
                target: "_blank", rel: "noopener", text: "(Be tick aware, PHE/UKHSA)" }),
      ". It is general information for pet owners, not medical or veterinary advice.",
    ]));
  }

  T.register("guide", { show: function () { render(); } });
})();
