/* ============================================================================
   The shared parts of the site: talking to the API, moving between screens,
   and the small helpers every screen uses.

   Everything hangs off one global called Tracker, so the separate script files
   can find each other without a build step or a module loader.
   ========================================================================= */

window.Tracker = (function () {
  "use strict";

  /* ---- Talking to our API ------------------------------------------------
     Every endpoint answers with the same error shape:
         {"error": {"code": "...", "message": "...", "fields": [...]}}
     so one function can deal with all of them. Anything that goes wrong is
     turned into an ApiError carrying that message, which the screens show to
     the user rather than leaving them with a blank panel. */

  function ApiError(message, code, fields, status) {
    this.message = message;
    this.code = code || "error";
    this.fields = fields || [];
    this.status = status || 0;
  }
  ApiError.prototype = Object.create(Error.prototype);

  async function api(path, options) {
    let response;
    try {
      response = await fetch(path, options);
    } catch (problem) {
      // The server isn't answering at all: it may be starting up or stopped.
      throw new ApiError("Can't reach the server. Is it still running?", "offline", [], 0);
    }

    let body = null;
    const type = response.headers.get("content-type") || "";
    if (type.indexOf("application/json") !== -1) {
      try { body = await response.json(); } catch (e) { body = null; }
    }

    if (!response.ok) {
      const error = (body && body.error) || {};
      throw new ApiError(error.message || "Something went wrong.",
                         error.code, error.fields, response.status);
    }
    return body;
  }

  /** Build a query string, leaving out anything empty. */
  function query(values) {
    const parts = [];
    Object.keys(values).forEach(function (key) {
      const value = values[key];
      if (value === null || value === undefined || value === "") return;
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  /* ---- Small helpers ----------------------------------------------------- */

  /** Make an element: el("p", {class: "lede"}, "Hello") */
  function el(tag, attributes, children) {
    const node = document.createElement(tag);
    if (attributes) {
      Object.keys(attributes).forEach(function (name) {
        const value = attributes[name];
        if (value === null || value === undefined || value === false) return;
        if (name === "class") node.className = value;
        else if (name === "text") node.textContent = value;
        else if (name === "html") node.innerHTML = value;      // only ever our own markup
        else if (name.indexOf("on") === 0 && typeof value === "function") {
          node.addEventListener(name.slice(2), value);
        } else node.setAttribute(name, value === true ? "" : value);
      });
    }
    (Array.isArray(children) ? children : children ? [children] : [])
      .forEach(function (child) {
        if (child === null || child === undefined || child === false) return;
        node.appendChild(typeof child === "object" ? child : document.createTextNode(child));
      });
    return node;
  }

  /** Make an SVG element: svg("circle", {cx: 1, cy: 2, r: 3}) */
  function svgEl(tag, attributes, children) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attributes || {}).forEach(function (name) {
      if (attributes[name] !== null && attributes[name] !== undefined) {
        node.setAttribute(name, attributes[name]);
      }
    });
    (children || []).forEach(function (child) { node.appendChild(child); });
    return node;
  }

  /** An icon from the set defined at the top of index.html. */
  function icon(name, size) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ic" + (size ? " ic-" + size : ""));
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-" + name);
    svg.appendChild(use);
    return svg;
  }

  /* ---- The species in Elanco's data ---------------------------------------
     These five are the ones the supplied dataset uses, each with the
     scientific name its records carry. Every screen reads them from here, so
     the list is written down once. */
  const SPECIES = [
    { name: "Passerine tick",       latin: "Dermacentor frontalis" },
    { name: "Fox/badger tick",      latin: "Ixodes canisuga" },
    { name: "Southern rodent tick", latin: "Ixodes acuminatus" },
    { name: "Tree-hole tick",       latin: "Ixodes arboricola" },
    { name: "Marsh tick",           latin: "Ixodes apronophorus" },
  ];

  function latinFor(name) {
    const found = SPECIES.filter(function (s) { return s.name === name; })[0];
    return found ? found.latin : null;
  }

  /* The places Elanco's data uses, which are also the ones a report can be
     attached to. */
  const CITIES = ["Birmingham", "Bristol", "Cardiff", "Edinburgh", "Glasgow", "Leeds",
                  "Leicester", "Liverpool", "London", "Manchester", "Newcastle",
                  "Nottingham", "Sheffield", "Southampton"];

  /* What a tick was found on, and the icon that goes with each. */
  const HOSTS = [
    { name: "Dog",               icon: "dog" },
    { name: "Cat",               icon: "cat" },
    { name: "Person",            icon: "users" },
    { name: "Vegetation",        icon: "leaf" },
    { name: "Other / not sure",  icon: "info" },
  ];

  function hostIcon(name) {
    const found = HOSTS.filter(function (h) { return h.name === name; })[0];
    return found ? found.icon : "pin";
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July",
                       "August", "September", "October", "November", "December"];

  /** "2024-03-07" -> "7 Mar 2024" */
  function prettyDate(iso, longMonth) {
    if (!iso) return "";
    const parts = String(iso).slice(0, 10).split("-");
    if (parts.length !== 3) return iso;
    const month = (longMonth ? MONTHS_LONG : MONTHS)[Number(parts[1]) - 1];
    return Number(parts[2]) + " " + month + " " + parts[0];
  }

  /** 1234 -> "1,234" */
  function number(value) {
    return Number(value || 0).toLocaleString("en-GB");
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /** A panel saying something went wrong, with a button to try again. */
  function errorPanel(problem, retry) {
    return el("div", { class: "msg msg-error", role: "alert" }, [
      icon("alert"),
      el("div", {}, [
        el("p", { text: problem.message || "Something went wrong." }),
        retry ? el("p", { style: "margin-top:8px" }, [
          el("button", { class: "btn btn-quiet btn-small", type: "button", onclick: retry },
             "Try again"),
        ]) : null,
      ]),
    ]);
  }

  /* ---- Moving between screens --------------------------------------------
     The address bar carries the screen, so every view can be linked to and
     shared: #/explore, #/sighting/42, #/report, #/guide. */

  const screens = {};          // name -> { show(parameter) }

  function register(name, screen) { screens[name] = screen; }

  /* Addresses that read well aren't always the name of the screen that draws
     them: "#/sighting/42" is handled by the detail screen. */
  const ALIASES = { sighting: "detail" };

  function parseHash() {
    const raw = (location.hash || "#/explore").replace(/^#\/?/, "");
    const bits = raw.split("/");
    const asked = bits[0] || "explore";
    return { name: ALIASES[asked] || asked, parameter: bits[1] || null };
  }

  function go(path) { location.hash = "#/" + path.replace(/^\/?/, ""); }

  function route() {
    const where = parseHash();
    const name = screens[where.name] ? where.name : "explore";

    // Show the right section and hide the rest.
    ["explore", "detail", "report", "guide"].forEach(function (screen) {
      const section = document.getElementById("view-" + screen);
      if (section) section.hidden = screen !== name;
    });

    // Mark the tab we are on, for sighted users and screen readers alike.
    // The detail screen belongs to Explore, so that tab stays marked.
    const tab = name === "detail" ? "explore" : name;
    document.querySelectorAll("[data-nav]").forEach(function (link) {
      if (link.getAttribute("data-nav") === tab) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    document.title = ({
      explore: "Explore tick sightings",
      detail:  "Sighting detail",
      report:  "Report a tick sighting",
      guide:   "Your guide to ticks in the UK",
    }[name] || "UK Tick Tracker") + " · UK Tick Tracker";

    screens[name].show(where.parameter);
  }

  function start() {
    window.addEventListener("hashchange", function () {
      route();
      // Moving to a new screen should put the reader at the top of it.
      window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    });
    route();
  }

  return {
    api: api, query: query, ApiError: ApiError,
    el: el, svg: svgEl, icon: icon, clear: clear, errorPanel: errorPanel,
    prettyDate: prettyDate, number: number,
    MONTHS: MONTHS, MONTHS_LONG: MONTHS_LONG,
    SPECIES: SPECIES, latinFor: latinFor, CITIES: CITIES,
    HOSTS: HOSTS, hostIcon: hostIcon,
    register: register, go: go, start: start,
  };
})();
