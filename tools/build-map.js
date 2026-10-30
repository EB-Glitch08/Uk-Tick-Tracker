#!/usr/bin/env node
/*
 * build-map.js — generates frontend/uk-map-data.js
 *
 * HOW TO RUN
 *   cd <workdir>
 *   npm install topojson-client d3-geo world-atlas@2.0.2
 *   # download the boundary sources (see SOURCES below) into ./  then:
 *   node tools/build-map.js
 *
 * SOURCES (raw.githubusercontent.com — the GitHub API is not needed)
 *   ew_nuts1.json   https://raw.githubusercontent.com/martinjc/UK-GeoJSON/master/json/eurostat/ew/topo_nuts1.json
 *   sco_eer.json    https://raw.githubusercontent.com/martinjc/UK-GeoJSON/master/json/electoral/sco/topo_eer.json
 *   ni_lgd.json     https://raw.githubusercontent.com/martinjc/UK-GeoJSON/master/json/administrative/ni/topo_lgd.json
 *
 *   There is no NUTS1 file covering Scotland or Northern Ireland in that repo
 *   (json/eurostat only holds England & Wales). Scotland is taken from the
 *   European Electoral Region boundary, which is exactly UKM as a single
 *   feature; Northern Ireland from its Local Government Districts merged,
 *   which is exactly UKN. topojson.merge on the Scottish NUTS2 file produces
 *   broken rings, so it is deliberately not used.
 *   Republic of Ireland outline: node_modules/world-atlas/countries-50m.json (Natural Earth, public domain)
 *
 * Boundary data: Contains OS / ONS / NRS / LPS data (c) Crown copyright and
 * database right 2016, licensed under the Open Government Licence v3.
 */

const fs = require('fs');
const path = require('path');
const topojson = require('topojson-client');
const d3 = require('d3-geo');

// ---------------------------------------------------------------- config ----
const WIDTH = 520;
const HEIGHT = 760;
const MARGIN = 8;
const DP_TOLERANCE = 0.35;   // Douglas-Peucker tolerance, projected px
const MIN_RING_AREA = 1.5;   // drop islands smaller than this, px^2

const SRC_DIR = process.env.MAP_SRC_DIR || path.join(__dirname, '..', '..', 'mapbuild');
const OUT_FILE = path.join(__dirname, '..', 'frontend', 'uk-map-data.js');

// NUTS1 / ITL1 code -> display area
const AREA_OF_CODE = {
  UKC: 'northern-england', UKD: 'northern-england', UKE: 'northern-england',
  UKF: 'midlands-east',    UKG: 'midlands-east',    UKH: 'midlands-east',
  UKI: 'south-east-london', UKJ: 'south-east-london',
  UKK: 'south-west',
  UKL: 'wales',
  UKM: 'scotland',
  UKN: 'northern-ireland',
};

const AREA_NAMES = {
  'northern-england': 'Northern England',
  'midlands-east': 'Midlands & East',
  'south-east-london': 'South East & London',
  'south-west': 'South West',
  'wales': 'Wales',
  'scotland': 'Scotland',
  'northern-ireland': 'Northern Ireland',
};

const CITIES = {
  Birmingham: [-1.8904, 52.4862],
  Bristol: [-2.5879, 51.4545],
  Cardiff: [-3.1791, 51.4816],
  Edinburgh: [-3.1883, 55.9533],
  Glasgow: [-4.2518, 55.8642],
  Leeds: [-1.5491, 53.8008],
  Leicester: [-1.1398, 52.6369],
  Liverpool: [-2.9916, 53.4084],
  London: [-0.1278, 51.5074],
  Manchester: [-2.2426, 53.4808],
  Newcastle: [-1.6178, 54.9783],
  Nottingham: [-1.1581, 52.9548],
  Sheffield: [-1.4701, 53.3811],
  Southampton: [-1.4044, 50.9097],
};

// ------------------------------------------------------------- utilities ----
function readTopo(file) {
  return JSON.parse(fs.readFileSync(path.join(SRC_DIR, file), 'utf8'));
}

// Collect every polygon ring-set out of a geometry into a list of polygons
// (a polygon being an array of rings, outer ring first).
function polygonsOf(geometry, out) {
  if (!geometry) return out;
  if (geometry.type === 'Polygon') out.push(geometry.coordinates);
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach(p => out.push(p));
  else if (geometry.type === 'GeometryCollection') geometry.geometries.forEach(g => polygonsOf(g, out));
  return out;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a / 2);
}

// Douglas-Peucker on a CLOSED ring. Run plainly from first to last vertex it
// would happily cut a chord straight across the ring, so the ring is split at
// the vertex furthest from its start and each half simplified as a polyline.
function simplifyRing(points, tol) {
  const pts = points.slice();
  const a = pts[0], z = pts[pts.length - 1];
  if (a[0] !== z[0] || a[1] !== z[1]) pts.push([a[0], a[1]]);
  if (pts.length < 5) return pts;
  let far = 0, farD = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = (pts[i][0] - a[0]) ** 2 + (pts[i][1] - a[1]) ** 2;
    if (d > farD) { farD = d; far = i; }
  }
  const head = simplifyLine(pts.slice(0, far + 1), tol);
  const tail = simplifyLine(pts.slice(far), tol);
  return head.concat(tail.slice(1));
}

// Douglas-Peucker on an open polyline.
function simplifyLine(points, tol) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxD = -1, idx = -1;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      let d;
      if (len2 === 0) {
        d = (px - ax) * (px - ax) + (py - ay) * (py - ay);
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = ax + t * dx, cy = ay + t * dy;
        d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

// Project + simplify + round one list of polygons into an SVG path string.
function toPath(polygons, projection, tol, minArea) {
  const parts = [];
  for (const rings of polygons) {
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      // project
      const pts = [];
      for (const c of ring) {
        const p = projection(c);
        if (p && isFinite(p[0]) && isFinite(p[1])) pts.push(p);
      }
      if (pts.length < 4) continue;
      const simp = simplifyRing(pts, tol);
      // round + dedupe
      const rounded = [];
      for (const [x, y] of simp) {
        const rx = Math.round(x * 10) / 10;
        const ry = Math.round(y * 10) / 10;
        const prev = rounded[rounded.length - 1];
        if (!prev || prev[0] !== rx || prev[1] !== ry) rounded.push([rx, ry]);
      }
      while (rounded.length > 1) {
        const a = rounded[0], b = rounded[rounded.length - 1];
        if (a[0] === b[0] && a[1] === b[1]) rounded.pop(); else break;
      }
      if (rounded.length < 3) continue;
      const area = ringArea(rounded);
      // only drop tiny *outer* rings (islands); keep holes that survived
      if (r === 0 && area < minArea) break;
      if (r > 0 && area < minArea) continue;
      parts.push('M' + rounded.map(p => p[0] + ' ' + p[1]).join('L') + 'Z');
    }
  }
  return parts.join('');
}

// ------------------------------------------------------------------ main ----
function main() {
  // --- England & Wales: NUTS1 regions, merged per display area -----------
  const ewTopo = readTopo('ew_nuts1.json');

  const areaPolys = {};
  for (const id of Object.keys(AREA_NAMES)) areaPolys[id] = [];

  const ewGroups = {};
  for (const g of ewTopo.objects.nuts1.geometries) {
    const code = (g.properties.NUTS112CD || g.properties.nuts112cd || '').slice(0, 3);
    const areaId = AREA_OF_CODE[code];
    if (!areaId) { console.warn('unmapped NUTS1 code', code, g.properties); continue; }
    (ewGroups[areaId] = ewGroups[areaId] || []).push(g);
  }
  for (const areaId of Object.keys(ewGroups)) {
    polygonsOf(topojson.merge(ewTopo, ewGroups[areaId]), areaPolys[areaId]);
  }

  // --- Scotland: the Scotland EER boundary, i.e. UKM as one feature -------
  const scoTopo = readTopo('sco_eer.json');
  const scoFeatures = topojson.feature(scoTopo, scoTopo.objects.eer).features;
  if (scoFeatures.length !== 1) throw new Error('expected one Scotland feature');
  polygonsOf(scoFeatures[0].geometry, areaPolys.scotland);

  // --- Northern Ireland: Local Government Districts merged ---------------
  const niTopo = readTopo('ni_lgd.json');
  const niMerged = topojson.merge(niTopo, niTopo.objects.lgd.geometries);
  polygonsOf(niMerged, areaPolys['northern-ireland']);

  for (const id of Object.keys(areaPolys)) {
    if (!areaPolys[id].length) throw new Error('no geometry for area ' + id);
  }

  // --- Republic of Ireland (background context) --------------------------
  let irelandPolys = null;
  try {
    const worldPath = require.resolve('world-atlas/countries-50m.json');
    const world = JSON.parse(fs.readFileSync(worldPath, 'utf8'));
    const countries = topojson.feature(world, world.objects.countries).features;
    const ie = countries.find(c => c.properties && c.properties.name === 'Ireland');
    if (ie) irelandPolys = polygonsOf(ie.geometry, []);
    else console.warn('Ireland not found in world-atlas; omitting context');
  } catch (e) {
    console.warn('world-atlas unavailable; omitting Ireland context:', e.message);
  }

  // --- projection, fitted to the UK only ---------------------------------
  const ukCollection = {
    type: 'MultiPolygon',
    coordinates: Object.keys(areaPolys).reduce((acc, id) => acc.concat(areaPolys[id]), []),
  };

  const projection = d3.geoConicConformal()
    .parallels([50, 58])
    .rotate([4.4, 0])
    .fitExtent([[MARGIN, MARGIN], [WIDTH - MARGIN, HEIGHT - MARGIN]], ukCollection);

  // --- build paths -------------------------------------------------------
  const areas = Object.keys(AREA_NAMES).map(id => ({
    id,
    name: AREA_NAMES[id],
    path: toPath(areaPolys[id], projection, DP_TOLERANCE, MIN_RING_AREA),
  }));

  for (const a of areas) {
    if (!a.path) throw new Error('empty path for ' + a.id);
  }

  const context = irelandPolys
    ? toPath(irelandPolys, projection, DP_TOLERANCE * 1.4, MIN_RING_AREA * 2)
    : null;

  const cities = {};
  for (const name of Object.keys(CITIES).sort()) {
    const p = projection(CITIES[name]);
    cities[name] = { x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10 };
  }

  // --- standalone Lambert conformal conic, matching the fitted projection --
  // d3.geoConicConformal is, for a point: rotate longitude by -rotate[0],
  // apply the spherical LCC forward formula, then x*k + tx, ty - y*k.
  // (The default centre [0,0] maps to raw [0,0], so no extra centre offset.)
  const [p0, p1] = projection.parallels().map(d => d * Math.PI / 180);
  const tany = y => Math.tan((Math.PI / 2 + y) / 2);
  const CONIC_N = p0 === p1
    ? Math.sin(p0)
    : Math.log(Math.cos(p0) / Math.cos(p1)) / Math.log(tany(p1) / tany(p0));
  const CONIC_F = Math.cos(p0) * Math.pow(tany(p0), CONIC_N) / CONIC_N;
  const K = projection.scale();
  const [TX, TY] = projection.translate();
  const ROT = projection.rotate()[0];

  const num = v => {
    const s = v.toPrecision(15);
    return String(Number(s));
  };

  function standaloneProject(lat, lon) {
    let lambda = (lon + ROT) * Math.PI / 180;
    while (lambda > Math.PI) lambda -= 2 * Math.PI;
    while (lambda < -Math.PI) lambda += 2 * Math.PI;
    const phi = lat * Math.PI / 180;
    const r = CONIC_F / Math.pow(Math.tan((Math.PI / 2 + phi) / 2), CONIC_N);
    const x = r * Math.sin(CONIC_N * lambda);
    const y = CONIC_F - r * Math.cos(CONIC_N * lambda);
    return { x: Math.round((x * K + TX) * 10) / 10, y: Math.round((TY - y * K) * 10) / 10 };
  }

  // verify against the d3-generated city coordinates
  let maxErr = 0;
  for (const name of Object.keys(CITIES)) {
    const [lon, lat] = CITIES[name];
    const got = standaloneProject(lat, lon);
    const want = cities[name];
    const err = Math.max(Math.abs(got.x - want.x), Math.abs(got.y - want.y));
    if (err > maxErr) maxErr = err;
    if (err > 0.5) {
      throw new Error('project() disagrees with d3 for ' + name + ': ' +
        JSON.stringify(got) + ' vs ' + JSON.stringify(want) + ' (' + err + 'px)');
    }
  }
  console.log('project() max error across 14 cities: ' + maxErr.toFixed(3) + ' px');

  // --- emit --------------------------------------------------------------
  const lines = [];
  lines.push('/* Generated from ONS ITL1/NUTS1 boundaries (martinjc/UK-GeoJSON) and Natural');
  lines.push('   Earth (world-atlas). Regenerate with tools/build-map.js. Do not edit by hand. */');
  lines.push('window.UK_MAP = {');
  lines.push('  viewBox: "0 0 ' + WIDTH + ' ' + HEIGHT + '",');
  lines.push('  width: ' + WIDTH + ',');
  lines.push('  height: ' + HEIGHT + ',');
  lines.push('  // The Republic of Ireland, drawn as quiet background context. May be null.');
  lines.push('  context: ' + (context ? JSON.stringify(context) : 'null') + ',');
  lines.push('  // One entry per display area, in no particular order.');
  lines.push('  areas: [');
  areas.forEach((a, i) => {
    lines.push('    { id: ' + JSON.stringify(a.id) + ', name: ' + JSON.stringify(a.name) +
      ', path: ' + JSON.stringify(a.path) + ' }' + (i < areas.length - 1 ? ',' : ''));
  });
  lines.push('  ],');
  lines.push('  // The same projection applied to each city, so markers land in the right place.');
  lines.push('  cities: {');
  const cityNames = Object.keys(cities);
  cityNames.forEach((n, i) => {
    lines.push('    ' + JSON.stringify(n) + ': { x: ' + cities[n].x + ', y: ' + cities[n].y + ' }' +
      (i < cityNames.length - 1 ? ',' : ''));
  });
  lines.push('  }');
  lines.push('};');
  lines.push('');
  lines.push('/* Project any latitude/longitude into the same ' + WIDTH + 'x' + HEIGHT + ' viewBox.');
  lines.push('   Lambert conformal conic, standard parallels ' +
    projection.parallels().map(d => Math.round(d * 1e6) / 1e6).join('/') +
    ', central meridian ' + (-ROT) + ', with the');
  lines.push('   scale and translate that d3 fitExtent worked out baked in as constants. */');
  lines.push('window.UK_MAP.project = (function () {');
  lines.push('  var N = ' + num(CONIC_N) + ';          // cone constant');
  lines.push('  var F = ' + num(CONIC_F) + ';          // r at the equator');
  lines.push('  var K = ' + num(K) + ';          // projection scale');
  lines.push('  var TX = ' + num(TX) + ', TY = ' + num(TY) + ';  // projection translate');
  lines.push('  var ROT = ' + num(ROT) + ';            // d3 rotate[0]');
  lines.push('  var DEG = Math.PI / 180, HALF_PI = Math.PI / 2, TWO_PI = Math.PI * 2;');
  lines.push('  return function (lat, lon) {');
  lines.push('    var lambda = (lon + ROT) * DEG;');
  lines.push('    while (lambda > Math.PI) lambda -= TWO_PI;');
  lines.push('    while (lambda < -Math.PI) lambda += TWO_PI;');
  lines.push('    var phi = lat * DEG;');
  lines.push('    var r = F / Math.pow(Math.tan((HALF_PI + phi) / 2), N);');
  lines.push('    var x = r * Math.sin(N * lambda);');
  lines.push('    var y = F - r * Math.cos(N * lambda);');
  lines.push('    return {');
  lines.push('      x: Math.round((x * K + TX) * 10) / 10,');
  lines.push('      y: Math.round((TY - y * K) * 10) / 10');
  lines.push('    };');
  lines.push('  };');
  lines.push('}());');
  lines.push('');

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, lines.join('\n'));

  console.log('wrote', OUT_FILE, (fs.statSync(OUT_FILE).size / 1024).toFixed(1) + ' KB');
  areas.forEach(a => console.log('  ' + a.name.padEnd(22), a.path.length));
  console.log('  context (Ireland)      ' + (context ? context.length : 'none'));
  console.log('  cities:', JSON.stringify(cities));
}

main();
