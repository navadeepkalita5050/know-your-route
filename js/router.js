/* =========================================================================
   Offline road router — runs entirely in the browser, no API calls.
   Works on the pre-built network in data/network.js.

   Edge format (see tools/build_network.py):
   [fromNode, toNode, refIdx, lengthM, carSeconds, truckSeconds, hillM,
    encodedPolyline, [[stateIdx, metres], …], terrainMajor, class, [roadIdx…], approx]
   ========================================================================= */
(function () {
  "use strict";

  const R_EARTH = 6371008.8;
  const toRad = Math.PI / 180;

  function hav(a, b) {
    const dLat = (b[1] - a[1]) * toRad, dLng = (b[0] - a[0]) * toRad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(x)));
  }

  function decode(str) {
    const out = [];
    let i = 0, lat = 0, lng = 0;
    while (i < str.length) {
      for (let k = 0; k < 2; k++) {
        let shift = 0, res = 0, b;
        do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const d = res & 1 ? ~(res >> 1) : res >> 1;
        if (k === 0) lat += d; else lng += d;
      }
      out.push([lng / 1e5, lat / 1e5]);
    }
    return out;
  }

  /* Minimal binary heap keyed on [cost, node] */
  class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(c, n) {
      const a = this.a; a.push([c, n]);
      let i = a.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last; let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < a.length && a[l][0] < a[m][0]) m = l;
          if (r < a.length && a[r][0] < a[m][0]) m = r;
          if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
        }
      }
      return top;
    }
  }

  class Router {
    constructor(net) {
      this.net = net;
      this.nodes = net.nodes;
      this.edges = net.edges.map((e, i) => {
        const coords = decode(e[7]);
        const cum = [0];
        for (let k = 1; k < coords.length; k++) cum.push(cum[k - 1] + hav(coords[k - 1], coords[k]));
        let minX = 180, minY = 90, maxX = -180, maxY = -90;
        for (const [x, y] of coords) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        return {
          i, a: e[0], b: e[1], ref: net.refs[e[2]], len: e[3], car: e[4], truck: e[5], hill: e[6],
          coords, cum, geo: cum[cum.length - 1] || 1, states: e[8], terrain: e[9], cls: e[10], roads: e[11] || [], approx: !!e[12],
          lanes: e[13] || [], agencies: e[14] || [], corridors: e[15] || [], bharatmala: e[16] || 0, districts: e[17] || [],
          bbox: [minX, minY, maxX, maxY]
        };
      });
      // adjacency
      this.adj = new Map();
      for (const e of this.edges) {
        if (!this.adj.has(e.a)) this.adj.set(e.a, []);
        if (!this.adj.has(e.b)) this.adj.set(e.b, []);
        this.adj.get(e.a).push(e); this.adj.get(e.b).push(e);
      }
      // connected components; routing uses the largest
      const comp = new Map(); let cid = 0; const compLen = [];
      for (const start of this.adj.keys()) {
        if (comp.has(start)) continue;
        let len = 0; const stack = [start]; comp.set(start, cid);
        while (stack.length) {
          const u = stack.pop();
          for (const e of this.adj.get(u)) {
            const v = e.a === u ? e.b : e.a;
            if (!comp.has(v)) { comp.set(v, cid); stack.push(v); len += e.len; }
          }
        }
        compLen.push(len); cid++;
      }
      const main = compLen.indexOf(Math.max(...compLen));
      this.comp = comp; this.mainComp = main;
      for (const e of this.edges) e.main = comp.get(e.a) === main;
      // coarse spatial grid for snapping (0.25° cells)
      this.grid = new Map();
      const G = 0.25;
      this.edges.forEach((e) => {
        if (!e.main) return;
        for (let gx = Math.floor(e.bbox[0] / G); gx <= Math.floor(e.bbox[2] / G); gx++)
          for (let gy = Math.floor(e.bbox[1] / G); gy <= Math.floor(e.bbox[3] / G); gy++) {
            const k = gx + ":" + gy;
            if (!this.grid.has(k)) this.grid.set(k, []);
            this.grid.get(k).push(e);
          }
      });
      this.G = G;
    }

    /** Nearest point on the (main) network to [lng, lat]. */
    snap(pt) {
      const G = this.G, gx0 = Math.floor(pt[0] / G), gy0 = Math.floor(pt[1] / G);
      let best = null;
      for (let r = 0; r <= 6 && (!best || r <= 1 + Math.ceil(best.dist / 25000)); r++) {
        for (let gx = gx0 - r; gx <= gx0 + r; gx++)
          for (let gy = gy0 - r; gy <= gy0 + r; gy++) {
            if (r && Math.abs(gx - gx0) !== r && Math.abs(gy - gy0) !== r) continue;
            const list = this.grid.get(gx + ":" + gy);
            if (!list) continue;
            for (const e of list) this._snapEdge(e, pt, (s) => { if (!best || s.dist < best.dist) best = s; });
          }
      }
      return best;
    }

    _snapEdge(e, pt, cb) {
      const k = Math.cos(pt[1] * toRad);
      const c = e.coords;
      for (let s = 0; s < c.length - 1; s++) {
        const ax = c[s][0] * k, ay = c[s][1], bx = c[s + 1][0] * k, by = c[s + 1][1];
        const px = pt[0] * k, py = pt[1];
        const dx = bx - ax, dy = by - ay, dd = dx * dx + dy * dy;
        let t = dd ? ((px - ax) * dx + (py - ay) * dy) / dd : 0;
        t = Math.max(0, Math.min(1, t));
        const q = [c[s][0] + (c[s + 1][0] - c[s][0]) * t, c[s][1] + (c[s + 1][1] - c[s][1]) * t];
        const dist = hav(pt, q);
        const along = e.cum[s] + (e.cum[s + 1] - e.cum[s]) * t;
        cb({ edge: e, seg: s, t, point: q, dist, frac: along / e.geo });
      }
    }

    /**
     * Route between two points. mode: "car" | "truck".
     * Returns null when either point can't be reached from the network.
     */
    route(from, to, mode) {
      const sa = this.snap(from), sb = this.snap(to);
      if (!sa || !sb) return null;
      const W = (e) => (mode === "truck" ? e.truck : e.car);

      const dist = new Map(), prev = new Map(), heap = new Heap();
      const seed = (node, cost) => {
        if (cost < (dist.get(node) ?? Infinity)) { dist.set(node, cost); prev.set(node, null); heap.push(cost, node); }
      };
      seed(sa.edge.a, W(sa.edge) * sa.frac);
      seed(sa.edge.b, W(sa.edge) * (1 - sa.frac));
      const exit = new Map([[sb.edge.a, W(sb.edge) * sb.frac], [sb.edge.b, W(sb.edge) * (1 - sb.frac)]]);
      let best = Infinity, bestNode = null;
      if (sa.edge === sb.edge) best = Math.abs(sa.frac - sb.frac) * W(sa.edge);

      const done = new Set();
      while (heap.size) {
        const [c, u] = heap.pop();
        if (c > best) break;
        if (done.has(u)) continue; done.add(u);
        if (exit.has(u) && c + exit.get(u) < best) { best = c + exit.get(u); bestNode = u; }
        for (const e of this.adj.get(u) || []) {
          const v = e.a === u ? e.b : e.a;
          const nc = c + W(e);
          if (nc < (dist.get(v) ?? Infinity)) { dist.set(v, nc); prev.set(v, { u, e }); heap.push(nc, v); }
        }
      }
      if (!isFinite(best)) return null;

      // Assemble pieces: [edge, fracStart, fracEnd] in travel order
      const pieces = [];
      if (bestNode === null) {
        pieces.push([sa.edge, sa.frac, sb.frac]);
      } else {
        const mid = [];
        let n = bestNode;
        while (prev.get(n)) { const { u, e } = prev.get(n); mid.push([e, e.a === u ? 0 : 1, e.a === u ? 1 : 0]); n = u; }
        mid.reverse();
        const startNode = n;
        pieces.push([sa.edge, sa.frac, startNode === sa.edge.a ? 0 : 1]);
        pieces.push(...mid);
        pieces.push([sb.edge, bestNode === sb.edge.a ? 0 : 1, sb.frac]);
      }
      return this._summarise(pieces, sa, sb, mode);
    }

    _slice(e, f0, f1) {
      const lo = Math.min(f0, f1) * e.geo, hi = Math.max(f0, f1) * e.geo;
      const c = e.coords, cum = e.cum, out = [];
      const at = (d) => {
        let s = 0; while (s < cum.length - 2 && cum[s + 1] < d) s++;
        const span = cum[s + 1] - cum[s] || 1, t = Math.max(0, Math.min(1, (d - cum[s]) / span));
        return [c[s][0] + (c[s + 1][0] - c[s][0]) * t, c[s][1] + (c[s + 1][1] - c[s][1]) * t];
      };
      out.push(at(lo));
      for (let s = 0; s < c.length; s++) if (cum[s] > lo && cum[s] < hi) out.push(c[s]);
      out.push(at(hi));
      return f0 <= f1 ? out : out.reverse();
    }

    _summarise(pieces, sa, sb, mode) {
      const path = [];
      let len = 0, car = 0, truck = 0, hill = 0, approx = 0;
      const refs = new Map(), states = new Map(), terrain = [0, 0, 0], roads = new Map();
      const lanes = new Map(), agencies = new Map(), corridors = new Map(), districts = new Map();
      let bharatmala = 0;
      const addAll = (map, list, f) => { for (const [k, m] of list) map.set(k, (map.get(k) || 0) + m * f); };
      const steps = [];   // ordered pieces, for the leg-by-leg route sheet
      for (const [e, f0, f1] of pieces) {
        const f = Math.abs(f1 - f0);
        if (f <= 0) continue;
        const seg = this._slice(e, f0, f1);
        const from = Math.max(0, path.length - 1);
        if (path.length) seg.shift();
        path.push(...seg);
        const m = e.len * f;
        steps.push({
          ref: e.ref === "link" ? null : e.ref.split(" / ")[0], allRefs: e.ref, cls: e.cls, road: e.roads.length ? e.roads[0] : -1,
          m, car: e.car * f, truck: e.truck * f, terrain: e.terrain.map((t) => t * f),
          lanes: e.lanes.map(([k, lm]) => [k, lm * f]), agencies: e.agencies.map(([k, am]) => [k, am * f]),
          states: e.states.map(([k, sm]) => [k, sm * f]), districts: e.districts.map(([k, dm]) => [k, dm * f]),
          approx: e.approx, from, to: path.length - 1
        });
        len += m; car += e.car * f; truck += e.truck * f; hill += e.hill * f;
        if (e.approx) approx += m;
        const primary = e.ref === "link" ? null : e.ref.split(" / ")[0];
        if (primary) refs.set(primary, (refs.get(primary) || 0) + m);
        for (const [s, sm] of e.states) states.set(s, (states.get(s) || 0) + sm * f);
        for (let k = 0; k < 3; k++) terrain[k] += (e.terrain[k] || 0) * f;
        addAll(lanes, e.lanes, f); addAll(agencies, e.agencies, f); addAll(corridors, e.corridors, f); addAll(districts, e.districts, f);
        bharatmala += e.bharatmala * f;
        if (e.roads.length) roads.set(e.roads[0], (roads.get(e.roads[0]) || 0) + m);
      }
      // hill metres are "not plain" (rolling + hill); split terrain using the per-edge majority as a guide
      const cumPath = [0];
      for (let k = 1; k < path.length; k++) cumPath.push(cumPath[k - 1] + hav(path[k - 1], path[k]));
      return {
        path, cumPath, mode,
        distance: len, car, truck, hillShare: len ? hill / len : 0, approx,
        terrain: (() => { const t = terrain[0] + terrain[1] + terrain[2] || 1; return terrain.map((x) => x / t); })(),
        refs: [...refs.entries()].sort((a, b) => b[1] - a[1]),
        states: [...states.entries()].sort((a, b) => b[1] - a[1]).map(([s, m]) => [this.net.states[s], m]),
        roads: [...roads.entries()].sort((a, b) => b[1] - a[1]),
        lanes: [...lanes.entries()].sort((a, b) => b[1] - a[1]),
        agencies: [...agencies.entries()].sort((a, b) => b[1] - a[1]),
        corridors: [...corridors.entries()].sort((a, b) => b[1] - a[1]),
        districts: [...districts.entries()].sort((a, b) => b[1] - a[1]),
        bharatmala, steps,
        snapFrom: sa, snapTo: sb
      };
    }

    /**
     * Travel time (s) from a point to every node of the network, up to maxS.
     * Returns { time: Map(node -> s), snap } for drawing reach maps.
     */
    reach(pt, mode, maxS) {
      const sa = this.snap(pt);
      if (!sa) return null;
      const W = (e) => (mode === "truck" ? e.truck : e.car);
      const access = (sa.dist * 1.3) / ((mode === "truck" ? 20 : 30) / 3.6);
      const time = new Map(), heap = new Heap();
      const seed = (n, c) => { if (c < (time.get(n) ?? Infinity)) { time.set(n, c); heap.push(c, n); } };
      seed(sa.edge.a, access + W(sa.edge) * sa.frac);
      seed(sa.edge.b, access + W(sa.edge) * (1 - sa.frac));
      const done = new Set();
      while (heap.size) {
        const [c, u] = heap.pop();
        if (c > maxS) break;
        if (done.has(u)) continue; done.add(u);
        for (const e of this.adj.get(u) || []) {
          const v = e.a === u ? e.b : e.a, nc = c + W(e);
          if (nc < (time.get(v) ?? Infinity)) { time.set(v, nc); heap.push(nc, v); }
        }
      }
      return { time, snap: sa, access };
    }

    /** Nearest network node to a point (grid lookup), for quick reach estimates of many points. */
    nearestNode(pt) {
      if (!this.nodeGrid) {
        this.nodeGrid = new Map();
        for (const n of this.adj.keys()) {
          if (this.comp.get(n) !== this.mainComp) continue;
          const [x, y] = this.nodes[n], k = Math.floor(x / 0.1) + ":" + Math.floor(y / 0.1);
          if (!this.nodeGrid.has(k)) this.nodeGrid.set(k, []);
          this.nodeGrid.get(k).push(n);
        }
      }
      const gx = Math.floor(pt[0] / 0.1), gy = Math.floor(pt[1] / 0.1);
      let best = null;
      for (let r = 0; r <= 8 && !best; r++)
        for (let x = gx - r; x <= gx + r; x++)
          for (let y = gy - r; y <= gy + r; y++) {
            for (const n of this.nodeGrid.get(x + ":" + y) || []) {
              const d = hav(pt, this.nodes[n]);
              if (!best || d < best.d) best = { n, d };
            }
          }
      return best;
    }

    /** Distance (m) from pt to the path, and km along it at the closest point. */
    static nearPath(pt, path, cumPath, maxM) {
      const k = Math.cos(pt[1] * toRad), deg = maxM / 111000;
      let best = null;
      for (let s = 0; s < path.length - 1; s++) {
        const a = path[s], b = path[s + 1];
        if (Math.min(a[0], b[0]) - deg / k > pt[0] || Math.max(a[0], b[0]) + deg / k < pt[0] ||
            Math.min(a[1], b[1]) - deg > pt[1] || Math.max(a[1], b[1]) + deg < pt[1]) continue;
        const ax = a[0] * k, ay = a[1], bx = b[0] * k, by = b[1], px = pt[0] * k, py = pt[1];
        const dx = bx - ax, dy = by - ay, dd = dx * dx + dy * dy;
        const t = dd ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / dd)) : 0;
        const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const d = hav(pt, q);
        if (d <= maxM && (!best || d < best.d)) best = { d, at: cumPath[s] + (cumPath[s + 1] - cumPath[s]) * t };
      }
      return best;
    }
  }

  Router.hav = hav;
  Router.decode = decode;
  window.NERouter = Router;
})();
