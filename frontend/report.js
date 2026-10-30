/* ============================================================================
   Report a sighting — the form, its error and warning messages, and the
   confirmation shown once a report has been saved.

   The form is checked here so that someone gets an answer straight away, and
   checked again by the API, which is the one that decides. The messages shown
   are the ones the API sends back, so the two can never drift apart.
   ========================================================================= */

(function () {
  "use strict";

  const T = Tracker;
  const el = T.el, icon = T.icon;

  const MAX_NOTES = 500;
  const MAX_PHOTO_MB = 10;

  /* A UK postcode, loosely: enough to tell one from a city name, while
     leaving the real checking to the lookup service. */
  const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

  let places = [];        // the places we can put a sighting, from the API
  let saved = null;       // the confirmation, once a report has gone through

  const answers = {
    date: "", where: "", resolved: null, species: "",
    host: "", notes: "", photo: null, agreed: false,
  };

  let problems = {};      // field name -> what is wrong with it
  let warnings = [];      // things worth saying about a report we did save

  /* ---- Working out where the sighting was --------------------------------- */

  function matchingPlace(text) {
    const tidy = text.trim().toLowerCase();
    return places.filter(function (p) { return p.name.toLowerCase() === tidy; })[0] || null;
  }

  /** Turn what someone typed into a position, or explain why we can't. */
  async function resolveWhere(text) {
    const typed = (text || "").trim();
    if (!typed) throw new Error("Enter a UK postcode or choose a place.");

    const place = matchingPlace(typed);
    if (place) {
      return { lat: place.lat, lon: place.lon,
               label: place.name + " · " + place.region, exact: false };
    }

    if (POSTCODE.test(typed)) {
      let answer;
      try {
        answer = await fetch("https://api.postcodes.io/postcodes/" +
                             encodeURIComponent(typed.replace(/\s+/g, "")));
      } catch (offline) {
        throw new Error("Couldn't look that postcode up just now. " +
                        "Choose one of the places in the list instead.");
      }
      if (answer.status === 404) throw new Error("That postcode wasn't found. Check it and try again.");
      if (!answer.ok) {
        throw new Error("Couldn't look that postcode up just now. " +
                        "Choose one of the places in the list instead.");
      }
      const found = (await answer.json()).result;
      return {
        lat: found.latitude, lon: found.longitude,
        label: [found.admin_ward, found.admin_district].filter(Boolean).join(", ") +
               " · United Kingdom",
        exact: true,
      };
    }

    throw new Error("Enter a full UK postcode, for example SO42 7RL, " +
                    "or choose a place from the list.");
  }

  /* ---- Checking the answers before we send them --------------------------- */

  function today() { return new Date().toISOString().slice(0, 10); }

  function check() {
    const found = {};

    if (!answers.date) found.date = "Enter the date you found the tick.";
    else if (answers.date > today()) found.date = "Date must be today or in the past.";

    if (!answers.where.trim()) found.where = "Enter a full UK postcode or a place.";
    else if (!answers.resolved) found.where = "We couldn't place that. Check it and try again.";

    if (!answers.host) found.host = "Choose where the tick was found.";

    if (answers.notes.length > MAX_NOTES) {
      found.notes = "Notes must be " + MAX_NOTES + " characters or fewer.";
    }

    if (answers.photo && answers.photo.size > MAX_PHOTO_MB * 1024 * 1024) {
      found.photo = "The photo must be " + MAX_PHOTO_MB + " MB or smaller.";
    }

    if (!answers.agreed) found.agreed = "Please confirm you have read how your report is used.";

    return found;
  }

  /* ---- Sending it --------------------------------------------------------- */

  async function send() {
    const body = {
      sighted_on: answers.date,
      lat: answers.resolved.lat,
      lon: answers.resolved.lon,
      species: answers.species || "Unknown",
      host: answers.host || null,
      notes: answers.notes.trim() || null,
    };

    const result = await T.api("/api/sightings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // The photo goes separately, once the sighting has an id. If it fails the
    // report is still saved, and we say so rather than losing the whole thing.
    let photoProblem = null;
    if (answers.photo) {
      const carrier = new FormData();
      carrier.append("photo", answers.photo);
      try {
        await T.api("/api/sightings/" + result.id + "/photo",
                    { method: "POST", body: carrier });
      } catch (problem) {
        photoProblem = problem.message;
      }
    }

    return { result: result, photoProblem: photoProblem };
  }

  /* ---- Pieces of the form -------------------------------------------------- */

  function fieldError(name) {
    return problems[name]
      ? el("p", { class: "field-error", id: "err-" + name }, [icon("alert", "14"), problems[name]])
      : null;
  }

  function step(number, title, hint, contents) {
    return el("fieldset", { class: "step" }, [
      el("legend", { class: "step-legend" }, [
        el("span", { class: "step-number", "aria-hidden": "true", text: number }),
        el("span", { class: "step-title", text: title }),
      ]),
      hint ? el("p", { class: "step-hint", text: hint }) : null,
      el("div", { class: "step-body" }, contents),
    ]);
  }

  function speciesChoice(redraw) {
    const options = T.SPECIES.concat([{ name: "Unknown", latin: "I'm not sure" }]);
    return el("div", { class: "choice-grid", role: "radiogroup",
                       "aria-label": "Which species did you find?" },
      options.map(function (option) {
        const chosen = (answers.species || "Unknown") === option.name;
        return el("label", { class: "choice" + (chosen ? " chosen" : "") }, [
          el("input", {
            type: "radio", name: "species", value: option.name, checked: chosen,
            onchange: function () { answers.species = option.name; redraw(); },
          }),
          el("span", { class: "choice-body" }, [
            el("span", { class: "choice-name", text: option.name },),
            el("span", { class: "choice-latin", text: option.latin }),
          ]),
        ]);
      }));
  }

  function hostChoice(redraw) {
    return el("div", { class: "chips", role: "radiogroup",
                       "aria-label": "Where was the tick found?",
                       "aria-describedby": problems.host ? "err-host" : null },
      T.HOSTS.map(function (host) {
        const chosen = answers.host === host.name;
        return el("label", { class: "chip-choice" + (chosen ? " chosen" : "") }, [
          el("input", { type: "radio", name: "host", value: host.name, checked: chosen,
                        onchange: function () { answers.host = host.name; redraw(); } }),
          icon(host.icon, "14"),
          el("span", { text: host.name }),
        ]);
      }));
  }

  /* ---- The confirmation screen --------------------------------------------- */

  function confirmation(view) {
    const r = saved.result;

    view.appendChild(el("div", { class: "page-head" },
      el("div", {}, [
        el("p", { class: "eyebrow", text: "Report a sighting / complete" }),
        el("h1", { id: "report-title", text: "Thank you for looking out for your community." }),
        el("p", { class: "lede", text: "Every observation helps pet owners and veterinary teams " +
                  "understand where ticks are being reported." }),
      ])));

    const left = el("div", { class: "card confirm-main" }, [
      el("span", { class: "tick-badge", "aria-hidden": "true" }, icon("check", "24")),
      el("h2", { class: "detail-heading", text: "Your sighting has been submitted." }),
      el("p", { class: "muted", text: "It is saved as a community observation. The public map " +
                "shows an approximate position, rounded to about a kilometre." }),

      el("p", { class: "reference" }, [
        el("span", { class: "reference-label", text: "Report reference" }),
        el("span", { class: "reference-value", text: r.reference }),
        el("button", {
          type: "button", class: "icon-btn", "aria-label": "Copy the reference",
          onclick: function (event) {
            const button = event.currentTarget;
            try {
              navigator.clipboard.writeText(r.reference);
              button.nextSibling.textContent = "Copied";
            } catch (problem) {
              button.nextSibling.textContent = r.reference;
            }
          },
        }, icon("copy", "14")),
        el("span", { class: "tiny muted", role: "status" }),
      ]),

      saved.photoProblem
        ? el("div", { class: "msg msg-warn" }, [icon("alert"),
            el("span", { text: "Your sighting was saved, but the photo wasn't: " +
                               saved.photoProblem })])
        : null,

      warnings.length
        ? el("div", { class: "msg msg-warn" }, [icon("alert"),
            el("div", {}, [
              el("p", { text: "Worth knowing:" }),
              el("ul", {}, warnings.map(function (w) { return el("li", { text: w }); })),
            ])])
        : null,

      el("h3", { class: "detail-heading-sm", text: "What happens next?" }),
      el("ul", { class: "next-steps" }, [
        el("li", {}, [icon("pin", "17"), el("div", {}, [
          el("p", { class: "attribute-value", text: "An approximate marker" }),
          el("p", { class: "tiny muted", text: "Your sighting joins the others at " +
                    (r.location || "its nearest area") + ", not at an exact address." })])]),
        el("li", {}, [icon("clock", "17"), el("div", {}, [
          el("p", { class: "attribute-value", text: "A clear review status" }),
          el("p", { class: "tiny muted", text: "It is labelled “Not reviewed”. " +
                    "The species is not independently confirmed." })])]),
      ]),

      el("div", { class: "detail-actions" }, [
        el("a", { class: "btn btn-primary", href: "#/sighting/" + r.id },
           [icon("map", "17"), "View this sighting"]),
        el("button", { type: "button", class: "btn btn-quiet", onclick: function () {
          saved = null; warnings = []; problems = {};
          answers.date = ""; answers.notes = ""; answers.photo = null; answers.agreed = false;
          render();
        } }, [icon("plus", "17"), "Report another sighting"]),
      ]),
    ]);

    const right = el("aside", { class: "card confirm-side", "aria-label": "Your public report" }, [
      el("div", { class: "panel-title" }, [
        el("h2", { class: "detail-heading-sm", text: "Your public report" }),
        icon("eye", "17"),
      ]),
      el("span", { class: "chip chip-warn" }, [icon("clock", "13"), "Not reviewed · community report"]),
      el("h3", { class: "detail-heading", text: r.location || "An unnamed place" }),
      el("p", { class: "tiny muted", text: r.region + " · approximate public location, about 1 km" }),
      el("div", { class: "divider thin" }),
      el("dl", { class: "summary" }, [
        el("dt", { text: "Sighting date" }), el("dd", { text: T.prettyDate(answers.date, true) }),
        el("dt", { text: "Reported species" }), el("dd", { text: r.species }),
        el("dt", { text: "Found on" }), el("dd", { text: r.host || "Not given" }),
        el("dt", { text: "Photo" }),
        el("dd", { text: answers.photo && !saved.photoProblem ? "Added" : "No photo added" }),
      ]),
      answers.notes.trim()
        ? el("div", { class: "reporter-note" }, [
            el("p", { class: "attribute-label", text: "Your note" }),
            el("p", { class: "note-text", text: answers.notes.trim() }),
          ])
        : null,
    ]);

    view.appendChild(el("div", { class: "detail-row" }, [left, right]));
  }

  /* ---- The form ------------------------------------------------------------ */

  function form(view) {
    const redraw = function () { render(); };

    view.appendChild(el("div", { class: "page-head" }, [
      el("div", {}, [
        el("p", { class: "eyebrow", text: "Report a sighting" }),
        el("h1", { id: "report-title", text: "Report a tick sighting" }),
        el("p", { class: "lede", text: "You don't need to be an expert. A date, an approximate " +
                  "location and a few details are a great place to start." }),
      ]),
    ]));

    const order = ["date", "where", "species", "host", "notes", "photo", "agreed"];
    const listed = order.filter(function (name) { return problems[name]; });

    const summary = listed.length
      ? el("div", { class: "msg msg-error", role: "alert", tabindex: "-1", id: "problem-summary" }, [
          icon("alert"),
          el("div", {}, [
            el("p", {}, el("strong", { text: "Check " + listed.length +
              (listed.length === 1 ? " field" : " fields") + " before submitting." })),
            el("ul", {}, listed.map(function (name) {
              return el("li", {}, el("a", { href: "#field-" + name, onclick: function (event) {
                event.preventDefault();
                const field = document.getElementById("field-" + name);
                if (field) field.focus();
              }, text: problems[name] }));
            })),
            el("p", { class: "tiny", text: "Your other answers have been kept. " +
                      "Nothing has been submitted yet." }),
          ]),
        ])
      : null;

    const theForm = el("form", { class: "card report-form", novalidate: true,
      onsubmit: async function (event) {
        event.preventDefault();
        await submit();
      },
    }, [
      el("div", { class: "form-top" }, [
        el("h2", { class: "detail-heading-sm", text: "Tell us what you spotted" }),
        el("span", { class: "tiny muted", text: "* Required" }),
      ]),
      summary,

      step("1", "When and where?", null, [
        el("div", { class: "field-row" }, [
          el("div", { class: "filter" }, [
            el("label", { class: "filter-label", for: "field-date", text: "Sighting date *" }),
            el("input", {
              type: "date", id: "field-date", class: "field" + (problems.date ? " is-wrong" : ""),
              value: answers.date, max: today(),
              "aria-invalid": problems.date ? "true" : null,
              "aria-describedby": problems.date ? "err-date" : "hint-date",
              onchange: function (e) { answers.date = e.target.value; },
            }),
            fieldError("date"),
            el("p", { class: "step-hint", id: "hint-date", text: "The day you found the tick." }),
          ]),
          el("div", { class: "filter" }, [
            el("label", { class: "filter-label", for: "field-where",
                          text: "UK postcode or place *" }),
            el("div", { class: "field-with-icon" }, [
              el("input", {
                type: "text", id: "field-where", list: "place-list", autocomplete: "off",
                class: "field" + (problems.where ? " is-wrong" : ""),
                value: answers.where, placeholder: "SO42 7RL, or Southampton",
                "aria-invalid": problems.where ? "true" : null,
                "aria-describedby": problems.where ? "err-where" : "hint-where",
                onchange: async function (e) {
                  answers.where = e.target.value;
                  answers.resolved = null;
                  const note = document.getElementById("where-result");
                  if (!answers.where.trim()) { if (note) note.textContent = ""; return; }
                  if (note) note.textContent = "Looking that up…";
                  try {
                    answers.resolved = await resolveWhere(answers.where);
                    delete problems.where;
                    if (note) {
                      note.textContent = answers.resolved.label;
                      note.className = "step-hint found";
                    }
                  } catch (problem) {
                    if (note) {
                      note.textContent = problem.message;
                      note.className = "step-hint not-found";
                    }
                  }
                },
              }),
              icon("search", "14"),
            ]),
            el("datalist", { id: "place-list" }, places.map(function (p) {
              return el("option", { value: p.name });
            })),
            fieldError("where"),
            el("p", { class: "step-hint" + (answers.resolved ? " found" : ""), id: "where-result",
                      text: answers.resolved ? answers.resolved.label : "" }),
            el("p", { class: "step-hint", id: "hint-where" }, [
              icon("pin", "13"),
              "Only an approximate area, about 1 km across, appears on the public map.",
            ]),
          ]),
        ]),
      ]),

      step("2", "What did you find?",
           "It's fine not to know the species. You can still make a useful report.", [
        el("div", { class: "field-head" }, [
          el("span", { class: "filter-label", text: "Tick species" }),
          el("a", { class: "more-link", href: "#/guide", text: "Open the identification guide →" }),
        ]),
        speciesChoice(redraw),
        el("div", { class: "field-head", style: "margin-top:18px" }, [
          el("span", { class: "filter-label", id: "field-host", tabindex: "-1",
                       text: "Where was the tick found? *" }),
        ]),
        hostChoice(redraw),
        fieldError("host"),
      ]),

      step("3", "A little more context", "Optional details that help others understand it.", [
        el("div", { class: "filter" }, [
          el("label", { class: "filter-label", for: "field-notes", text: "Notes (optional)" }),
          el("textarea", {
            id: "field-notes", rows: "4", maxlength: String(MAX_NOTES),
            class: "field" + (problems.notes ? " is-wrong" : ""),
            "aria-describedby": "count-notes",
            oninput: function (e) {
              answers.notes = e.target.value;
              const counter = document.getElementById("count-notes");
              if (counter) counter.textContent = answers.notes.length + " / " + MAX_NOTES;
            },
          }, answers.notes),
          el("div", { class: "field-foot" }, [
            el("span", { class: "step-hint",
                         text: "Please don't include names, exact addresses or personal health information." }),
            el("span", { class: "step-hint", id: "count-notes",
                         text: answers.notes.length + " / " + MAX_NOTES }),
          ]),
          fieldError("notes"),
        ]),

        el("div", { class: "filter" }, [
          el("label", { class: "filter-label", for: "field-photo", text: "Add a clear photo (optional)" }),
          el("div", { class: "dropzone" }, [
            icon("camera", "24"),
            el("div", {}, [
              el("p", { class: "attribute-value",
                        text: answers.photo ? answers.photo.name : "Choose a photo" }),
              el("p", { class: "tiny muted",
                        text: "JPG or PNG, up to " + MAX_PHOTO_MB + " MB. No faces or addresses." }),
            ]),
            el("input", {
              type: "file", id: "field-photo", accept: "image/jpeg,image/png",
              class: "file-input",
              "aria-describedby": problems.photo ? "err-photo" : null,
              onchange: function (e) {
                answers.photo = e.target.files[0] || null;
                redraw();
              },
            }),
          ]),
          fieldError("photo"),
        ]),
      ]),

      el("label", { class: "consent" + (problems.agreed ? " is-wrong" : "") }, [
        el("input", {
          type: "checkbox", id: "field-agreed", checked: answers.agreed,
          "aria-invalid": problems.agreed ? "true" : null,
          "aria-describedby": problems.agreed ? "err-agreed" : null,
          onchange: function (e) { answers.agreed = e.target.checked; },
        }),
        el("span", { text: "I understand my observation, notes and any photo may appear " +
                           "publicly with an approximate location. *" }),
      ]),
      fieldError("agreed"),

      el("div", { class: "form-actions" }, [
        el("a", { class: "btn-flat", href: "#/explore", text: "Cancel and return to the map" }),
        el("button", { type: "submit", class: "btn btn-primary" },
           [icon("check", "17"), "Submit sighting"]),
      ]),
    ]);

    const aside = el("div", { class: "report-aside" }, [
      el("div", { class: "card card-dark" }, [
        icon("users", "24"),
        el("h2", { class: "dark-title", text: "A small observation. A more informed community." }),
        el("p", { class: "dark-text", text: "Share what you saw to help pet owners and vets " +
                  "build a picture of where ticks are being reported." }),
        el("p", { class: "dark-text tiny" }, [icon("clock", "13"), "About 2 minutes. No account needed."]),
      ]),
      el("div", { class: "card" }, [
        el("div", { class: "panel-title" }, [
          el("h2", { class: "detail-heading-sm", text: "Your privacy, by design" }),
          icon("shield", "17"),
        ]),
        el("dl", { class: "summary" }, [
          el("dt", { text: "Approximate, never exact" }),
          el("dd", { text: "Public markers are rounded to about a kilometre. " +
                           "Your precise position is not shown." }),
          el("dt", { text: "Share only what is needed" }),
          el("dd", { text: "No name or email is needed to report a sighting." }),
          el("dt", { text: "Observations, not diagnoses" }),
          el("dd", { text: "Reports and species labels are community-supplied. " +
                           "They do not confirm infection or disease." }),
        ]),
      ]),
      el("div", { class: "card" }, [
        el("h2", { class: "detail-heading-sm", text: "Worried about your pet?" }),
        el("p", { class: "tiny muted", text: "This form is not monitored for urgent health " +
                  "concerns. If your pet seems unwell, or you are unsure about a tick, " +
                  "contact your veterinary practice." }),
      ]),
    ]);

    view.appendChild(el("div", { class: "report-row" }, [theForm, aside]));
  }

  /* ---- Submitting ---------------------------------------------------------- */

  async function submit() {
    // If a place was typed but never resolved, try once more before complaining.
    if (answers.where.trim() && !answers.resolved) {
      try { answers.resolved = await resolveWhere(answers.where); } catch (ignored) { /* reported below */ }
    }

    problems = check();
    if (Object.keys(problems).length) {
      render();
      const summary = document.getElementById("problem-summary");
      if (summary) summary.focus();
      return;
    }

    try {
      const outcome = await send();
      saved = outcome;
      warnings = outcome.result.warnings || [];
      render();
      const main = document.getElementById("main");
      if (main) main.focus();
    } catch (problem) {
      // The API had the last word. Put its message against the right field.
      problems = {};
      const FIELD_NAMES = {
        sighted_on: "date", lat: "where", lon: "where",
        species: "species", notes: "notes", host: "host",
      };
      (problem.fields || []).forEach(function (field) {
        problems[FIELD_NAMES[field.field] || "date"] = field.message;
      });
      if (!Object.keys(problems).length) problems.date = problem.message;
      render();
      const summary = document.getElementById("problem-summary");
      if (summary) summary.focus();
    }
  }

  /* ---- Drawing ------------------------------------------------------------- */

  async function render() {
    const view = T.clear(document.getElementById("view-report"));

    if (!places.length) {
      view.appendChild(el("p", { class: "loading", text: "Loading the form…" }));
      try {
        places = (await T.api("/api/places")).places;
      } catch (problem) {
        T.clear(view).appendChild(T.errorPanel(problem, function () { render(); }));
        return;
      }
      T.clear(view);
    }

    if (saved) confirmation(view);
    else form(view);
  }

  T.register("report", { show: function () { render(); } });
})();
