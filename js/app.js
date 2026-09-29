/* =========================================================================
   Star Cement North East · Know Your Route — application
   Vanilla JS + MapLibre GL. No backend, no API keys, no paid services.
   ========================================================================= */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ boot */
  const need = { maplibregl: window.maplibregl, NE_NET: window.NE_NET, NE_GEO: window.NE_GEO, NE_ATLAS: window.NE_ATLAS, NERouter: window.NERouter };
  const missing = Object.keys(need).filter((k) => !need[k]);
  if (missing.length) {
    const el = document.getElementById("boot-error");
    el.hidden = false;
    el.innerHTML = "<div><b>The atlas couldn't start.</b><br>Missing: " + missing.join(", ") + ".<br>Check that the lib/, data/ and js/ folders were uploaded with index.html.</div>";
    return;
  }

  const ATLAS = window.NE_ATLAS, NET = window.NE_NET, GEO = window.NE_GEO;
  const ROADS = window.NE_ROADS || [], TOLLS = window.NE_TOLLS || [];
  const router = new window.NERouter(NET);
  const hav = window.NERouter.hav;

  /* --------------------------------------------------------------- helpers */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-");
  const isPhone = () => matchMedia("(max-width: 760px)").matches;
  const fmtInt = (n) => Math.round(n).toLocaleString("en-IN");
  const km = (m) => (m < 50 ? "0" : m >= 100000 ? fmtInt(m / 1000) : (m / 1000).toFixed(m < 10000 ? 1 : 0));
  function hm(sec) { const min = Math.max(1, Math.round(sec / 60)); return [Math.floor(min / 60), min % 60]; }
  const durHTML = (sec) => { const [h, m] = hm(sec); return h ? `${h}<small>h</small> ${String(m).padStart(2, "0")}<small>m</small>` : `${m}<small>min</small>`; };
  const durText = (sec) => { const [h, m] = hm(sec); return h ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} min`; };
  function toast(msg, ms = 3200) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
  }
  const theme = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

  /* ------------------------------------------------------ reference data */
  const CAT = Object.assign({ toll: { label: "Toll plazas", color: "#b87d00" } }, ATLAS.categories);
  const SHAPE = { city: "", town: "", node: "sq", bridge: "", border: "dia", toll: "sq", locality: "", station: "sq", shed: "sq", airport: "", district: "sq" };
  const SING = { city: "City", town: "Town", node: "Logistics node", bridge: "Bridge", border: "Border / check post", toll: "Toll plaza", locality: "Post office", road: "Highway", pick: "Map point", station: "Railway station", shed: "Rail goods shed", airport: "Airport", district: "District" };
  const PLUR = { city: "Cities", town: "Towns", node: "Logistics nodes", bridge: "Bridges", border: "Border & check posts", toll: "Toll plazas", locality: "Post offices & PIN areas", road: "Highways", station: "Railway stations", shed: "Rail goods sheds", airport: "Airports", district: "Districts" };
  const EXTRA_COLOR = { station: "#3e4f86", shed: "#8c3f6a", airport: "#0e7ea0", district: "#5d7277" };
  const INFRA = window.NE_INFRA || { rail: [], stations: [], sheds: [], waterways: [], terminals: [], ferries: [], airports: [] };
  const DISTRICTS = window.NE_DISTRICTS || { type: "FeatureCollection", features: [] };
  const LANE_NAMES = NET.lanes || [], AGENCY_NAMES = NET.agencies || [], CORRIDOR_NAMES = NET.corridors || [];
  const floodBand = (n) => (n >= 10 ? 3 : n >= 6 ? 2 : n >= 3 ? 1 : 0);
    const LOC_COLOR = "#8a7f6a";
  const OFFICE_TYPE = ["Head post office", "Sub post office", "Branch post office"];
  const LOC_QUALITY = ["As listed by India Post (may be approximate)", "Centre of its PIN area (approximate)", "Not available: only the district is known"];
  const STATE_ABBR = { "Arunachal Pradesh": "AR", Assam: "AS", Meghalaya: "ML", Manipur: "MN", Mizoram: "MZ", Nagaland: "NL", Tripura: "TR", Sikkim: "SK" };
  const ILP_STATES = ["Arunachal Pradesh", "Nagaland", "Mizoram", "Manipur"];

  const ITEMS = [];            // everything searchable
  const byId = new Map();
  function add(it) { if (!byId.has(it.id)) { ITEMS.push(it); byId.set(it.id, it); } }

  ATLAS.places.forEach((p) => add({ ...p, name: p.name.replace(" (gateway)", ""), kind: "place" }));
  ATLAS.towns.forEach(([name, state, lng, lat]) => {
    const id = slug(name.replace(/\s*\(.*\)/, ""));
    if (byId.has(id)) return;
    add({ id, name, cat: "town", state, lng, lat, kind: "place" });
  });
  TOLLS.forEach((t) => {
    add({ id: "toll-" + slug(t.name.replace(/toll plaza/i, "")), name: t.name, cat: "toll", state: t.state || "", lng: t.lng, lat: t.lat, toll: t, kind: "place" });
  });
  INFRA.stations.forEach(([name, code, type, lng, lat, div]) => add({ id: "stn-" + code.toLowerCase(), name: name + " (" + code + ")", code, stationType: type, division: div, cat: "station", lng, lat, state: "", kind: "place" }));
  INFRA.sheds.forEach(([name, code, div, district, state, lng, lat]) => add({ id: "shed-" + (code || slug(name)).toLowerCase(), name: name.replace(/\s*JN\.?$/i, " Jn") + " goods shed", code, division: div, district, state, cat: "shed", lng, lat, kind: "place" }));
  INFRA.airports.forEach(([name, iata, city, state, lng, lat]) => add({ id: "air-" + iata.toLowerCase(), name, iata, city, state, cat: "airport", lng, lat, kind: "place" }));
  DISTRICTS.features.forEach((f) => {
    const p = f.properties;
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    const walk = (c) => { if (typeof c[0] === "number") { minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]); minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]); } else c.forEach(walk); };
    walk(f.geometry.coordinates);
    add({ id: "dist-" + slug(p.state) + "-" + slug(p.name), name: p.name, state: p.state, floods: p.floods, di: p.i, cat: "district", kind: "district", bbox: [minX, minY, maxX, maxY], lng: (minX + maxX) / 2, lat: (minY + maxY) / 2 });
  });
  const ROAD_ITEMS = [];
  ROADS.forEach((r, idx) => {
    if (!r) return;
    const it = { id: "road-" + r.id, idx, road: r, cat: "road", name: r.ref, kind: "road", state: (r.states || []).join(", ") };
    add(it); ROAD_ITEMS.push(it);
  });
  const POINTS = ITEMS.filter((i) => i.kind === "place");
  const DIST_BY_IDX = new Map(ITEMS.filter((i) => i.cat === "district").map((i) => [i.di, i]));

  // Every post office / PIN code (India Post directory) — searchable, routable, on the map from zoom 9
  const LOCS = [];
  const PINS = new Map();   // pin -> [locality…]
  const LD = window.NE_LOCALITIES;
  if (LD) {
    LD.rows.forEach(([name, pin, di, lng, lat, type, q]) => {
      const [si, district] = LD.districts[di];
      const it = { id: "pin-" + pin + "-" + slug(name), name, pin: String(pin), district, state: LD.states[si], lng, lat, officeType: type, q, cat: "locality", kind: "locality" };
      if (byId.has(it.id)) return;
      add(it); LOCS.push(it);
      if (!PINS.has(it.pin)) PINS.set(it.pin, []);
      PINS.get(it.pin).push(it);
    });
  }
  const refNum = (ref) => { const m = /(\d+)([A-Z]*)/.exec(ref || ""); return m ? +m[1] + (m[2] ? m[2].charCodeAt(0) / 100 : 0) : 9999; };
  const roadClassLabel = { nh: "National Highway", sh: "State Highway", other: "District / major road" };

  function dotColor(cat) { return cat === "pick" ? "var(--ink-3)" : cat === "city" ? "var(--ink)" : cat === "town" ? "var(--ink-2)" : cat === "locality" ? LOC_COLOR : cat === "road" ? "var(--accent)" : EXTRA_COLOR[cat] || (CAT[cat] ? CAT[cat].color : "var(--ink-3)"); }
  function nearestPoint(lnglat, maxKm = 15, cats) {
    let best = null;
    for (const p of POINTS) {
      if (cats && !cats.includes(p.cat)) continue;
      const d = hav(lnglat, [p.lng, p.lat]);
      if (d <= maxKm * 1000 && (!best || d < best.d)) best = { p, d };
    }
    return best;
  }

  function pointInPoly(pt, geom) {
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) {
      let inside = false;
      const ring = poly[0];
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }
  const stateAt = (pt) => { const f = GEO.states.features.find((f) => pointInPoly(pt, f.geometry)); return f ? f.properties.name : null; };
  POINTS.forEach((p) => { if (p.cat === "station" && !p.state) p.state = stateAt([p.lng, p.lat]) || ""; });
  const districtAt = (pt) => { const f = DISTRICTS.features.find((f) => pointInPoly(pt, f.geometry)); return f ? DIST_BY_IDX.get(f.properties.i) : null; };

  /* network statistics per state (for Explore) */
  const STATE_STATS = {};
  const STATE_NH = {};
  let NET_NH_KM = 0;
  router.edges.forEach((e) => {
    if (e.cls === 0) NET_NH_KM += e.len;
    e.states.forEach(([s, m]) => {
      const name = NET.states[s];
      const st = STATE_STATS[name] || (STATE_STATS[name] = { nh: 0, other: 0, hill: 0, total: 0 });
      if (e.cls === 0) {
        st.nh += m;
        const ref = e.ref.split(" / ")[0], tbl = STATE_NH[name] || (STATE_NH[name] = new Map());
        tbl.set(ref, (tbl.get(ref) || 0) + m);
      } else st.other += m;
      st.total += m; st.hill += e.hill * (m / (e.len || 1));
    });
  });
  Object.keys(STATE_NH).forEach((k) => { STATE_NH[k] = [...STATE_NH[k].entries()].filter(([, m]) => m >= 15000).sort((a, b) => b[1] - a[1]); });
  $("#net-km").textContent = fmtInt(NET_NH_KM / 1000);
  if ($("#pin-count")) $("#pin-count").textContent = fmtInt(PINS.size);
  if ($("#pin-routable")) $("#pin-routable").textContent = fmtInt(new Set(LOCS.filter((x) => x.q < 2).map((x) => x.pin)).size);

  /* ======================================================================
     MAP
     ====================================================================== */
  // Labels: glyphs are bundled in data/glyphs.js and served through a custom protocol
  const b64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  const glyphCache = new Map();
  maplibregl.addProtocol("glyphs", async (params) => {
    const m = /glyphs:\/\/(.+)\/(\d+-\d+)\.pbf/.exec(params.url);
    const font = m ? decodeURIComponent(m[1]).split(",")[0] : "";
    const key = font + "/" + (m ? m[2] : "");
    if (!glyphCache.has(key)) glyphCache.set(key, window.NE_GLYPHS && window.NE_GLYPHS[key] ? b64(window.NE_GLYPHS[key]) : new ArrayBuffer(0));
    return { data: glyphCache.get(key) };
  });

  const PAL = {
    light: {
      water: "#d5e1e5", land: "#e9edee", india: "#eef1f2", ne: "#fbfcfc", neHover: "#f1f6f5", neSel: "#e8f1ef",
      intl: "#8f9ea2", stateLine: "#b3bec1", river: "#a9c5d1", riverLabel: "#6b92a3",
      nh: "#27373c", sh: "#a2b0b4", other: "#c5ced1", trace: "#1f6f8b",
      routeCase: "#172226", route: "#f2b01e", access: "#172226",
      label: "#172226", label2: "#4b5c61", halo: "#fbfcfc", stateLabel: "#9aa8ac", countryLabel: "#a9b4b7",
      city: "#172226", town: "#4b5c61", pinStroke: "#ffffff",
      rail: "#56607a", wway: "#5b95b3", ferry: "#3f7fa3", distLine: "#c9d2d4", distLabel: "#8e9da1",
      flood: ["rgba(0,0,0,0)", "#cfe3ec", "#8fbfd6", "#4c93b8"],
      reach: ["#1b7f5a", "#6aa84f", "#d9b23a", "#d97a2b", "#b8412e"]
    },
    dark: {
      water: "#0a1113", land: "#10181b", india: "#121c1f", ne: "#172327", neHover: "#1b2a2f", neSel: "#1e3036",
      intl: "#4a5d62", stateLine: "#34464b", river: "#23495a", riverLabel: "#4f7e90",
      nh: "#b4c3c6", sh: "#4e6066", other: "#34454a", trace: "#6cc3dc",
      routeCase: "#0a1113", route: "#f2b01e", access: "#e5edee",
      label: "#e5edee", label2: "#a5b4b7", halo: "#172327", stateLabel: "#5d7277", countryLabel: "#50626a",
      city: "#e5edee", town: "#a5b4b7", pinStroke: "#10181b",
      rail: "#8d97b3", wway: "#3f7f9e", ferry: "#4f93b8", distLine: "#26363b", distLabel: "#5d7277",
      flood: ["rgba(0,0,0,0)", "#1d3a47", "#24546a", "#2f6f8f"],
      reach: ["#3fbf8a", "#8bc86a", "#e2c25a", "#e8924a", "#e0604a"]
    }
  };

  // GeoJSON built once
  const FC = (features) => ({ type: "FeatureCollection", features });
  const roadsFC = FC(router.edges.map((e) => ({
    type: "Feature", id: e.i,
    properties: { e: e.i, cls: e.cls, ref: e.ref === "link" ? "" : e.ref.split(" / ")[0], approx: e.approx ? 1 : 0, road: e.roads.length ? e.roads[0] : -1, lanes: e.lanes.length ? e.lanes[0][0] : 0 },
    geometry: { type: "LineString", coordinates: e.coords }
  })));
  const dec = window.NERouter.decode;
  const railFC = FC(INFRA.rail.map((enc) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: dec(enc) } })));
  const waterFC = FC(INFRA.waterways.map(([w, d, enc]) => ({ type: "Feature", properties: { name: w }, geometry: { type: "LineString", coordinates: dec(enc) } })));
  const ferryFC = FC(INFRA.ferries.map(([d, enc]) => ({ type: "Feature", properties: { district: d }, geometry: { type: "LineString", coordinates: dec(enc) } })));
  const locsFC = FC(LOCS.map((p, i) => ({
    type: "Feature", id: i,
    properties: { id: p.id, name: p.name, pin: p.pin, q: p.q, t: p.officeType },
    geometry: { type: "Point", coordinates: [p.lng, p.lat] }
  })));
  const pointsFC = FC(POINTS.map((p, i) => ({
    type: "Feature", id: i,
    properties: { id: p.id, cat: p.cat, name: p.cat === "station" ? p.name.replace(/\s*\([A-Z]+\)$/, "") : p.name, icon: "pin-" + p.cat, jn: p.stationType === "Junction" ? 1 : 0 },
    geometry: { type: "Point", coordinates: [p.lng, p.lat] }
  })));

  const S = {
    base: "atlas",
    layers: { nh: true, sh: true, city: true, town: true, node: true, bridge: true, border: true, toll: true, locality: true, rail: true, water: true, airport: true, districts: true, flood: false },
    reachFC: FC([]),
    route: null, routeFC: FC([]), accessFC: FC([]), traceFC: FC([]), stateSel: null,
    od: { from: null, to: null }, mode: "car", markers: {}, hoverState: null
  };

  function overlay(t, street) {
    const P = PAL[t];
    const sources = {
      countries: { type: "geojson", data: GEO.countries },
      states: { type: "geojson", data: GEO.states, generateId: true },
      rivers: { type: "geojson", data: GEO.rivers },
      stateLabels: { type: "geojson", data: GEO.stateLabels },
      countryLabels: { type: "geojson", data: GEO.countryLabels },
      roads: { type: "geojson", data: roadsFC },
      points: { type: "geojson", data: pointsFC },
      locs: { type: "geojson", data: locsFC },
      rail: { type: "geojson", data: railFC },
      water: { type: "geojson", data: waterFC },
      ferries: { type: "geojson", data: ferryFC },
      districts: { type: "geojson", data: DISTRICTS, promoteId: "i" },
      reach: { type: "geojson", data: S.reachFC },
      route: { type: "geojson", data: S.routeFC },
      access: { type: "geojson", data: S.accessFC },
      trace: { type: "geojson", data: S.traceFC }
    };
    const vis = (on) => (on ? "visible" : "none");
    const catFilter = (cats) => ["in", ["get", "cat"], ["literal", cats.filter((c) => (c === "station" || c === "shed" ? S.layers.rail : S.layers[c]))]];
    const font = ["Noto Sans Regular"];
    const L = [];
    if (!street) {
      L.push(
        { id: "bg", type: "background", paint: { "background-color": P.water } },
        { id: "countries", type: "fill", source: "countries", paint: { "fill-color": ["case", ["get", "india"], P.india, P.land] } },
        { id: "states-fill", type: "fill", source: "states", filter: ["==", ["get", "ne"], true],
          paint: { "fill-color": ["case", ["boolean", ["feature-state", "sel"], false], P.neSel, ["boolean", ["feature-state", "hover"], false], P.neHover, P.ne] } },
        { id: "flood-fill", type: "fill", source: "districts", layout: { visibility: vis(S.layers.flood) },
          paint: { "fill-color": ["match", ["case", [">=", ["get", "floods"], 10], 3, [">=", ["get", "floods"], 6], 2, [">=", ["get", "floods"], 3], 1, 0], 3, P.flood[3], 2, P.flood[2], 1, P.flood[1], P.flood[0]], "fill-opacity": 0.75 } },
        { id: "rivers", type: "line", source: "rivers", paint: { "line-color": P.river, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.8, 9, 2.4] } },
        { id: "district-lines", type: "line", source: "districts", minzoom: 6.3, layout: { visibility: vis(S.layers.districts) }, paint: { "line-color": P.distLine, "line-width": ["interpolate", ["linear"], ["zoom"], 6.3, 0.4, 10, 1] } },
        { id: "state-lines", type: "line", source: "states", paint: { "line-color": P.stateLine, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 10, 1.3], "line-dasharray": [3, 2] } },
        { id: "intl-lines", type: "line", source: "countries", filter: ["!", ["get", "india"]], paint: { "line-color": P.intl, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.9, 10, 1.8] } }
      );
    } else {
      L.push({ id: "state-lines", type: "line", source: "states", filter: ["==", ["get", "ne"], true], paint: { "line-color": P.intl, "line-width": 1.2, "line-dasharray": [3, 2], "line-opacity": 0.7 } });
    }
    const roadOpacity = street ? 0.35 : 1;
    const laneW = (z5, z8, z12) => ["interpolate", ["linear"], ["zoom"],
      5, ["match", ["get", "lanes"], 5, z5 * 1.6, 4, z5 * 1.45, 1, z5 * 0.6, 2, z5 * 0.75, z5],
      8, ["match", ["get", "lanes"], 5, z8 * 1.7, 4, z8 * 1.5, 1, z8 * 0.55, 2, z8 * 0.72, z8],
      12, ["match", ["get", "lanes"], 5, z12 * 1.7, 4, z12 * 1.5, 1, z12 * 0.55, 2, z12 * 0.72, z12]];
    L.push(
      { id: "waterways", type: "line", source: "water", layout: { visibility: vis(S.layers.water), "line-cap": "round" }, paint: { "line-color": P.wway, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.4, 10, 3.5], "line-dasharray": [2, 1.5], "line-opacity": 0.8 } },
      { id: "ferries", type: "line", source: "ferries", minzoom: 8.5, layout: { visibility: vis(S.layers.water) }, paint: { "line-color": P.ferry, "line-width": 1.6, "line-dasharray": [1, 1.2] } },
      { id: "rail-case", type: "line", source: "rail", layout: { visibility: vis(S.layers.rail) }, paint: { "line-color": P.rail, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 10, 3.2], "line-opacity": 0.85 } },
      { id: "rail-ties", type: "line", source: "rail", minzoom: 7.5, layout: { visibility: vis(S.layers.rail) }, paint: { "line-color": P.halo, "line-width": ["interpolate", ["linear"], ["zoom"], 7.5, 0.6, 10, 1.8], "line-dasharray": [2.5, 2.5] } },
      { id: "roads-minor", type: "line", source: "roads", filter: ["!=", ["get", "cls"], 0], layout: { visibility: vis(S.layers.sh), "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["case", ["==", ["get", "cls"], 1], P.sh, P.other], "line-opacity": roadOpacity, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 9, 1.6, 12, 3] } },
      { id: "roads-nh", type: "line", source: "roads", filter: ["all", ["==", ["get", "cls"], 0], ["==", ["get", "approx"], 0]], layout: { visibility: vis(S.layers.nh), "line-cap": "round", "line-join": "round" },
        paint: { "line-color": P.nh, "line-opacity": roadOpacity, "line-width": laneW(0.9, 2, 4.5) } },
      { id: "roads-approx", type: "line", source: "roads", filter: ["==", ["get", "approx"], 1], layout: { visibility: vis(S.layers.nh) },
        paint: { "line-color": P.nh, "line-opacity": roadOpacity, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.9, 8, 2, 12, 4], "line-dasharray": [1.2, 1.2] } },
      { id: "roads-hit", type: "line", source: "roads", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 12 } },
      { id: "trace-glow", type: "line", source: "trace", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": P.trace, "line-opacity": 0.22, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 7, 10, 14] } },
      { id: "trace", type: "line", source: "trace", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": P.trace, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2.2, 10, 4.5] } },
      { id: "reach", type: "line", source: "reach", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["match", ["get", "band"], 0, P.reach[0], 1, P.reach[1], 2, P.reach[2], 3, P.reach[3], P.reach[4]], "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2.2, 10, 5.5], "line-opacity": 0.95 } },
      { id: "access", type: "line", source: "access", paint: { "line-color": P.access, "line-width": 1.6, "line-dasharray": [1, 1.6] } },
      { id: "route-case", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": P.routeCase, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 6, 10, 11] } },
      { id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": P.route, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3, 10, 6.5] } },
      { id: "nh-labels", type: "symbol", source: "roads", minzoom: 6.6, filter: ["all", ["==", ["get", "cls"], 0], ["!=", ["get", "ref"], ""]],
        layout: { visibility: vis(S.layers.nh), "symbol-placement": "line", "symbol-spacing": 320, "text-field": ["get", "ref"], "text-font": font, "text-size": ["interpolate", ["linear"], ["zoom"], 7, 10, 11, 12], "text-letter-spacing": 0.04, "text-keep-upright": true, "text-max-angle": 30, "text-padding": 6 },
        paint: { "text-color": P.label, "text-halo-color": P.halo, "text-halo-width": 2.2 } },
      { id: "river-labels", type: "symbol", source: "rivers", minzoom: 6.8, filter: ["!=", ["get", "name"], ""],
        layout: { "symbol-placement": "line", "symbol-spacing": 500, "text-field": ["get", "name"], "text-font": ["Noto Sans Italic"], "text-size": 11, "text-letter-spacing": 0.08 },
        paint: { "text-color": P.riverLabel, "text-halo-color": P.halo, "text-halo-width": 1.5 } },
      { id: "locs", type: "circle", source: "locs", minzoom: 8.3, filter: ["!=", ["get", "q"], 2], layout: { visibility: vis(S.layers.locality) },
        paint: { "circle-color": LOC_COLOR, "circle-radius": ["interpolate", ["linear"], ["zoom"], 8.3, 1.6, 12, 3.6], "circle-stroke-color": P.halo, "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 8.3, 0.4, 12, 1.2], "circle-opacity": ["interpolate", ["linear"], ["zoom"], 8.3, 0, 9, 0.9] } },
      { id: "loc-labels", type: "symbol", source: "locs", minzoom: 10.6, filter: ["!=", ["get", "q"], 2], layout: { visibility: vis(S.layers.locality), "text-field": ["get", "name"], "text-font": font, "text-size": 10.5, "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 0.5, "text-justify": "auto", "text-max-width": 9 },
        paint: { "text-color": P.label2, "text-halo-color": P.halo, "text-halo-width": 1.6 } },
      { id: "junctions", type: "symbol", source: "points", minzoom: 6.4, filter: ["all", catFilter(["station"]), ["==", ["get", "jn"], 1]],
        layout: { "icon-image": "pin-station", "icon-size": 0.85, "icon-allow-overlap": true } },
      { id: "stations", type: "symbol", source: "points", minzoom: 9, filter: ["all", catFilter(["station"]), ["==", ["get", "jn"], 0]],
        layout: { "icon-image": "pin-station", "icon-size": 0.75, "icon-allow-overlap": false, "text-field": ["get", "name"], "text-font": font, "text-size": 10.5, "text-variable-anchor": ["left", "right"], "text-radial-offset": 0.6, "text-optional": true },
        paint: { "text-color": P.label2, "text-halo-color": P.halo, "text-halo-width": 1.6 } },
      { id: "points", type: "symbol", source: "points", filter: ["all", catFilter(["node", "bridge", "border", "toll", "shed", "airport"])],
        layout: { "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.75, 9, 1], "icon-allow-overlap": true, "symbol-sort-key": ["match", ["get", "cat"], "border", 1, "bridge", 2, "node", 3, 4] } },
      { id: "towns", type: "symbol", source: "points", minzoom: 6.9, filter: catFilter(["town"]),
        layout: { "icon-image": "pin-town", "icon-allow-overlap": false, "text-field": ["get", "name"], "text-font": font, "text-size": 11.5, "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 0.65, "text-justify": "auto", "text-optional": true },
        paint: { "text-color": P.label2, "text-halo-color": P.halo, "text-halo-width": 1.8 } },
      { id: "cities", type: "symbol", source: "points", filter: catFilter(["city"]),
        layout: { "icon-image": "pin-city", "icon-allow-overlap": true, "text-field": ["get", "name"], "text-font": font, "text-size": ["interpolate", ["linear"], ["zoom"], 5, 11.5, 9, 14], "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 0.7, "text-justify": "auto", "text-optional": true },
        paint: { "text-color": P.label, "text-halo-color": P.halo, "text-halo-width": 2 } },
      { id: "point-labels", type: "symbol", source: "points", minzoom: 8.6, filter: catFilter(["node", "bridge", "border", "toll", "shed", "airport"]),
        layout: { "text-field": ["get", "name"], "text-font": font, "text-size": 11, "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 0.8, "text-justify": "auto", "text-max-width": 10 },
        paint: { "text-color": P.label2, "text-halo-color": P.halo, "text-halo-width": 1.8 } }
    );
    if (!street) {
      L.push(
        { id: "district-labels", type: "symbol", source: "districts", minzoom: 7.6, maxzoom: 10.5, layout: { visibility: vis(S.layers.districts), "text-field": ["upcase", ["get", "name"]], "text-font": font, "text-size": 10, "text-letter-spacing": 0.18, "text-max-width": 8, "symbol-placement": "point", "text-padding": 20 },
          paint: { "text-color": P.distLabel, "text-halo-color": P.ne, "text-halo-width": 1 } },
        { id: "state-labels", type: "symbol", source: "stateLabels", maxzoom: 8.4,
          layout: { "text-field": ["get", "name"], "text-font": font, "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10.5, 8, 14], "text-letter-spacing": 0.32, "text-max-width": 7, "text-allow-overlap": false },
          paint: { "text-color": P.stateLabel, "text-halo-color": P.ne, "text-halo-width": 1 } },
        { id: "country-labels", type: "symbol", source: "countryLabels", maxzoom: 8,
          layout: { "text-field": ["get", "name"], "text-font": font, "text-size": 12, "text-letter-spacing": 0.4 },
          paint: { "text-color": P.countryLabel } }
      );
    }
    return { sources, layers: L };
  }

  function atlasStyle() {
    const o = overlay(theme(), false);
    return { version: 8, glyphs: "glyphs://{fontstack}/{range}.pbf", sources: o.sources, layers: o.layers };
  }

  /* icons drawn on canvas so they stay crisp and need no image files */
  function makeIcon(cat) {
    const P = PAL[theme()], r = 2, size = cat === "town" ? 10 : cat === "city" ? 14 : 16;
    const c = document.createElement("canvas"); c.width = c.height = size * r;
    const g = c.getContext("2d"); g.scale(r, r);
    const col = cat === "city" ? P.city : cat === "town" ? P.town : EXTRA_COLOR[cat] || (CAT[cat] ? CAT[cat].color : "#555");
    g.fillStyle = col; g.strokeStyle = P.pinStroke; g.lineWidth = 1.8;
    const m = size / 2;
    g.beginPath();
    if (cat === "station" || cat === "shed") { const s = cat === "station" ? 4 : 5; g.roundRect ? g.roundRect(m - s, m - s, 2 * s, 2 * s, cat === "station" ? 1 : 2.5) : g.rect(m - s, m - s, 2 * s, 2 * s); }
    else if (cat === "airport") { g.arc(m, m, 5.6, 0, Math.PI * 2); g.fill(); g.stroke(); g.beginPath(); g.fillStyle = P.pinStroke; g.moveTo(m, m - 3.6); g.lineTo(m + 1, m + 2.8); g.lineTo(m, m + 1.8); g.lineTo(m - 1, m + 2.8); g.closePath(); }
    else if (cat === "node" || cat === "toll") { const s = 5; g.roundRect ? g.roundRect(m - s, m - s, 2 * s, 2 * s, cat === "node" ? 2.5 : 1.2) : g.rect(m - s, m - s, 2 * s, 2 * s); }
    else if (cat === "border") { g.moveTo(m, m - 6); g.lineTo(m + 6, m); g.lineTo(m, m + 6); g.lineTo(m - 6, m); g.closePath(); }
    else { g.arc(m, m, cat === "town" ? 3 : cat === "city" ? 4.6 : 5.2, 0, Math.PI * 2); }
    g.fill(); g.stroke();
    if (cat === "bridge") { g.beginPath(); g.fillStyle = P.pinStroke; g.arc(m, m, 1.8, 0, Math.PI * 2); g.fill(); }
    return { width: c.width, height: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
  }
  function addIcons() {
    ["city", "town", "node", "bridge", "border", "toll", "station", "shed", "airport"].forEach((k) => {
      const id = "pin-" + k;
      if (map.hasImage(id)) map.removeImage(id);
      map.addImage(id, makeIcon(k), { pixelRatio: 2 });
    });
  }

  const REGION_BOUNDS = [[GEO.bounds[0], GEO.bounds[1]], [GEO.bounds[2], GEO.bounds[3]]];
  function padding() {
    if (isPhone()) return { top: 60, left: 24, right: 24, bottom: Math.round(innerHeight * 0.52) + 10 };
    const w = $("#panel").getBoundingClientRect().width;
    return { top: 50, left: w + 44, right: 70, bottom: 40 };
  }

  const map = new maplibregl.Map({
    container: "map",
    style: atlasStyle(),
    bounds: REGION_BOUNDS,
    fitBoundsOptions: { padding: padding() },
    maxBounds: [[82.5, 17.5], [102.5, 32.5]],
    minZoom: 4.3, maxZoom: 15,
    attributionControl: false,
    dragRotate: false, pitchWithRotate: false, touchPitch: false,
    fadeDuration: 150
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Roads © <a href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener'>OpenStreetMap contributors</a> · States © DataMeet · Natural Earth · Tolls: NHAI" }), "bottom-right");
  map.on("styleimagemissing", (e) => { if (e.id.startsWith("pin-")) { map.addImage(e.id, makeIcon(e.id.slice(4)), { pixelRatio: 2 }); } });
  map.on("load", () => { addIcons(); wireMap(); applyHash(); addEventListener("hashchange", applyHash); });

  function refreshStyle() {
    map.setStyle(atlasStyle(), { diff: false });
    map.once("styledata", addIcons);
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", refreshStyle);

  function setData(src, fc) { const s = map.getSource(src); if (s) s.setData(fc); }

  /* ---------------------------------------------------- map interactions */
  let hoverPopup = null;
  function wireMap() {
    const interactive = ["points", "junctions", "stations", "cities", "towns", "locs", "roads-hit"];
    hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "hover-tip", offset: 10 });

    map.on("mousemove", (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: interactive.filter((l) => map.getLayer(l)) })[0];
      map.getCanvas().style.cursor = f ? "pointer" : "";
      if (f && f.layer.id === "roads-hit") {
        const e2 = router.edges[f.properties.e];
        const r = e2.roads.length ? ROADS[e2.roads[0]] : null;
        hoverPopup.setLngLat(e.lngLat).setHTML(esc(e2.ref === "link" ? "Connector" : e2.ref) + (r && r.name ? " · " + esc(r.name) : "")).addTo(map);
      } else if (f && f.layer.id === "locs") {
        hoverPopup.setLngLat(f.geometry.coordinates).setHTML(esc(f.properties.name) + " · <span class='num'>" + f.properties.pin + "</span>").addTo(map);
      } else hoverPopup.remove();
      // state hover
      if (S.base === "atlas" && map.getLayer("states-fill")) {
        const sf = map.queryRenderedFeatures(e.point, { layers: ["states-fill"] })[0];
        const id = sf ? sf.id : null;
        if (id !== S.hoverState) {
          if (S.hoverState != null) map.setFeatureState({ source: "states", id: S.hoverState }, { hover: false });
          if (id != null) map.setFeatureState({ source: "states", id }, { hover: true });
          S.hoverState = id;
        }
      }
    });
    map.on("mouseout", () => hoverPopup && hoverPopup.remove());

    map.on("click", (e) => {
      const f = map.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]], { layers: interactive.filter((l) => map.getLayer(l)) })[0];
      if (f && f.layer.id !== "roads-hit") return openItem(f.properties.id);
      if (f && f.layer.id === "roads-hit") {
        const e2 = router.edges[f.properties.e];
        if (e2.roads.length && ROADS[e2.roads[0]]) return openItem("road-" + ROADS[e2.roads[0]].id, { lngLat: e.lngLat });
      }
      pickPopup(e.lngLat);
    });
  }

  let pickPop = null;
  function pickPopup(ll) {
    const pt = [ll.lng, ll.lat];
    const nl = null;
    const near = nearestPoint(pt, 20, ["city", "town"]);
    const st = stateAt(pt);
    const label = near ? (near.d < 1500 ? near.p.name : "Near " + near.p.name) : "Selected point";
    const pinTxt = nl ? ` · PIN <span class="num">${nl.p.pin}</span>` : "";
    const dAt = districtAt(pt);
    const el = document.createElement("div");
    el.className = "pick";
    el.innerHTML = `<div class="where"><b>${esc(label)}</b>${pinTxt}${st ? "<br>" + esc((dAt ? dAt.name : nl ? nl.p.district : "") ? (dAt ? dAt.name : nl.p.district) + ", " + st : st) : ""}<div class="coords">${ll.lat.toFixed(4)}°N, ${ll.lng.toFixed(4)}°E</div></div>
      <div class="row"><button class="btn btn-quiet btn-sm" data-k="from">Start here</button><button class="btn btn-quiet btn-sm" data-k="to">End here</button><button class="btn btn-quiet btn-sm" data-k="reach">Reach</button></div>`;
    const obj = { id: "p" + ll.lat.toFixed(4) + "_" + ll.lng.toFixed(4), name: label === "Selected point" ? `${ll.lat.toFixed(3)}, ${ll.lng.toFixed(3)}` : label + (nl ? " (" + nl.p.pin + ")" : ""), lng: ll.lng, lat: ll.lat, cat: "pick" };
    $$("button", el).forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.k === "reach") { pickPop.remove(); showReach([ll.lng, ll.lat], obj.name); return; }
      setEnd(b.dataset.k, obj);
      pickPop.remove();
      if (S.od.from && S.od.to) runRoute(); else { showTab("route"); toast(b.dataset.k === "from" ? "Start set. Now choose where to go." : "End set. Now choose a start."); }
    }));
    if (pickPop) pickPop.remove();
    pickPop = new maplibregl.Popup({ offset: 8, maxWidth: "260px" }).setLngLat(ll).setDOMContent(el).addTo(map);
    if (isPhone()) setSheet("peek");
  }

  /* ======================================================================
     PANEL
     ====================================================================== */
  function showTab(name) {
    $$(".tab").forEach((b) => { const on = b.dataset.tab === name; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on); });
    $$(".pane").forEach((p) => (p.hidden = p.id !== "tab-" + name));
    $("#panel-body").scrollTop = 0;
  }
  $$(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  function setSheet(m) { $("#panel").dataset.sheet = m; }
  $("#sheet-handle").addEventListener("click", () => {
    const c = $("#panel").dataset.sheet;
    setSheet(c === "peek" ? "mid" : c === "mid" ? "full" : "peek");
  });

  /* -------------------------------------------------- route inputs */
  const ROUTABLE = POINTS.filter((p) => p.cat !== "toll").concat(LOCS.filter((x) => x.q < 2));
  function matches(q) {
    q = q.trim().toLowerCase();
    if (!q) return ROUTABLE.filter((p) => p.cat === "city").slice(0, 9);
    const ll = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
    if (ll) {
      let a = +ll[1], b = +ll[2]; if (a > 60) [a, b] = [b, a];
      return [{ id: "p" + a.toFixed(4) + "_" + b.toFixed(4), name: a.toFixed(4) + ", " + b.toFixed(4), lat: a, lng: b, cat: "pick", state: "Coordinates" }];
    }
    const rank = { city: 0, town: 1, node: 2, border: 3, bridge: 4, airport: 5, station: 6, shed: 7, locality: 8 };
    if (/^\d{2,6}$/.test(q)) {   // PIN code lookup
      return LOCS.filter((p) => p.q < 2 && p.pin.startsWith(q)).sort((a, b) => a.pin.localeCompare(b.pin) || a.officeType - b.officeType || a.q - b.q || a.name.localeCompare(b.name)).slice(0, 40);
    }
    return ROUTABLE.map((p) => {
      const n = p.name.toLowerCase();
      let s = n === q ? 0 : n.startsWith(q) ? 1 : n.split(/[\s(–-]+/).some((w) => w.startsWith(q)) ? 2 : n.includes(q) ? 3 : 9;
      if (s === 9 && p.district && p.district.toLowerCase().startsWith(q)) s = 4;
      if (s === 9 && q.length > 3 && (p.state || "").toLowerCase().startsWith(q)) s = 5;
      return { p, s };
    }).filter((x) => x.s < 9).sort((a, b) => a.s - b.s || rank[a.p.cat] - rank[b.p.cat] || (a.p.officeType ?? 0) - (b.p.officeType ?? 0) || (a.p.q ?? 0) - (b.p.q ?? 0) || a.p.name.localeCompare(b.p.name)).slice(0, 40).map((x) => x.p);
  }
  function combo(input, key) {
    const list = input.parentElement.querySelector(".suggest");
    let items = [], act = -1;
    const render = () => {
      items = matches(input.value); act = -1;
      list.innerHTML = items.length ? items.map((p, i) => `<li role="option" data-i="${i}"><span class="dot" style="background:${dotColor(p.cat)}"></span><span><div class="s-name">${esc(p.name)}${p.pin ? ` <span class="pin">${p.pin}</span>` : ""}</div><div class="s-sub">${esc(p.cat === "pick" ? "Coordinates" : p.cat === "locality" ? p.district + ", " + p.state : SING[p.cat] + (p.state ? " · " + p.state : ""))}</div></span></li>`).join("")
        : `<li class="empty">${/^\d{6}$/.test(input.value.trim()) && PINS.has(input.value.trim()) ? `PIN ${input.value.trim()} has no mapped location (only its district is known). Try a nearby town or click the map.` : "No match. Try a PIN code, a nearby town, or click the map."}</li>`;
      list.hidden = false;
    };
    const choose = (i) => { const p = items[i]; if (!p) return; setEnd(key, p.cat === "locality" ? { ...p, name: p.name + " (" + p.pin + ")" } : p); list.hidden = true; if (key === "from") $("#destination").focus(); };
    input.addEventListener("focus", render);
    input.addEventListener("input", () => { S.od[key] = null; render(); });
    input.addEventListener("keydown", (e) => {
      if (list.hidden) return;
      if (e.key === "ArrowDown") { act = Math.min(items.length - 1, act + 1); e.preventDefault(); }
      else if (e.key === "ArrowUp") { act = Math.max(0, act - 1); e.preventDefault(); }
      else if (e.key === "Enter") { if (act < 0 && items.length) act = 0; if (act >= 0) { choose(act); e.preventDefault(); } return; }
      else if (e.key === "Escape") { list.hidden = true; return; }
      $$("li", list).forEach((li, i) => li.setAttribute("aria-selected", i === act));
    });
    list.addEventListener("mousedown", (e) => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); choose(+li.dataset.i); } });
    input.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 120));
  }
  combo($("#origin"), "from");
  combo($("#destination"), "to");

  function setEnd(key, p) {
    S.od[key] = { id: p.id, name: p.name, lng: p.lng, lat: p.lat };
    (key === "from" ? $("#origin") : $("#destination")).value = p.name;
  }
  function resolve(key) {
    if (S.od[key]) return S.od[key];
    const v = (key === "from" ? $("#origin") : $("#destination")).value.trim();
    if (!v) return null;
    const m = matches(v)[0];
    if (m) { setEnd(key, m); return S.od[key]; }
    return null;
  }

  $("#swap").addEventListener("click", () => {
    const a = S.od.from, b = S.od.to, va = $("#origin").value, vb = $("#destination").value;
    S.od.from = b; S.od.to = a; $("#origin").value = vb; $("#destination").value = va;
    if (S.route) runRoute();
  });
  function setMode(mode, quiet) {
    S.mode = mode;
    $$("[data-mode]").forEach((x) => { const on = x.dataset.mode === mode; x.classList.toggle("is-on", on); x.setAttribute("aria-checked", on); });
    if (S.route && !quiet) runRoute();
  }
  $$("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("#route-form").addEventListener("submit", (e) => { e.preventDefault(); runRoute(); });

  $("#sample-routes").innerHTML = ATLAS.sampleRoutes.map(([a, b]) => {
    const pa = byId.get(a), pb = byId.get(b);
    return pa && pb ? `<button type="button" class="chip" data-a="${a}" data-b="${b}">${esc(pa.name)} → ${esc(pb.name)}</button>` : "";
  }).join("");
  $("#sample-routes").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    setEnd("from", byId.get(c.dataset.a)); setEnd("to", byId.get(c.dataset.b)); runRoute();
  });

  /* -------------------------------------------------- routing */
  function odMarker(kind, ll) {
    if (S.markers[kind]) S.markers[kind].remove();
    const el = document.createElement("div");
    el.className = "od-marker " + kind; el.textContent = kind === "a" ? "A" : "B";
    S.markers[kind] = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map);
  }
  function clearRoute() {
    S.route = null; S.routeFC = FC([]); S.accessFC = FC([]);
    setData("route", S.routeFC); setData("access", S.accessFC);
    ["a", "b"].forEach((k) => { if (S.markers[k]) { S.markers[k].remove(); S.markers[k] = null; } });
    $("#route-result").hidden = true; $("#samples").hidden = false;
    history.replaceState(null, "", location.pathname + location.search);
  }

  function runRoute() {
    const a = resolve("from"), b = resolve("to");
    if (!a || !b) { toast(!a && !b ? "Choose a start and an end." : !a ? "Choose a start point." : "Choose an end point."); return; }
    if (a.id === b.id) { toast("Start and end are the same place."); return; }
    showTab("route");
    const box = $("#route-result");
    box.hidden = false; $("#samples").hidden = true;
    box.innerHTML = `<div class="rr-state"><span class="spinner"></span>Calculating route…</div>`;
    $("#info-card").hidden = true;
    setTimeout(() => {
      const t0 = performance.now();
      const r = router.route([a.lng, a.lat], [b.lng, b.lat], S.mode);
      if (!r) {
        box.innerHTML = `<div class="rr-state err"><div><b>No route found</b><p>One of these points isn't connected to the mapped road network. Try a nearby town.</p></div></div>`;
        return;
      }
      r.ms = performance.now() - t0;
      // last-mile: points off the highway network reach it over local roads (estimated)
      const acc0 = r.snapFrom.dist > 150 ? r.snapFrom.dist * 1.3 : 0, acc1 = r.snapTo.dist > 150 ? r.snapTo.dist * 1.3 : 0;
      r.hwDistance = r.distance; r.accessStart = acc0; r.access = acc0 + acc1;
      r.distance += r.access; r.car += r.access / (30 / 3.6); r.truck += r.access / (20 / 3.6);
      S.route = r;
      S.routeFC = FC([{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r.path } }]);
      const acc = [];
      if (r.snapFrom.dist > 150) acc.push([[a.lng, a.lat], r.snapFrom.point]);
      if (r.snapTo.dist > 150) acc.push([r.snapTo.point, [b.lng, b.lat]]);
      S.accessFC = FC(acc.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: c } })));
      setData("route", S.routeFC); setData("access", S.accessFC);
      S.traceFC = FC([]); setData("trace", S.traceFC);
      odMarker("a", [a.lng, a.lat]); odMarker("b", [b.lng, b.lat]);
      const bb = new maplibregl.LngLatBounds();
      r.path.forEach((p) => bb.extend(p)); bb.extend([a.lng, a.lat]); bb.extend([b.lng, b.lat]);
      map.fitBounds(bb, { padding: padding(), duration: 700, maxZoom: 11 });
      renderRoute(a, b, r);
      history.replaceState(null, "", "#" + [a.id, b.id, S.mode].join("~"));
      if (isPhone()) setSheet("mid");
    }, 20);
  }

  function alongRoute(r, a, b) {
    const scale = r.hwDistance / (r.cumPath[r.cumPath.length - 1] || 1);
    const out = [];
    const radius = { toll: 400, city: 4000 };
    for (const p of POINTS) {
      if (!radius[p.cat] || p.id === a.id || p.id === b.id) continue;
      const hit = window.NERouter.nearPath([p.lng, p.lat], r.path, r.cumPath, radius[p.cat]);
      if (hit && p.cat === "toll") {
        // a toll counts only if the route runs on the road it sits on (not a road passing close by)
        if (p._snapD === undefined) { const sn = router.snap([p.lng, p.lat]); p._snapD = sn ? sn.dist : 0; }
        if (hit.d > p._snapD + 50) continue;
      }
      if (hit) out.push({ p, at: hit.at * scale + r.accessStart });
    }
    // drop cities right at the start/end
    return out.filter((x) => !(x.p.cat === "city" && (x.at < 5000 || r.distance - x.at < 5000))).sort((x, y) => x.at - y.at);
  }

  /* ---------------- route sheet: the route broken into highway legs, IRCTC-timetable style */
  const TOWNISH = POINTS.filter((p) => ["city", "town"].includes(p.cat));
  function nameAt(pt, exclude) {
    let best = null;
    for (const p of TOWNISH) {
      if (exclude && exclude.has(p.id)) continue;
      const d = hav(pt, [p.lng, p.lat]);
      if (d < 10000 && (!best || d < best.d)) best = { p, d };
    }
    if (best) return { name: best.d < 2500 ? best.p.name : "Near " + best.p.name, id: best.p.id, sub: best.p.state };
    return null;
  }
  function laneText(lanes) {
    const tot = lanes.reduce((x, [, m]) => x + m, 0);
    if (!tot) return "";
    const sorted = lanes.filter(([k]) => k).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return "Lanes not recorded";
    const [k0, m0] = sorted[0];
    const rest = sorted.slice(1).filter(([, m]) => m >= 3000);
    return LANE_NAMES[k0] + (rest.length ? ` (${rest.map(([k, m]) => LANE_NAMES[k].toLowerCase() + " " + km(m) + " km").join(", ")})` : m0 / tot > 0.97 ? "" : "");
  }
  function terrainText(t) {
    const tot = t[0] + t[1] + t[2] || 1, pl = t[0] / tot, hi = t[2] / tot, ro = t[1] / tot;
    const pc = (x) => Math.round(x * 100);
    if (pl >= 0.85) return { txt: "Plains", cls: "plain" };
    if (hi >= 0.85) return { txt: "Hilly", cls: "hill" };
    if (ro >= 0.85) return { txt: "Rolling", cls: "roll" };
    if (pl < 0.15) return { txt: "Hilly / rolling", cls: "hill" };
    return { txt: `${pc(pl)}% plains, ${100 - pc(pl)}% hilly or rolling`, cls: pl >= 0.5 ? "roll" : "hill" };
  }
  // ILP states on a route: where it starts or ends, or runs 10 km or more (ignores slivers along state borders)
  function routeIlp(r, a, b) {
    return r.states.filter(([st, m]) => m >= 10000 || st === a.state || st === b.state).map(([st]) => st).filter((st) => ILP_STATES.includes(st));
  }
  function buildLegs(r, a, b, along) {
    const scale = r.hwDistance / (r.cumPath[r.cumPath.length - 1] || 1);
    // 1. merge steps into runs of the same highway number
    let runs = [];
    const stepRefs = (st) => (st.allRefs && st.allRefs !== "link" ? st.allRefs.split(" / ") : []);
    for (const st of r.steps) {
      const last = runs[runs.length - 1];
      const refs = stepRefs(st);
      const shares = last && (refs.length === 0 || refs.some((x) => last.refSet.has(x)));
      if (last && shares) {
        last.m += st.m; last.car += st.car; last.truck += st.truck; last.to = st.to; if (st.approx) last.approx += st.m;
        st.terrain.forEach((x, i) => (last.terrain[i] += x));
        [["lanes", st.lanes], ["agencies", st.agencies], ["states", st.states], ["districts", st.districts]].forEach(([k, list]) => list.forEach(([c, m]) => last[k].set(c, (last[k].get(c) || 0) + m)));
        refs.forEach((x) => last.refKm.set(x, (last.refKm.get(x) || 0) + st.m));
        // keep only refs that are still continuous, so a later road change starts a new leg
        if (refs.length) last.refSet = new Set(refs.filter((x) => last.refSet.has(x)).length ? refs.filter((x) => last.refSet.has(x)) : refs);
        [...st.states].sort((p, q) => q[1] - p[1]).forEach(([k]) => { if (!last.stateOrder.includes(k)) last.stateOrder.push(k); });
      } else {
        runs.push({ refSet: new Set(refs), refKm: new Map(refs.map((x) => [x, st.m])), cls: st.cls, road: st.road, m: st.m, car: st.car, truck: st.truck, terrain: st.terrain.slice(), from: st.from, to: st.to, approx: st.approx ? st.m : 0,
          lanes: new Map(st.lanes), agencies: new Map(st.agencies), states: new Map(st.states), districts: new Map(st.districts),
          stateOrder: [...st.states].sort((p, q) => q[1] - p[1]).map(([k]) => k) });
      }
    }
    runs.forEach((x) => {
      const top = [...x.refKm.entries()].sort((p, q) => q[1] - p[1]);
      x.ref = top.length ? top[0][0] : null;
      x.alt = top.slice(1).filter(([, m]) => m > 0.5 * x.m).map(([k]) => k);
      x.cls = x.ref ? (/^NH/i.test(x.ref) ? 0 : /^SH/i.test(x.ref) ? 1 : 2) : 3;
    });
    // 2. fold very short runs (< 4 km) into a neighbour, then re-merge equal neighbours
    const fold = (into, x) => {
      into.m += x.m; into.car += x.car; into.truck += x.truck; into.approx += x.approx;
      x.terrain.forEach((v, i) => (into.terrain[i] += v));
      ["lanes", "agencies", "states", "districts"].forEach((k) => x[k].forEach((m, c) => into[k].set(c, (into[k].get(c) || 0) + m)));
      x.refKm.forEach((m, c) => into.refKm.set(c, (into.refKm.get(c) || 0) + m));
      x.stateOrder.forEach((k) => { if (!into.stateOrder.includes(k)) into.stateOrder.push(k); });
      into.from = Math.min(into.from, x.from); into.to = Math.max(into.to, x.to);
    };
    for (let pass = 0; pass < 2; pass++) {
      const out = [];
      runs.forEach((x) => {
        const last = out[out.length - 1];
        if (last && (x.m < 4000 || (last.ref && last.ref === x.ref))) fold(last, x);
        else out.push(x);
      });
      if (out.length > 1 && out[0].m < 4000) { fold(out[1], out[0]); out.shift(); }
      runs = out;
    }
    // 3. waypoints, cumulative distance and time
    const W = S.mode === "truck" ? "truck" : "car";
    const legs = [];
    let dist = 0, time = 0;
    const used = new Set([a.id, b.id]);
    let carry = { m: 0, t: 0 };
    if (r.snapFrom.dist > 150) {
      const m = r.snapFrom.dist * 1.3, t = m / ((S.mode === "truck" ? 20 : 30) / 3.6);
      if (m >= 1500) {
        dist += m; time += t;
        const nm = nameAt(r.path[0], used) || { name: "Join the highway" };
        if (nm.id) used.add(nm.id);
        legs.push({ local: true, m, t, endName: nm, endKm: dist, endTime: time });
      } else carry = { m, t };
    }
    runs.forEach((x, i) => {
      const startKm = dist;
      const tailM = i === runs.length - 1 && r.snapTo.dist > 150 && r.snapTo.dist * 1.3 < 1500 ? r.snapTo.dist * 1.3 : 0;
      const tailT = tailM / ((S.mode === "truck" ? 20 : 30) / 3.6);
      dist += x.m + carry.m + tailM; time += x[W] + carry.t + tailT;
      const legM = x.m + carry.m + tailM, legT = x[W] + carry.t + tailT;
      carry = { m: 0, t: 0 };
      const isLast = i === runs.length - 1 && (r.snapTo.dist <= 150 || tailM > 0);
      let endName = isLast ? { name: b.name, id: b.id } : nameAt(r.path[x.to], used);
      if (!isLast) {
        if (endName && endName.id) used.add(endName.id);
        const nextRef = runs[i + 1] ? runs[i + 1].ref : null;
        if (!endName) endName = { name: x.ref && nextRef ? `${x.ref} / ${nextRef} junction` : "Road junction" };
        endName.junction = x.ref && nextRef ? `${x.ref} → ${nextRef}` : "";
      }
      const lo = startKm, hi = dist;
      const inRun = along.filter((y) => y.at >= lo - 1 && y.at < hi + 1 && y.p.id !== (endName && endName.id));
      legs.push({
        ref: x.ref, alt: x.alt, cls: x.cls, road: x.road, m: legM, t: legT, startKm, endKm: dist, endTime: time, endName,
        terrain: terrainText(x.terrain), lanesTxt: x.cls === 0 ? laneText([...x.lanes.entries()]) : x.cls === 1 ? "State highway" : "District / other road",
        mainLane: [...x.lanes.entries()].filter(([k]) => k).sort((p, q) => q[1] - p[1])[0],
        agency: x.cls === 0 ? [...x.agencies.entries()].filter(([k]) => k).sort((p, q) => q[1] - p[1]).map(([k]) => AGENCY_NAMES[k])[0] || "" : "",
        states: x.stateOrder.filter((k) => (x.states.get(k) || 0) > 10000).map((k) => NET.states[k]),
        tolls: inRun.filter((y) => y.p.cat === "toll"),
        via: [], approx: x.approx
      });
    });
    if (r.snapTo.dist > 150 && r.snapTo.dist * 1.3 >= 1500) {
      const m = r.snapTo.dist * 1.3, t = m / ((S.mode === "truck" ? 20 : 30) / 3.6);
      const prev = legs[legs.length - 1];
      if (prev && !prev.local) prev.endName = nameAt(r.path[r.path.length - 1], used) || { name: "Leave the highway" };
      dist += m; time += t;
      legs.push({ local: true, m, t, endName: { name: b.name, id: b.id }, endKm: dist, endTime: time });
    }
    // towns passed, for "via" lines
    const towns = [];
    for (const p of TOWNISH) {
      if (p.id === a.id || p.id === b.id) continue;
      const hit = window.NERouter.nearPath([p.lng, p.lat], r.path, r.cumPath, 2500);
      if (hit) towns.push({ p, at: hit.at * scale + r.accessStart });
    }
    let prevName = a.name;
    legs.forEach((L) => {
      const clean = (n) => (n || "").replace(/^Near /, "");
      if (!L.local) L.via = towns.filter((y) => y.at > L.startKm + 2000 && y.at < L.endKm - 2000 && y.p.name !== clean(L.endName && L.endName.name) && y.p.name !== clean(prevName)).sort((p, q) => p.at - q.at).map((y) => y.p.name);
      prevName = L.endName && L.endName.name;
    });
    return { legs, total: dist, totalTime: time };
  }

  function sheetHTML(a, sheet) {
    const hm2 = (sec) => { const [h, m] = hm(sec); return h + ":" + String(m).padStart(2, "0"); };
    const laneCls = (L) => (L.local ? "local" : !L.mainLane ? "l0" : L.mainLane[0] >= 4 ? "l4" : L.mainLane[0] === 3 ? "l2" : "l1");
    let html = `<ol class="sheet">
      <li class="stop start"><span class="dot"></span><div class="st-name"><b>${esc(a.name)}</b><span>Start</span></div><div class="st-km num">0 km</div><div class="st-t num">0:00</div></li>`;
    sheet.legs.forEach((L, i) => {
      const last = i === sheet.legs.length - 1;
      if (L.local) {
        html += `<li class="leg local"><span class="rail"></span><div class="lg-body"><div class="lg-title">Local roads <span class="num">${km(L.m)} km · ${durText(L.t)}</span></div><div class="lg-meta">Estimated: not on the mapped highway network</div></div></li>`;
      } else {
        const chips = [
          `<span class="chip-t">${esc(L.lanesTxt)}</span>`,
          `<span class="chip-t terr-${L.terrain.cls}">${esc(L.terrain.txt)}</span>`,
          `<span class="chip-t ${L.tolls.length ? "toll" : ""}">${L.tolls.length ? L.tolls.length + (L.tolls.length === 1 ? " toll plaza" : " toll plazas") : "No toll"}</span>`
        ].join("");
        const extra = [];
        if (L.via.length) extra.push(`Via ${L.via.slice(0, 6).map(esc).join(", ")}${L.via.length > 6 ? "…" : ""}`);
        if (L.tolls.length) extra.push(`Toll: ${L.tolls.map((y) => esc(y.p.name.replace(/\s*toll(\s*plaza)?\s*$/i, "")) + ` <span class="num">(km ${km(y.at)})</span>`).join(", ")}`);
        const meta = [L.agency, L.states.join(" → ")].filter(Boolean).join(" · ");
        html += `<li class="leg ${laneCls(L)}"><span class="rail"></span><div class="lg-body">
            <div class="lg-title">${L.ref ? shield(L.ref) : `<span class="shield other">Road</span>`}${(L.alt || []).map((x) => `<span class="also">also ${esc(x)}</span>`).join("")}<span class="num">${km(L.m)} km · ${durText(L.t)}</span></div>
            <div class="lg-chips">${chips}</div>
            ${meta ? `<div class="lg-meta">${esc(meta)}</div>` : ""}
            ${extra.map((x) => `<div class="lg-extra">${x}</div>`).join("")}
            ${L.approx > 1000 ? `<div class="lg-extra warn">${km(L.approx)} km on an indicative alignment</div>` : ""}
          </div></li>`;
      }
      const nm = L.endName || { name: "—" };
      html += `<li class="stop ${last ? "end" : ""}"><span class="dot"></span><div class="st-name"><b>${esc(nm.name)}</b><span>${last ? "Destination" : esc(nm.junction || nm.sub || "")}</span></div><div class="st-km num">${km(L.endKm)} km</div><div class="st-t num">${hm2(L.endTime)}</div></li>`;
    });
    return html + `</ol>`;
  }

  function sheetText(a, b, r, sheet, tolls) {
    const lines = [];
    lines.push(`KNOW YOUR ROUTE: ${a.name} → ${b.name}`);
    lines.push(`${km(r.distance)} km · ${S.mode === "truck" ? "Truck" : "Car"} ~${durText(S.mode === "truck" ? r.truck : r.car)} (no stops) · ${tolls.length} toll plaza${tolls.length === 1 ? "" : "s"}`);
    lines.push("");
    lines.push(`0 km  ${a.name}`);
    sheet.legs.forEach((L) => {
      if (L.local) lines.push(`   | Local roads ${km(L.m)} km (estimated)`);
      else {
        lines.push(`   | ${L.ref || "Road"} · ${km(L.m)} km · ${L.lanesTxt} · ${L.terrain.txt} · ${L.tolls.length ? L.tolls.length + (L.tolls.length === 1 ? " toll plaza" : " toll plazas") : "no toll"}`);
        if (L.via.length) lines.push(`   |   via ${L.via.slice(0, 6).join(", ")}`);
        if (L.tolls.length) lines.push(`   |   toll: ${L.tolls.map((y) => y.p.name.replace(/\s*toll(\s*plaza)?\s*$/i, "")).join(", ")}`);
      }
      lines.push(`${km(L.endKm)} km  ${(L.endName || {}).name || ""}`);
    });
    const ilp = routeIlp(r, a, b);
    if (ilp.length) lines.push("", "ILP needed: " + ilp.join(", "));
    lines.push("", "Estimate from Star Cement NE Know Your Route (public data). Verify road status before dispatch.");
    return lines.join("\n");
  }

  const LANE_COLOR = ["var(--lane-0)", "var(--lane-1)", "var(--lane-i)", "var(--lane-2)", "var(--lane-4)", "var(--lane-6)"];
  function overviewSection(r) {
    const T = r.terrain, D = r.hwDistance || r.distance;
    const tot = r.lanes.reduce((x, [, m]) => x + m, 0), by = new Map(r.lanes);
    const order = [5, 4, 3, 2, 1, 0].filter((k) => (by.get(k) || 0) > 0);
    const bar = (parts) => `<div class="terrain-bar">${parts.map(([w, c]) => `<i style="width:${w * 100}%;background:${c}"></i>`).join("")}</div>`;
    const key = (parts) => `<div class="terrain-key">${parts.filter(([, , , m]) => m >= 2000).map(([, c, label, m]) => `<span><i style="background:${c}"></i>${label} <b>${km(m)} km</b></span>`).join("")}</div>`;
    const terr = [[T[0], "var(--t-plain)", "Plains", D * T[0]], [T[1], "var(--t-roll)", "Rolling", D * T[1]], [T[2], "var(--t-hill)", "Hills", D * T[2]]];
    const lanes = order.map((k) => [by.get(k) / tot, LANE_COLOR[k], LANE_NAMES[k], by.get(k)]);
    return `<div class="rr-sec">
      <h4>Terrain</h4>${bar(terr)}${key(terr)}
      ${tot >= 1000 ? `<h4 style="margin-top:6px">Lanes on National Highways <span>${km(tot)} km</span></h4>${bar(lanes)}${key(lanes)}` : ""}
    </div>`;
  }
  function districtSection(r) {
    const ds = r.districts.filter(([, m]) => m >= 5000).map(([di, m]) => [DIST_BY_IDX.get(di), m]).filter(([d]) => d);
    if (!ds.length) return "";
    return `<div class="rr-sec"><h4>Districts crossed</h4><div class="dist-rows">${ds.map(([d, m]) => `<button type="button" class="dist-pill" data-open="${d.id}" title="${d.floods} mapped flood events, 2014–16"><i class="fl fl-${floodBand(d.floods)}"></i>${esc(d.name)}<b>${km(m)} km</b></button>`).join("")}</div>
      <p class="fine">Shade = mapped flood events, 2014–16 (India Flood Inventory v3): <i class="fl fl-1"></i> 3–5 <i class="fl fl-2"></i> 6–9 <i class="fl fl-3"></i> 10+</p></div>`;
  }
  function nearestOf(cat, pt, pred) {
    let best = null;
    for (const p of POINTS) {
      if (p.cat !== cat || (pred && !pred(p))) continue;
      const d = hav(pt, [p.lng, p.lat]);
      if (!best || d < best.d) best = { p, d };
    }
    return best;
  }
  function accessSection(a, b) {
    const row = (label, x) => {
      const pt = [x.lng, x.lat];
      const st = nearestOf("station", pt), ap = nearestOf("airport", pt);
      const item = (h, k) => (h ? `<li data-id="${h.p.id}"><span class="at">${km(h.d)} km</span>${`<i class="mk ${SHAPE[h.p.cat]}" style="background:${dotColor(h.p.cat)}"></i>`}<span><div class="nm">${esc(h.p.name)}</div><div class="sb">${k}</div></span><span></span></li>` : "");
      return `<div class="acc"><div class="acc-h">${label}: ${esc(x.name)}</div><ul class="along">${item(st, "Nearest railway station")}${item(ap, "Nearest airport")}</ul></div>`;
    };
    return `<div class="rr-sec"><h4>Rail &amp; air access <span>straight-line km</span></h4>${row("Start", a)}${row("End", b)}</div>`;
  }

  function renderRoute(a, b, r) {
    const secs = S.mode === "truck" ? r.truck : r.car, other = S.mode === "truck" ? r.car : r.truck;
    const along = alongRoute(r, a, b);
    const tolls = along.filter((x) => x.p.cat === "toll");
    const T = r.terrain; // plain, rolling, hill shares
    const sheet = buildLegs(r, a, b, along);
    const refSeq = [];
    sheet.legs.forEach((L) => { if (L.ref && refSeq[refSeq.length - 1] !== L.ref) refSeq.push(L.ref); });
    const ilp = routeIlp(r, a, b);

    const notices = [];
    if (ilp.length) notices.push(`<b>Inner Line Permit</b> needed to enter ${ilp.join(", ")}. It applies to Indian citizens from outside the state, drivers and crew included.`);
    const floodKm = r.districts.reduce((sum, [di, m]) => sum + ((DIST_BY_IDX.get(di) || {}).floods >= 6 ? m : 0), 0);
    if (floodKm > 30000 && T[0] > 0.3) notices.push(`<b>${km(floodKm)} km runs through frequently flooded districts</b> (6 or more mapped flood events, 2014–16).`);
    if (T[2] + T[1] > 0.3) notices.push(`<b>Hill sections:</b> landslide closures are possible in June–September. Check road status before dispatch.`);
    const approxEnds = [a, b].map((x) => byId.get(x.id)).filter((x) => x && x.cat === "locality" && x.q === 1);
    if (approxEnds.length) notices.push(approxEnds.map((x) => `${esc(x.name)} (${x.pin})`).join(" and ") + ` ${approxEnds.length > 1 ? "are" : "is"} placed at the centre of ${approxEnds.length > 1 ? "their" : "its"} PIN area, so distances there are approximate.`);

    const ptIcon = (cat) => `<i class="mk ${SHAPE[cat] || ""}" style="background:${dotColor(cat)}"></i>`;
    $("#route-result").innerHTML = `
      <div class="rr-head">
        <div class="rr-od"><b>${esc(a.name)}</b><span>→</span><b>${esc(b.name)}</b></div>
        <div class="rr-stats">
          <div class="stat"><div class="v">${km(r.distance)}<small>km</small></div><div class="l">Distance</div></div>
          <div class="stat"><div class="v">${durHTML(secs)}</div><div class="l">${S.mode === "truck" ? "Truck" : "Car"} time</div></div>
          <div class="stat alt"><div class="v">${durText(other)}</div><div class="l">${S.mode === "truck" ? "By car" : "By truck"}</div></div>
        </div>
        <div class="rr-line">${refSeq.length ? "Via " + refSeq.slice(0, 6).map(esc).join(" → ") + (refSeq.length > 6 ? " …" : "") + " · " : ""}${tolls.length ? tolls.length + (tolls.length === 1 ? " toll plaza" : " toll plazas") : "No toll plazas"}</div>
      </div>
      <div class="rr-sec sheet-sec">
        <h4>Route sheet <span>km · ${S.mode === "truck" ? "truck" : "car"} time</span></h4>
        ${sheetHTML(a, sheet)}
        <div class="lane-key"><span><i style="background:var(--lane-4);width:6px"></i>4-lane or wider</span><span><i style="background:var(--lane-2)"></i>2-lane</span><span><i style="background:var(--lane-1);width:3px"></i>Intermediate / single</span><span><i style="background:repeating-linear-gradient(var(--ink-3) 0 3px, transparent 3px 6px);width:2px"></i>Local roads</span></div>
        <p class="fine">Lane types: MoRTH, June 2022. Toll fees are not shown because they are revised every year.</p>
      </div>
      ${notices.length ? `<div class="rr-sec">${notices.map((n) => `<div class="notice">${n}</div>`).join("")}</div>` : ""}
      ${overviewSection(r)}
      ${districtSection(r)}
      ${accessSection(a, b)}
      <div class="rr-sec">
        <p class="fine">Estimates for a ${S.mode === "truck" ? "loaded truck" : "car"}, without traffic, stops or breaks. Distances are measured on OpenStreetMap road geometry.</p>
        <div class="rr-actions">
          <button type="button" class="btn btn-primary btn-sm" id="rr-sheet">Copy route sheet</button>
          <button type="button" class="btn btn-quiet btn-sm" id="rr-copy">Copy link</button>
          ${window.self === window.top ? `<button type="button" class="btn btn-quiet btn-sm" id="rr-print">Print</button>` : ""}
          <a class="btn btn-quiet btn-sm" target="_blank" rel="noopener" href="https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${a.lat}%2C${a.lng}%3B${b.lat}%2C${b.lng}">Open in OpenStreetMap</a>
          <button type="button" class="btn btn-quiet btn-sm" id="rr-clear">Clear</button>
        </div>
      </div>`;
    $$("#route-result .along li").forEach((li) => li.addEventListener("click", () => openItem(li.dataset.id, { fly: true })));
    $$("#route-result [data-open]").forEach((el) => el.addEventListener("click", () => openItem(el.dataset.open, { fly: true })));
    $$("#route-result .road-row").forEach((row) => row.addEventListener("click", () => {
      const it = ROAD_ITEMS.find((x) => x.road.ref === row.dataset.ref);
      if (it) openItem(it.id, { trace: true });
    }));
    $("#rr-clear").addEventListener("click", clearRoute);
    const txt = sheetText(a, b, r, sheet, tolls);
    $("#rr-sheet").addEventListener("click", () => {
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast("Route sheet copied. Paste it into WhatsApp or email."), () => { toast("Couldn't copy automatically. The route sheet is shown in the text box.", 5000); showText(txt); });
    });
    if ($("#rr-print")) $("#rr-print").addEventListener("click", () => window.print());
    $("#rr-copy").addEventListener("click", () => {
      const url = location.href;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast("Link copied"), () => toast(url, 7000));
    });
    requestAnimationFrame(() => { $("#panel-body").scrollTo({ top: $("#route-result").offsetTop - 14, behavior: "smooth" }); });
  }

  function showText(txt) {
    const card = $("#info-card");
    card.innerHTML = `<div class="ic-head"><div class="ic-type">Route sheet</div><h3>Copy this text</h3><button class="ic-close" type="button" aria-label="Close">×</button></div><div class="ic-body"><textarea id="sheet-text" class="sheet-text" readonly rows="14">${esc(txt)}</textarea></div>`;
    card.hidden = false;
    $(".ic-close", card).addEventListener("click", () => (card.hidden = true));
    const ta = $("#sheet-text"); ta.focus(); ta.select();
  }

  function shield(ref) {
    const cls = /^NH/i.test(ref) ? "" : /^SH/i.test(ref) ? "sh" : "other";
    return `<span class="shield ${cls}">${esc(ref.replace(/^NH-/, "NH "))}</span>`;
  }

  /* hash:  #<fromId>~<toId>~<car|truck> */
  function itemFromId(id) {
    if (byId.has(id)) return byId.get(id);
    const m = /^p(-?\d+\.\d+)_(-?\d+\.\d+)$/.exec(id);
    if (m) return { id, name: (+m[1]).toFixed(3) + ", " + (+m[2]).toFixed(3), lat: +m[1], lng: +m[2], cat: "pick" };
    return null;
  }
  function applyHash() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ""));
    const parts = h.split("~");
    if (parts.length < 2) return;
    const a = itemFromId(parts[0]), b = itemFromId(parts[1]);
    if (!a || !b) return;
    const mode = parts[2] === "truck" ? "truck" : "car";
    S.mode = mode;
    $$("[data-mode]").forEach((x) => { const on = x.dataset.mode === mode; x.classList.toggle("is-on", on); x.setAttribute("aria-checked", on); });
    setEnd("from", a); setEnd("to", b); runRoute();
  }

  /* -------------------------------------------------- info card */
  function traceRoad(idx, fit) {
    const feats = router.edges.filter((e) => e.roads.includes(idx)).map((e) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: e.coords } }));
    S.traceFC = FC(feats); setData("trace", S.traceFC);
    if (fit && feats.length) {
      const bb = new maplibregl.LngLatBounds();
      feats.forEach((f) => f.geometry.coordinates.forEach((c) => bb.extend(c)));
      map.fitBounds(bb, { padding: padding(), duration: 700, maxZoom: 10.5 });
    }
    return feats.length;
  }

  const sameDist = (a, b) => slug(a).replace(/-district$/, "") === slug(b);
  const DIST_STATS = new Map();
  router.edges.forEach((e) => {
    const tot = e.districts.reduce((s2, [, m]) => s2 + m, 0) || 1;
    e.districts.forEach(([di, m]) => {
      const d = DIST_STATS.get(di) || { nh: 0, total: 0, hill: 0, lanes: new Map() };
      d.total += m; d.hill += e.hill * (m / (e.len || 1));
      if (e.cls === 0) { d.nh += m; e.lanes.forEach(([k, lm]) => d.lanes.set(k, (d.lanes.get(k) || 0) + lm * (m / tot))); }
      DIST_STATS.set(di, d);
    });
  });
  function roadLaneBlock(idx) {
    const by = new Map(), ag = new Map(); let tot = 0;
    router.edges.forEach((e) => { if (!e.roads.includes(idx)) return; e.lanes.forEach(([k, m]) => { by.set(k, (by.get(k) || 0) + m); tot += m; }); e.agencies.forEach(([k, m]) => ag.set(k, (ag.get(k) || 0) + m)); });
    if (tot < 1000) return "";
    const order = [5, 4, 3, 2, 1, 0].filter((k) => by.get(k) > 0);
    const agl = [...ag.entries()].filter(([k, m]) => k && m > 1000).sort((a, b) => b[1] - a[1]);
    return `<div><div class="mini-label">Road type in the North-East</div><div class="terrain-bar">${order.map((k) => `<i style="width:${(by.get(k) / tot) * 100}%;background:${LANE_COLOR[k]}"></i>`).join("")}</div>
      <div class="terrain-key" style="margin-top:6px">${order.map((k) => `<span><i style="background:${LANE_COLOR[k]}"></i>${LANE_NAMES[k]} <b>${fmtInt(by.get(k) / 1000)} km</b></span>`).join("")}</div>
      ${agl.length ? `<p class="fine" style="margin-top:6px">Maintained by ${agl.map(([k, m]) => `${esc(AGENCY_NAMES[k])} (${fmtInt(m / 1000)} km)`).join(", ")}. MoRTH / PM GatiShakti, June 2022.</p>` : ""}</div>`;
  }

  /* ---------------- reach map: how far can a car / truck get in N hours */
  const REACH_BANDS = [2, 4, 6, 8, 12];
  let pinPoints = null;
  function showReach(pt, label) {
    const r = router.reach(pt, S.mode, REACH_BANDS[REACH_BANDS.length - 1] * 3600);
    if (!r) { toast("This point isn't near the mapped road network."); return; }
    const band = (t) => REACH_BANDS.findIndex((h) => t <= h * 3600);
    const feats = [];
    const bb = new maplibregl.LngLatBounds();
    router.edges.forEach((e) => {
      const ta = r.time.get(e.a), tb = r.time.get(e.b);
      if (ta == null && tb == null) return;
      const t = Math.min(ta ?? Infinity, tb ?? Infinity) + (ta != null && tb != null ? Math.abs(ta - tb) / 2 : 0);
      const b = band(t);
      if (b < 0) return;
      feats.push({ type: "Feature", properties: { band: b }, geometry: { type: "LineString", coordinates: e.coords } });
      if (b <= 3) { bb.extend(e.coords[0]); bb.extend(e.coords[e.coords.length - 1]); }
    });
    S.reachFC = FC(feats); setData("reach", S.reachFC);
    // PIN codes reachable (one representative office per PIN), each snapped to its point on the road network
    if (!pinPoints) {
      pinPoints = [];
      for (const [pin, list] of PINS) {
        const o = list.slice().sort((x, y) => x.q - y.q || x.officeType - y.officeType)[0];
        if (o.q === 2) continue;
        const sn = router.snap([o.lng, o.lat]);
        if (sn) pinPoints.push({ pin, e: sn.edge, f: sn.frac, d: sn.dist });
      }
    }
    const counts = REACH_BANDS.map(() => 0);
    const v = (S.mode === "truck" ? 20 : 30) / 3.6, W = (e) => (S.mode === "truck" ? e.truck : e.car);
    pinPoints.forEach((pp) => {
      const ta = r.time.get(pp.e.a), tb = r.time.get(pp.e.b);
      let t = Math.min(ta == null ? Infinity : ta + W(pp.e) * pp.f, tb == null ? Infinity : tb + W(pp.e) * (1 - pp.f));
      if (pp.e === r.snap.edge) t = Math.min(t, r.access + Math.abs(pp.f - r.snap.frac) * W(pp.e));
      if (!isFinite(t)) return;
      t += (pp.d * 1.3) / v;
      REACH_BANDS.forEach((h, i) => { if (t <= h * 3600) counts[i]++; });
    });
    if (!bb.isEmpty()) map.fitBounds(bb, { padding: padding(), duration: 700, maxZoom: 9.5 });
    const P = PAL[theme()];
    const card = $("#info-card");
    card.innerHTML = `<div class="ic-head"><div class="ic-type"><i style="background:${P.reach[1]}"></i>Reach map</div>
        <h3>${esc(label)}</h3><div class="where">How far a ${S.mode === "truck" ? "loaded truck" : "car"} gets on mapped highways</div><button class="ic-close" type="button" aria-label="Close">×</button></div>
      <div class="ic-body">
        <div class="seg seg-sm" role="radiogroup" aria-label="Vehicle"><button type="button" class="seg-btn ${S.mode === "car" ? "is-on" : ""}" data-rmode="car">Car</button><button type="button" class="seg-btn ${S.mode === "truck" ? "is-on" : ""}" data-rmode="truck">Truck</button></div>
        <div class="reach-rows">${REACH_BANDS.map((h, i) => `<div class="reach-row"><i style="background:${P.reach[i]}"></i><span>Within ${h} h</span><b class="num">${fmtInt(counts[i])}</b><span class="fine">PIN codes</span></div>`).join("")}</div>
        <p class="fine">Same time model as the route sheet. Counts PIN codes with a known location, one post office each.</p>
        <div class="ic-actions"><button class="btn btn-quiet btn-sm" data-act="clear-reach">Clear reach map</button></div>
      </div>`;
    card.hidden = false;
    $(".ic-close", card).addEventListener("click", () => { card.hidden = true; });
    $$("[data-rmode]", card).forEach((b) => b.addEventListener("click", () => { setMode(b.dataset.rmode, true); showReach(pt, label); }));
    $("[data-act=clear-reach]", card).addEventListener("click", () => { S.reachFC = FC([]); setData("reach", S.reachFC); card.hidden = true; });
    if (isPhone()) setSheet("peek");
  }

  function openItem(id, opts = {}) {
    const it = byId.get(id);
    if (!it) return;
    const card = $("#info-card");
    let html = "";
    if (it.kind === "district") {
      const ds = DIST_STATS.get(it.di) || { nh: 0, lanes: new Map(), total: 0 };
      const pins = new Set(LOCS.filter((x) => x.state === it.state && sameDist(x.district, it.name)).map((x) => x.pin));
      const lanes = [...ds.lanes.entries()].filter(([k]) => k).sort((a, b) => b[1] - a[1]);
      html = `<div class="ic-head"><div class="ic-type"><i class="sq" style="background:${EXTRA_COLOR.district}"></i>District</div>
          <h3>${esc(it.name)}</h3><div class="where">${esc(it.state)}</div><button class="ic-close" type="button" aria-label="Close">×</button></div>
        <div class="ic-body">
          <dl class="facts"><dt>NH mapped</dt><dd class="num">${fmtInt(ds.nh / 1000)} km</dd>${lanes.length ? `<dt>NH lanes</dt><dd>${lanes.map(([k, m]) => `${LANE_NAMES[k]} <span class="num">${fmtInt(m / 1000)} km</span>`).join(", ")}</dd>` : ""}<dt>Hill / rolling</dt><dd class="num">${ds.total ? Math.round((ds.hill / ds.total) * 100) : 0}% of mapped roads</dd>
          <dt>Floods 2014–16</dt><dd><i class="fl fl-${floodBand(it.floods)}"></i> <span class="num">${it.floods}</span> mapped events</dd>${pins.size ? `<dt>PIN codes</dt><dd class="num">${pins.size}</dd>` : ""}</dl>
          <p class="fine">Flood events from the India Flood Inventory v3 whose mapped extent covers this district. Only 2014–16 events have mapped extents in this release.</p>
          <div class="ic-actions"><button class="btn btn-quiet btn-sm" data-act="reach">Reach from district centre</button><button class="btn btn-quiet btn-sm" data-act="zoom">Zoom to district</button></div>
        </div>`;
    } else if (it.kind === "road") {
      const r = it.road;
      const facts = [
        ["Type", roadClassLabel[r.cls] || "Road"],
        r.kmRegion ? ["Mapped in NE", `<span class="num">${fmtInt(r.kmRegion)} km</span>`] : null,
        r.kmTotal ? ["Full length", `<span class="num">${fmtInt(r.kmTotal)} km</span>`] : null,
        r.start && r.end ? ["Runs", esc(r.start) + " → " + esc(r.end)] : null,
        r.states && r.states.length ? ["States", esc(r.states.join(", "))] : null
      ].filter(Boolean);
      html = `<div class="ic-head"><div class="ic-type">${shield(r.ref)}<span>${esc(roadClassLabel[r.cls] || "Road")}</span></div>
          <h3>${esc(r.name || r.ref)}</h3><button class="ic-close" type="button" aria-label="Close">×</button></div>
        <div class="ic-body">
          <dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
          ${roadLaneBlock(it.idx)}
          <div class="ic-actions"><button class="btn btn-primary btn-sm" data-act="trace">Show on map</button><button class="btn btn-quiet btn-sm" data-act="untrace">Clear highlight</button></div>
        </div>`;
    } else {
      const c = { label: SING[it.cat], color: dotColor(it.cat) };
      const facts = Object.entries(it.facts || {});
      let body = it.desc ? `<p>${esc(it.desc)}</p>` : "";
      if (it.cat === "toll") {
        const t = it.toll;
        body += `<dl class="facts"><dt>Highway</dt><dd>${esc(t.nh)}</dd>${t.len ? `<dt>Tollable length</dt><dd class="num">${esc((+t.len).toFixed(1))} km</dd>` : ""}${t.lanes ? `<dt>Project</dt><dd>${esc(String(t.lanes).replace(/(\d)\s*L$/i, "$1 lanes").replace(/^0?(\d)$/, "$1 lanes"))}${t.type ? " · " + esc(t.type) : ""}</dd>` : ""}</dl>
          <p class="fine">NHAI fee plaza. Fees are revised every year, so check the NHAI Rajmargyatra app for current rates.</p>`;
      }
      if (it.cat === "station") body += `<dl class="facts"><dt>Code</dt><dd class="num">${esc(it.code)}</dd><dt>Type</dt><dd>${esc(it.stationType)}</dd>${it.division ? `<dt>Division</dt><dd>${esc(it.division)}</dd>` : ""}</dl><p class="fine">Indian Railways GeoPortal.</p>`;
      if (it.cat === "shed") body += `<dl class="facts"><dt>Code</dt><dd class="num">${esc(it.code)}</dd><dt>Division</dt><dd>${esc(it.division)}</dd><dt>District</dt><dd>${esc(it.district)}</dd></dl><p class="fine">Railway goods shed as listed on PM GatiShakti. Check commodity handling and wagon availability with the railway division.</p>`;
      if (it.cat === "airport") body += `<dl class="facts"><dt>IATA</dt><dd class="num">${esc(it.iata)}</dd><dt>Serves</dt><dd>${esc(it.city)}</dd></dl>`;
      if (it.cat === "locality") {
        const same = (PINS.get(it.pin) || []).filter((x) => x !== it);
        body += `<dl class="facts"><dt>PIN code</dt><dd class="num">${it.pin}</dd><dt>Office</dt><dd>${OFFICE_TYPE[it.officeType]}</dd><dt>District</dt><dd>${esc(it.district)}</dd><dt>Location</dt><dd>${LOC_QUALITY[it.q]}</dd></dl>`;
        if (same.length) body += `<div><div class="mini-label">Also in PIN ${it.pin}</div><div class="chips">${same.slice(0, 14).map((x) => `<button type="button" class="chip" data-open="${x.id}">${esc(x.name)}</button>`).join("")}${same.length > 14 ? `<span class="chip muted">+${same.length - 14} more</span>` : ""}</div></div>`;
      }
      if (it.cat === "town" || (it.cat === "locality" && it.q < 2) || it.cat === "city") {
        const sn = router.snap([it.lng, it.lat]);
        if (sn) body += `<p class="fine">Nearest mapped highway: <b>${esc(sn.edge.ref === "link" ? "connector road" : sn.edge.ref.split(" / ")[0])}</b>, ${sn.dist < 1000 ? "under 1 km" : "about " + km(sn.dist) + " km"} away.</p>`;
      }
      if (facts.length) body += `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
      if (it.approx) body += `<div><span class="tag">Position approximate</span></div>`;
      const routable = it.cat !== "toll" && !(it.cat === "locality" && it.q === 2);
      html = `<div class="ic-head"><div class="ic-type"><i class="${SHAPE[it.cat] || ""}" style="background:${c.color}"></i>${esc(c.label)}</div>
          <h3>${esc(it.name)}</h3><div class="where">${esc(it.cat === "locality" ? it.district + ", " + it.state : it.state || "")}</div><button class="ic-close" type="button" aria-label="Close">×</button></div>
        <div class="ic-body">${body}
          ${routable ? `<div class="ic-actions"><button class="btn btn-quiet btn-sm" data-act="from">Route from here</button><button class="btn btn-quiet btn-sm" data-act="to">Route to here</button><button class="btn btn-quiet btn-sm" data-act="reach">Reach from here</button></div>` : ""}
        </div>`;
    }
    card.innerHTML = html;
    card.hidden = false;
    $(".ic-close", card).addEventListener("click", () => (card.hidden = true));
    $$("[data-act]", card).forEach((btn) => btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      if (act === "trace") { const n = traceRoad(it.idx, true); if (!n) toast("This road isn't in the routing network."); if (isPhone()) card.hidden = true; }
      if (act === "untrace") { S.traceFC = FC([]); setData("trace", S.traceFC); }
      if (act === "reach") { showReach([it.lng, it.lat], it.cat === "locality" ? it.name + " (" + it.pin + ")" : it.name); return; }
      if (act === "zoom" && it.bbox) { map.fitBounds([[it.bbox[0], it.bbox[1]], [it.bbox[2], it.bbox[3]]], { padding: padding(), duration: 700 }); if (isPhone()) setSheet("peek"); }
      if (act === "from" || act === "to") {
        setEnd(act, it.cat === "locality" ? { ...it, name: it.name + " (" + it.pin + ")" } : it); card.hidden = true;
        if (S.od.from && S.od.to && S.od.from.id !== S.od.to.id) runRoute();
        else { showTab("route"); toast(act === "from" ? "Start set. Now choose where to go." : "End set. Now choose a start."); if (isPhone()) setSheet("mid"); }
      }
    }));
    $$("[data-open]", card).forEach((b) => b.addEventListener("click", () => openItem(b.dataset.open, { fly: true })));
    if (it.kind === "road" && opts.trace) traceRoad(it.idx, true);
    if (it.kind === "district" && opts.fly) { map.fitBounds([[it.bbox[0], it.bbox[1]], [it.bbox[2], it.bbox[3]]], { padding: padding(), duration: 700 }); if (isPhone()) setSheet("peek"); }
    else if (it.kind !== "road" && opts.fly) {
      map.flyTo({ center: [it.lng, it.lat], zoom: Math.max(map.getZoom(), it.cat === "locality" ? 11 : 9.5), padding: padding(), duration: 700 });
      if (isPhone()) setSheet("peek");
    }
  }

  /* -------------------------------------------------- Explore */
  const FILTER_CATS = ["road", "district", "city", "town", "locality", "toll", "station", "shed", "airport"];
  const filterOn = new Set(FILTER_CATS);
  const catLabel = (c) => PLUR[c];
  const catColor = (c) => dotColor(c);

  $("#state-grid").innerHTML = ATLAS.states.map((s) => `<button type="button" class="state-btn" data-state="${s.id}"><b>${STATE_ABBR[s.name]}</b>${esc(s.name.replace(" Pradesh", ""))}</button>`).join("");
  $("#state-grid").addEventListener("click", (e) => { const b = e.target.closest(".state-btn"); if (b) selectState(S.stateSel === b.dataset.state ? null : b.dataset.state); });
  $("#cat-filters").innerHTML = FILTER_CATS.map((c) => `<button type="button" class="chip" data-cat="${c}" aria-pressed="true"><span class="dot" style="background:${catColor(c)}"></span>${catLabel(c)}</button>`).join("");
  $("#cat-filters").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    const k = c.dataset.cat; filterOn.has(k) ? filterOn.delete(k) : filterOn.add(k);
    c.setAttribute("aria-pressed", filterOn.has(k)); renderResults();
  });
  $("#search").addEventListener("input", () => { shown = 60; renderResults(); });
  let shown = 60;

  function inState(it, st) {
    if (!st) return true;
    if (it.kind === "road") return (it.road.states || []).includes(st.name) || (st.name === "Assam" && !it.road.states.length && /^(sh|mdr)-as|^as-/.test(it.road.id));
    return it.state === st.name;
  }
  function renderResults() {
    const q = $("#search").value.trim().toLowerCase();
    const st = S.stateSel ? ATLAS.states.find((s) => s.id === S.stateSel) : null;
    const words = q.split(/\s+/).filter(Boolean);
    const rows = ITEMS.filter((it) => {
      if (!filterOn.has(it.cat)) return false;
      if (!inState(it, st)) return false;
      if (!words.length) return true;
      const r = it.road || {};
      if (it.cat === "locality") {
        const hay = it._h || (it._h = (it.name + " " + it.pin + " " + it.district + " " + it.state).toLowerCase());
        return words.every((w) => (/^\d+$/.test(w) ? it.pin.startsWith(w) : hay.includes(w)));
      }
      const hay = it._h || (it._h = [it.name, it.state, it.district, it.desc, r.name, r.ref && r.ref.replace(" ", ""), (r.cities || []).join(" "), it.toll && it.toll.nh, Object.values(it.facts || {}).join(" ")].join(" ").toLowerCase());
      return words.every((w) => hay.includes(w));
    });
    const order = { road: 0, district: 1, city: 2, node: 3, bridge: 4, border: 5, toll: 6, airport: 7, shed: 8, station: 9, town: 10, locality: 11 };
    const nameFirst = words.length && !/^\d+$/.test(q);
    rows.sort((a, b) => (nameFirst ? (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) : 0) || order[a.cat] - order[b.cat] ||
      (a.cat === "locality" && b.cat === "locality" ? a.pin.localeCompare(b.pin) || a.officeType - b.officeType || a.name.localeCompare(b.name) : 0) ||
      (a.kind === "road" ? ({ nh: 0, sh: 1, other: 2 }[a.road.cls] - { nh: 0, sh: 1, other: 2 }[b.road.cls] || refNum(a.road.ref) - refNum(b.road.ref)) : a.name.localeCompare(b.name)));
    $("#result-meta").innerHTML = `<span>${fmtInt(rows.length)} ${rows.length === 1 ? "entry" : "entries"}${st ? " in " + esc(st.name) : ""}</span>` +
      (q || st || filterOn.size < FILTER_CATS.length ? `<button class="link-btn" type="button" id="clear-filters">Clear filters</button>` : "");
    const cf = $("#clear-filters");
    if (cf) cf.addEventListener("click", () => {
      $("#search").value = ""; FILTER_CATS.forEach((c) => filterOn.add(c));
      $$("#cat-filters .chip").forEach((c) => c.setAttribute("aria-pressed", "true")); selectState(null);
    });
    const list = rows.slice(0, shown);
    $("#results").innerHTML = list.length ? list.map((it) => {
      if (it.kind === "road") {
        const r = it.road;
        return `<li tabindex="0" data-id="${it.id}"><span class="ic">${shield(r.ref)}</span><span><div class="r-t">${esc(r.name || r.ref)}</div><div class="r-s">${esc(roadClassLabel[r.cls])} · ${fmtInt(r.kmRegion)} km mapped in NE</div></span></li>`;
      }
      if (it.cat === "district") return `<li tabindex="0" data-id="${it.id}"><span class="ic"><i class="fl fl-${floodBand(it.floods)} big"></i></span><span><div class="r-t">${esc(it.name)}</div><div class="r-s">District · ${esc(it.state)} · ${it.floods} mapped floods 2014–16</div></span></li>`;
      if (it.cat === "locality") return `<li tabindex="0" data-id="${it.id}"><span class="ic"><span class="pin">${it.pin}</span></span><span><div class="r-t">${esc(it.name)}</div><div class="r-s">${OFFICE_TYPE[it.officeType]} · ${esc(it.district)}, ${esc(it.state)}</div></span></li>`;
      return `<li tabindex="0" data-id="${it.id}"><span class="ic"><i class="${SHAPE[it.cat] || ""}" style="background:${catColor(it.cat)}"></i></span><span><div class="r-t">${esc(it.name)}</div><div class="r-s">${esc(SING[it.cat])} · ${esc(it.state)}${it.toll ? " · " + esc(it.toll.nh) : ""}</div></span></li>`;
    }).join("") + (rows.length > shown ? `<li class="more" id="show-more">Show ${fmtInt(Math.min(60, rows.length - shown))} more</li>` : "")
      : `<li class="empty">Nothing matches. Try another word or switch on more types.</li>`;
    const more = $("#show-more");
    if (more) more.addEventListener("click", () => { shown += 60; renderResults(); });
  }
  $("#results").addEventListener("click", (e) => { const li = e.target.closest("li[data-id]"); if (li) openItem(li.dataset.id, { fly: true, trace: true }); });
  $("#results").addEventListener("keydown", (e) => { const li = e.target.closest("li[data-id]"); if (li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openItem(li.dataset.id, { fly: true, trace: true }); } });

  function selectState(id) {
    S.stateSel = id; shown = 60;
    $$(".state-btn").forEach((b) => b.classList.toggle("is-on", b.dataset.state === id));
    const st = ATLAS.states.find((s) => s.id === id);
    // map highlight
    const feats = GEO.states.features;
    feats.forEach((f, i) => { try { map.setFeatureState({ source: "states", id: i }, { sel: !!st && f.properties.name === st.name }); } catch (e) { /* style not ready */ } });
    const card = $("#state-card");
    if (!st) { card.innerHTML = ""; renderResults(); return; }
    const ss = STATE_STATS[st.name] || { nh: 0, other: 0, hill: 0, total: 1 };
    const tollN = TOLLS.filter((t) => (t.state || "").toLowerCase() === st.name.toLowerCase()).length;
    card.innerHTML = `<div class="state-card">
      <div class="sc-head"><h3>${esc(st.name)}</h3><button class="link-btn" type="button" id="sc-close">Close</button></div>
      <div class="sc-meta">Capital ${esc(st.capital)} · ${esc(st.area)}</div>
      <div class="sc-stats">
        <div><b>${fmtInt(ss.nh / 1000)}</b><span>km of NH mapped</span></div>
        <div><b>${Math.round((ss.hill / (ss.total || 1)) * 100)}%</b><span>hill or rolling</span></div>
        <div><b>${tollN}</b><span>NHAI toll plazas</span></div>
        <div><b>${fmtInt(new Set(LOCS.filter((x) => x.state === st.name).map((x) => x.pin)).size)}</b><span>PIN codes</span></div>
        <div><b>${ITEMS.filter((x) => x.cat === "district" && x.state === st.name).length}</b><span>districts</span></div>
      </div>
      <h5>Longest National Highways in the state</h5>
      <div class="chips">${(STATE_NH[st.name] || []).slice(0, 6).map(([ref, m]) => `<span class="nh-km">${shield(ref)}<span class="num">${fmtInt(m / 1000)} km</span></span>`).join("")}</div>
      ${ILP_STATES.includes(st.name) ? `<p class="fine"><b>Inner Line Permit</b> required for Indian citizens from other states, including drivers and crew.</p>` : ""}
    </div>`;
    $("#sc-close").addEventListener("click", () => selectState(null));
    renderResults();
    const b = st.bounds;
    map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: padding(), duration: 700 });
  }

  /* -------------------------------------------------- Learn */
  $("#concepts").innerHTML = ATLAS.concepts.map((c, i) => `<details class="concept"${i === 0 ? " open" : ""}><summary>${esc(c.title)}</summary><p>${esc(c.body)}</p></details>`).join("");
  const SOURCES = [
    ["OpenStreetMap contributors", "https://www.openstreetmap.org/copyright", "Road geometry (ODbL), via RoadTracker India"],
    ["RoadTracker India", "https://github.com/ForPublicOrg/roadtrackerindia", "Road catalogue & OSM extracts"],
    ["DataMeet", "https://github.com/datameet/maps", "State boundaries (CC BY 4.0)"],
    ["Natural Earth", "https://www.naturalearthdata.com", "Rivers & neighbouring countries (public domain)"],
    ["NHAI · Rajmargyatra", "https://github.com/ForceGT/india-toll-plazas", "Toll plaza locations & rates"],
    ["MoRTH via PM GatiShakti", "https://github.com/yashveeeeeeer/india-geodata", "Highway lanes, agency, corridors (CC0, via india-geodata)"],
    ["Local Government Directory", "https://lgdirectory.gov.in", "District boundaries (CC0, via india-geodata)"],
    ["India Flood Inventory v3", "https://github.com/hydrosenselab/India-Flood-Inventory", "Flood events with mapped extent, 2014–16 (CC BY 4.0)"],
    ["Indian Railways GeoPortal · India-WRIS · Survey of India", "https://github.com/yashveeeeeeer/india-geodata", "Rail, stations, goods sheds, waterways, ferries (CC0)"],
    ["India Post · data.gov.in", "https://github.com/dropdevrahul/pincodes-india", "Post offices & PIN codes (GODL-India)"],
    ["MapLibre GL JS", "https://maplibre.org", "Map rendering (BSD-3)"]
  ].concat((ATLAS.sources || []).map((s) => [s.name, s.url, "Reference"]));
  $("#sources").innerHTML = SOURCES.map(([n, u, d]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a> <small>${esc(d)}</small></li>`).join("");
  $("#disclaimer").textContent = "Public information only, for general reference. Boundaries are indicative and not an authoritative depiction. Road status, tolls and permit rules change, so verify with NHAI, MoRTH or state authorities before operational use. Content reviewed " + ATLAS.meta.reviewed + ".";

  /* -------------------------------------------------- layers popover */
  const LAYER_DEFS = [
    ["nh", "National highways", "ln"], ["sh", "State & district roads", "ln thin"],
    ["city", "Cities", ""], ["town", "Towns", ""], ["toll", "Toll plazas", "sq"], ["locality", "Post offices (zoom in)", ""],
    ["rail", "Railways & goods sheds", "ln rail"], ["water", "Waterways & ferries", "ln water"], ["airport", "Airports", ""],
    ["districts", "District boundaries", "ln thin"], ["flood", "District floods 2014–16", "sq flood"]
  ];
  $("#layer-toggles").innerHTML = LAYER_DEFS.map(([k, label, shape]) => {
    const col = k === "nh" ? "var(--ink)" : k === "sh" ? "var(--ink-3)" : k === "rail" ? EXTRA_COLOR.station : k === "water" ? "#5b95b3" : k === "districts" ? "var(--line-2)" : k === "flood" ? "#4c93b8" : dotColor(k);
    return `<label><input type="checkbox" id="lyr-${k}" data-layer="${k}" ${S.layers[k] ? "checked" : ""} /><span class="sw"><i class="${shape}" style="background:${col}"></i></span>${label}</label>`;
  }).join("");
  $("#layer-toggles").addEventListener("change", (e) => {
    const k = e.target.dataset.layer; if (!k) return;
    S.layers[k] = e.target.checked;
    if (k === "nh") ["roads-nh", "roads-approx", "nh-labels"].forEach((l) => map.getLayer(l) && map.setLayoutProperty(l, "visibility", S.layers.nh ? "visible" : "none"));
    else if (k === "sh") map.getLayer("roads-minor") && map.setLayoutProperty("roads-minor", "visibility", S.layers.sh ? "visible" : "none");
    else if (k === "locality") ["locs", "loc-labels"].forEach((l) => map.getLayer(l) && map.setLayoutProperty(l, "visibility", S.layers.locality ? "visible" : "none"));
    else if (["rail", "water", "districts", "flood"].includes(k)) {
      const groups = { rail: ["rail-case", "rail-ties"], water: ["waterways", "ferries"], districts: ["district-lines", "district-labels"], flood: ["flood-fill"] };
      groups[k].forEach((l) => map.getLayer(l) && map.setLayoutProperty(l, "visibility", S.layers[k] ? "visible" : "none"));
      if (k === "rail") setPointFilters();
      if (k === "flood" && S.layers.flood) toast("Shading: mapped flood events per district, 2014–16 (India Flood Inventory v3).", 4200);
    }
    else setPointFilters();
  });
  function setPointFilters() {
    const on = (c) => (c === "station" || c === "shed" ? S.layers.rail : S.layers[c]);
    const f = (cats) => ["in", ["get", "cat"], ["literal", cats.filter(on)]];
    const pts = ["node", "bridge", "border", "toll", "shed", "airport"];
    map.getLayer("points") && map.setFilter("points", f(pts));
    map.getLayer("point-labels") && map.setFilter("point-labels", f(pts));
    map.getLayer("towns") && map.setFilter("towns", f(["town"]));
    map.getLayer("cities") && map.setFilter("cities", f(["city"]));
    map.getLayer("junctions") && map.setFilter("junctions", ["all", f(["station"]), ["==", ["get", "jn"], 1]]);
    map.getLayer("stations") && map.setFilter("stations", ["all", f(["station"]), ["==", ["get", "jn"], 0]]);
  }
  $("#layers-btn").addEventListener("click", () => {
    const L = $("#layers"); L.hidden = !L.hidden; $("#layers-btn").setAttribute("aria-expanded", !L.hidden);
  });
  document.addEventListener("click", (e) => {
    if (!$("#layers").hidden && !e.target.closest("#layers") && !e.target.closest("#layers-btn")) { $("#layers").hidden = true; $("#layers-btn").setAttribute("aria-expanded", "false"); }
  });
  $("#home-btn").addEventListener("click", () => map.fitBounds(REGION_BOUNDS, { padding: padding(), duration: 700 }));

  renderResults();
  if (isPhone()) setSheet("mid");
})();
