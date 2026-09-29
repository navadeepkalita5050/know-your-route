"""
Build the offline road network for the North-East Road Atlas.

Inputs (all public, downloaded beforehand):
  geom/<id>.json, roads/<id>.json  - OSM-derived road alignments + metadata
                                     (github.com/ForPublicOrg/roadtrackerindia, ODbL)
  dm_Admin2.*                       - state boundaries (DataMeet, CC BY 4.0)
  ne_admin0_ind.geojson             - neighbouring countries (Natural Earth, India POV, public domain)
  ne_10m_rivers_lake_centerlines    - rivers (Natural Earth, public domain)
  rt_latest.json                    - toll plazas (NHAI via github.com/ForceGT/india-toll-plazas)
Outputs: out/network.js, out/geo.js, out/roads.js, out/tolls.js
"""
import json, math, os, re, sys
from collections import defaultdict, Counter
import networkx as nx
from shapely.geometry import LineString, Point, shape, box, mapping
from shapely.ops import unary_union, nearest_points
from shapely.strtree import STRtree
from shapely.prepared import prep
from clip import roads, STATES, REGION, WBN, NE
from poly import hk

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
os.makedirs(OUT, exist_ok=True)

MAX_JUMP_KM = 30      # longer straight segments are data gaps -> dropped
GAP_KM = 5            # 5-30 km straight segments are bridged gaps -> length x1.2
SNAP_KM = 1.0         # dangling ends within this distance of another road are joined

# ---------------------------------------------------------------- load
R = roads()
print('roads in region', len(R))
parts = []  # (road_idx, [coords])
for ri, r in enumerate(R):
    for p in r['parts']:
        c = list(p.coords)
        cur = [c[0]]
        for a, b in zip(c, c[1:]):
            if hk(a, b) > MAX_JUMP_KM:
                if len(cur) > 1: parts.append((ri, cur))
                cur = [b]
            else:
                cur.append(b)
        if len(cur) > 1: parts.append((ri, cur))
parts = [(ri, c) for ri, c in parts if sum(hk(a, b) for a, b in zip(c, c[1:])) > 0.3]
print('parts', len(parts))

# ---------------------------------------------------------------- manual links
# Gaps in the source data, bridged by hand. 'approx' links are drawn dashed in the app.
MANUAL = [
    # NH 13 Tezpur - Balipara - Bhalukpong - Tenga approach (missing from source); indicative alignment
    ('NH 13', 'Tezpur–Balipara–Bhalukpong (approximate alignment)', True,
     [(92.79578, 26.65334), (92.7905, 26.7400), (92.7850, 26.8260), (92.7200, 26.9300), (92.6420, 27.0120), (92.6000, 27.0800), (92.57198, 27.16489)]),
    ('NH 27', 'NH 27 gap near Haflong', True, [(92.99274, 25.10818), (93.0183, 25.13214)]),
    ('NH 715', 'Jorhat town link', True, [(94.18195, 26.75168), (94.20079, 26.74411)]),
    ('NH 715', 'Jorhat town link', True, [(94.24048, 26.7748), (94.21175, 26.75392)]),
    ('NH 37', 'Silchar town link', True, [(92.8008, 24.8316), (92.79605, 24.84063)]),
    ('NH 37', 'Silchar town link', True, [(92.781, 24.83174), (92.78854, 24.84034)]),
    ('NH 37', 'Silchar town link', True, [(92.83387, 24.83915), (92.81516, 24.84848)]),
    ('NH 306', 'Silchar town link', True, [(92.79735, 24.81181), (92.79335, 24.83921)]),
    ('NH 8', 'Karimganj link', True, [(92.32487, 24.64096), (92.31733, 24.64893)]),
    ('NH 8', 'Karimganj link', True, [(92.39373, 24.84405), (92.35041, 24.86246)]),
    ('NH 710', 'NH 10 – NH 710 link', True, [(88.42851, 27.06546), (88.43117, 27.08155)]),
    ('NH 710', 'NH 710 gap', True, [(88.37135, 27.0987), (88.36124, 27.11214)]),
    ('NH 710', 'NH 710 gap', True, [(88.35687, 27.11229), (88.37135, 27.0987)]),
    ('NH 717A', 'NH 717A gap', True, [(88.63429, 27.18047), (88.62203, 27.16307)]),
    ('NH 510', 'NH 510 gap', True, [(88.257, 27.28957), (88.28227, 27.28469)]),
    ('NH 502', 'NH 502 gap', True, [(92.9725, 22.49219), (92.95672, 22.46458)]),
    ('NH 502A', 'NH 502A link', True, [(92.90329, 22.46219), (92.95477, 22.47014)]),
    ('NH 317', 'NH 317 link', True, [(89.33341, 26.7286), (89.36222, 26.74225)]),
    ('NH 306A', 'NH 306A link', True, [(92.75557, 24.48341), (92.71994, 24.49667)]),
    ('NH 127C', 'NH 127C link', True, [(90.48375, 26.85961), (90.52444, 26.83169)]),
    ('NH 117', 'Bijni link', True, [(90.64358, 26.48755), (90.69353, 26.5108)]),
    ('NH 8', 'NH 8 – NH 208A link', True, [(92.15225, 24.26521), (92.11759, 24.32033)]),
]
for ref, name, approx, pts in MANUAL:
    R.append(dict(id='manual-' + ref.lower().replace(' ', '-') + f'-{len(R)}', meta={'ref': ref, 'name': name, 'category': 'nh', 'approx': approx},
                  parts=[LineString(pts)], km=sum(hk(a, b) for a, b in zip(pts, pts[1:])), full=None))
    parts.append((len(R) - 1, list(pts)))

lines = [LineString(c) for _, c in parts]
tree = STRtree(lines)

# ---------------------------------------------------------------- snap dangling ends
DEG = SNAP_KM / 100.0
connectors = []
for i, (ri, c) in enumerate(parts):
    for end in (c[0], c[-1]):
        P = Point(end)
        best = None
        for j in tree.query(P.buffer(DEG)):
            j = int(j)
            if j == i: continue
            q = nearest_points(P, lines[j])[1]
            d = hk(end, (q.x, q.y))
            if d < 0.00005: best = None; break         # genuinely touching
            if d <= SNAP_KM and (best is None or d < best[0]):
                best = (d, (q.x, q.y))
        if best:
            (qx, qy) = best[1]; dx, dy = qx - end[0], qy - end[1]; L = math.hypot(dx, dy) or 1
            ext = 0.00003 / L   # overshoot ~3 m so the join is noded robustly
            connectors.append(LineString([end, (qx + dx * ext, qy + dy * ext)]))
print('connectors', len(connectors))

# ---------------------------------------------------------------- node everything
import shapely
merged = shapely.union_all(lines + connectors, grid_size=1e-6)
pieces = list(merged.geoms) if hasattr(merged, 'geoms') else [merged]
print('noded pieces', len(pieces))

def road_class(meta, rid):
    cat = (meta.get('category') or rid.split('-')[0]).lower()
    if cat.startswith('nh') or rid.startswith('nh-'): return 'nh'
    if cat.startswith('sh') or rid.startswith('sh-'): return 'sh'
    return 'other'

def four_lane(meta):
    l = (meta.get('lanes') or '').lower()
    return bool(re.match(r'(mostly )?(4|four|6|six)[ -]lane', l))

# attribute each piece to its road(s)
REFS, REF_IDX = [], {}
def ref_id(key):
    if key not in REF_IDX:
        REF_IDX[key] = len(REFS); REFS.append(key)
    return REF_IDX[key]

piece_attr = []
for pc in pieces:
    mid = pc.interpolate(0.5, normalized=True)
    cands = []
    for j in tree.query(mid.buffer(0.0004)):
        j = int(j)
        if lines[j].distance(mid) < 0.0003: cands.append(parts[j][0])
    cands = sorted(set(cands), key=lambda ri: ({'nh': 0, 'sh': 1, 'other': 2}[road_class(R[ri]['meta'], R[ri]['id'])], R[ri]['id']))
    if not cands:
        piece_attr.append(None)  # connector
    else:
        piece_attr.append(cands)

# ---------------------------------------------------------------- graph
def nkey(pt): return (round(pt[0], 6), round(pt[1], 6))
G = nx.MultiGraph()
for k, (pc, att) in enumerate(zip(pieces, piece_attr)):
    c = list(pc.coords)
    G.add_edge(nkey(c[0]), nkey(c[-1]), k=k)
comps = sorted(nx.connected_components(G), key=len, reverse=True)
def comp_km(cmp):
    return sum(pieces[d['k']].length * 105 for u, v, d in G.subgraph(cmp).edges(data=True))
print('components', len(comps), [round(comp_km(c)) for c in comps[:8]])

# ---------------------------------------------------------------- metrics
state_prep = [(s, prep(STATES[s])) for s in NE]
wb_prep = prep(WBN)
STATE_NAMES = NE + ['West Bengal']
def state_of(x, y):
    p = Point(x, y)
    for i, (s, pp) in enumerate(state_prep):
        if pp.contains(p): return i
    if wb_prep.contains(p): return len(NE)
    # nearest (border roads)
    best = min(range(len(NE)), key=lambda i: STATES[NE[i]].distance(p))
    return best

SPEED = {  # km/h  (car, truck)
    ('plain', 'nh4'): (62, 45), ('plain', 'nh2'): (50, 35), ('plain', 'sh'): (42, 30), ('plain', 'other'): (36, 25),
    ('rolling', 'nh4'): (46, 32), ('rolling', 'nh2'): (40, 27), ('rolling', 'sh'): (34, 23), ('rolling', 'other'): (30, 20),
    ('hill', 'nh4'): (34, 21), ('hill', 'nh2'): (30, 18), ('hill', 'sh'): (26, 16), ('hill', 'other'): (22, 14),
}
SPEED.update({('plain', 'single'): (40, 28), ('rolling', 'single'): (32, 21), ('hill', 'single'): (24, 14)})
LEN_FACTOR = {'plain': 1.01, 'rolling': 1.05, 'hill': 1.12}

# ---------------------------------------------------------------- MoRTH road character (PM GatiShakti, NH layer dated 30-06-2022)
import pyarrow.parquet as pq
from shapely import wkb
LANES = ['Not recorded', 'Single lane', 'Intermediate lane', '2-lane', '4-lane', '6-lane']
LANE_CODE = {'<2L': 1, 'IL': 2, '2L': 3, '4L': 4, '6L': 5}
AGENCIES = ['Not recorded', 'NHAI', 'NHIDCL', 'BRO', 'State PWD (NH wing)']
AG_CODE = {'NHAI': 1, 'NHIDCL': 2, 'BRO': 3, 'Road_Wing': 4, 'Road Wing': 4}
CORRIDORS = ['Other national highway', 'Economic corridor', 'National corridor', 'Border road', 'Feeder route', 'Peripheral connectivity road', 'NE connectivity (NEIP)']
region_p = prep(REGION)
morth = []
for r in pq.read_table('rel/GatiShakti_MORTH_National_Highways.parquet').to_pylist():
    if (r['status'] or 'EXISTING') != 'EXISTING': continue
    g = wkb.loads(r['geometry'])
    if not region_p.intersects(g): continue
    ref = ('NH ' + r['road_name'].replace('NH-', '').replace('NH', '').strip().upper()) if r['road_name'] else ''
    layer = r['layer'] or ''
    corr = 1 if 'Economic' in layer else 2 if ('National Corridor' in layer or 'GQ' in layer) else 3 if 'Border' in layer else 4 if 'Feeder' in layer else 5 if 'Peripheral' in layer else 6 if 'NEIP' in layer else 0
    morth.append((g, ref, LANE_CODE.get(r['lane_statu'], 0), AG_CODE.get(r['agency'], 0), corr, 1 if (r['level_5'] or '').startswith('Bharatmala') else 0))
mtree = STRtree([m[0] for m in morth])
print('MoRTH segments in region', len(morth))
def morth_at(x, y, refs):
    p = Point(x, y); best = None
    for j in mtree.query(p.buffer(0.006)):
        m = morth[int(j)]
        d = m[0].distance(p) * 105
        if d > 0.6: continue
        score = d - (1.0 if m[1] in refs else 0) - (0.05 if m[2] else 0)
        if best is None or score < best[0]: best = (score, m)
    return best[1] if best else None

# ---------------------------------------------------------------- current districts (LGD)
DIST_STATES = {'ASSAM': 'Assam', 'ARUNACHAL PRADESH': 'Arunachal Pradesh', 'MEGHALAYA': 'Meghalaya', 'MANIPUR': 'Manipur', 'MIZORAM': 'Mizoram',
               'NAGALAND': 'Nagaland', 'TRIPURA': 'Tripura', 'SIKKIM': 'Sikkim', 'WEST BENGAL': 'West Bengal'}
DISTS = []
for r in pq.read_table('rel/LGD_Districts.parquet').to_pylist():
    st = DIST_STATES.get((r['stname'] or '').strip().upper())
    if not st: continue
    g = wkb.loads(r['geometry'])
    if not g.is_valid: g = g.buffer(0)
    if not region_p.intersects(g) or (st == 'West Bengal' and g.intersection(REGION).area < 0.3 * g.area): continue
    DISTS.append({'name': r['dtname'].strip(), 'state': st, 'g': g, 'p': prep(g)})
dtree = STRtree([d['g'] for d in DISTS])
print('districts', len(DISTS))
def district_of(x, y):
    p = Point(x, y)
    cands = [int(j) for j in dtree.query(p.buffer(0.05))]
    for j in cands:
        if DISTS[j]['p'].contains(p): return j
    return min(cands, key=lambda j: DISTS[j]['g'].distance(p)) if cands else -1

def curvature_profile(c):
    """deg of heading change per km around each vertex, over a +-1.5 km window"""
    n = len(c)
    cum = [0.0]
    for a, b in zip(c, c[1:]): cum.append(cum[-1] + hk(a, b))
    turn = [0.0] * n
    for i in range(1, n - 1):
        a, b, d = c[i - 1], c[i], c[i + 1]
        k = math.cos(math.radians(b[1]))
        h1 = math.atan2(b[1] - a[1], (b[0] - a[0]) * k)
        h2 = math.atan2(d[1] - b[1], (d[0] - b[0]) * k)
        turn[i] = abs(math.degrees((h2 - h1 + math.pi) % (2 * math.pi) - math.pi))
    prof = []
    lo = hi = 0; s = 0.0
    for i in range(n):
        while hi < n and cum[hi] <= cum[i] + 1.5: s += turn[hi]; hi += 1
        while cum[lo] < cum[i] - 1.5: s -= turn[lo]; lo += 1
        span = min(cum[-1], cum[i] + 1.5) - max(0, cum[i] - 1.5)
        prof.append(s / max(span, 0.5))
    return prof, cum

def terrain(cv):
    return 'plain' if cv < 55 else ('rolling' if cv < 120 else 'hill')

def encode(coords):
    out = []; plat = plng = 0
    for x, y in coords:
        lat, lng = int(round(y * 1e5)), int(round(x * 1e5))
        for v in (lat - plat, lng - plng):
            v = ~(v << 1) if v < 0 else (v << 1)
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out.append(chr(v + 63))
        plat, plng = lat, lng
    return ''.join(out)

main = set().union(*[c for c in comps if comp_km(c) > 15])
node_id = {}
nodes = []
def nid(key):
    if key not in node_id:
        node_id[key] = len(nodes); nodes.append(key)
    return node_id[key]

edges = []
stats = Counter()
for k, (pc, att) in enumerate(zip(pieces, piece_attr)):
    c = list(pc.coords)
    if nkey(c[0]) not in main: continue
    if att:
        r0 = R[att[0]]; meta = r0['meta']
        cls = road_class(meta, r0['id'])
        lane = 'nh4' if cls == 'nh' and four_lane(meta) else ('nh2' if cls == 'nh' else cls)
        refs = []
        for ri in att:
            ref = R[ri]['meta'].get('ref') or R[ri]['id'].upper()
            if ref not in refs: refs.append(ref)
        refkey = ' / '.join(refs)
        road_ids = [R[ri]['id'] for ri in att if not R[ri]['id'].startswith('manual-')]
        approx = all(R[ri]['meta'].get('approx') for ri in att)
    else:
        approx = False
        cls, lane, refkey, road_ids = 'link', 'other', 'link', []
    prof, cum = curvature_profile(c)
    L = car = trk = hill = 0.0
    st = defaultdict(float); lanes = defaultdict(float); ags = defaultdict(float); corr = defaultdict(float); dists = defaultdict(float); bm = 0.0
    terr = Counter()
    edge_refs = refkey.split(' / ')
    for i, (a, b) in enumerate(zip(c, c[1:])):
        d = hk(a, b)
        t = terrain((prof[i] + prof[i + 1]) / 2)
        f = LEN_FACTOR[t] * (1.2 if d > GAP_KM else 1.0) * (1.15 if approx else 1.0)
        dd = d * f
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        seg_lane = lane
        if cls == 'nh':
            m = morth_at(mx, my, edge_refs)
            if m:
                lanes[m[2]] += dd; ags[m[3]] += dd; corr[m[4]] += dd; bm += dd * m[5]
                if m[2] >= 4: seg_lane = 'nh4'
                elif m[2] in (2, 3): seg_lane = 'nh2'
                elif m[2] == 1: seg_lane = 'single'
            else:
                lanes[0] += dd; ags[0] += dd
        dists[district_of(mx, my)] += dd
        v = SPEED[(t, seg_lane)]
        L += dd; car += dd / v[0] * 3600; trk += dd / v[1] * 3600
        if t != 'plain': hill += dd
        terr[t] += dd
        st[state_of((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)] += dd
    stats[cls] += L
    edges.append([
        nid(nkey(c[0])), nid(nkey(c[-1])), ref_id(refkey), round(L * 1000), round(car), round(trk), round(hill * 1000),
        encode(c), [[s, round(m * 1000)] for s, m in sorted(st.items(), key=lambda x: -x[1])],
        [round(terr['plain'] * 1000), round(terr['rolling'] * 1000), round(terr['hill'] * 1000)],
        {'nh': 0, 'sh': 1, 'other': 2, 'link': 3}[cls],
        [R.index(next(x for x in R if x['id'] == rid)) for rid in road_ids[:3]],
        1 if approx else 0,
        [[k, round(m * 1000)] for k, m in sorted(lanes.items(), key=lambda x: -x[1]) if m > 0.05],
        [[k, round(m * 1000)] for k, m in sorted(ags.items(), key=lambda x: -x[1]) if m > 0.05],
        [[k, round(m * 1000)] for k, m in sorted(corr.items(), key=lambda x: -x[1]) if m > 0.05],
        round(bm * 1000),
        [[k, round(m * 1000)] for k, m in sorted(dists.items(), key=lambda x: -x[1]) if m > 0.05 and k >= 0],
    ])
print('edges', len(edges), 'nodes', len(nodes), {k: round(v) for k, v in stats.items()})

road_meta = []
for r in R:
    if r['id'].startswith('manual-'): road_meta.append(None); continue
    m = r['meta']; rt = m.get('route') or {}
    road_meta.append({
        'id': r['id'], 'ref': m.get('ref') or r['id'].upper(), 'name': m.get('name') or '',
        'cls': road_class(m, r['id']), 'kmRegion': round(r['km']), 'kmTotal': m.get('lengthKm'),
        'lanes': m.get('lanes'), 'agency': m.get('agency'), 'status': m.get('status'),
        'start': rt.get('start'), 'end': rt.get('end'), 'states': rt.get('states') or [],
        'cities': rt.get('majorCities') or [],
    })

net = {'nodes': [[round(x, 5), round(y, 5)] for x, y in nodes], 'edges': edges, 'refs': REFS,
       'states': STATE_NAMES, 'terrain': ['plain', 'rolling', 'hill'], 'classes': ['nh', 'sh', 'other', 'link'],
       'lanes': LANES, 'agencies': AGENCIES, 'corridors': CORRIDORS, 'districts': [[d['name'], d['state']] for d in DISTS]}
with open(f'{OUT}/network.js', 'w') as f:
    f.write('/* Road network — derived from OpenStreetMap (© OpenStreetMap contributors, ODbL) via RoadTracker India. Built by tools/build_network.py */\n')
    f.write('window.NE_NET=' + json.dumps(net, separators=(',', ':')) + ';\n')
with open(f'{OUT}/roads.js', 'w') as f:
    f.write('/* Road catalogue metadata — RoadTracker India (ODbL / CC BY 4.0) */\n')
    f.write('window.NE_ROADS=' + json.dumps(road_meta, separators=(',', ':'), ensure_ascii=False) + ';\n')

# ---------------------------------------------------------------- geography layers
VIEW = box(86.0, 20.0, 99.5, 30.8)
def feat(g, props, tol):
    g = g.simplify(tol, preserve_topology=True)
    gj = mapping(g)
    def rnd(o):
        if isinstance(o, (list, tuple)):
            if o and isinstance(o[0], (int, float)): return [round(o[0], 4), round(o[1], 4)]
            return [rnd(x) for x in o]
        return o
    gj = {'type': gj['type'], 'coordinates': rnd(gj['coordinates'])}
    return {'type': 'Feature', 'properties': props, 'geometry': gj}

import shapefile
rd = shapefile.Reader('dm_Admin2')
allst = {rec[0]: shape(sh.__geo_interface__) for rec, sh in zip(rd.records(), rd.shapes())}
ABBR = {'Arunachal Pradesh': 'AR', 'Assam': 'AS', 'Manipur': 'MN', 'Meghalaya': 'ML', 'Mizoram': 'MZ',
        'Nagaland': 'NL', 'Sikkim': 'SK', 'Tripura': 'TR'}
states_fc = []
for s, g in allst.items():
    if not g.intersects(VIEW): continue
    ne = s in NE
    states_fc.append(feat(g.intersection(VIEW), {'name': s, 'ne': ne, 'abbr': ABBR.get(s, '')}, 0.004 if ne else 0.01))
labels = []
LABEL_POS = {'Arunachal Pradesh': (94.3, 28.1), 'Assam': (92.6, 26.35), 'Meghalaya': (91.3, 25.55), 'Nagaland': (94.35, 26.05),
             'Manipur': (93.85, 24.55), 'Mizoram': (92.85, 23.3), 'Tripura': (91.72, 23.75), 'Sikkim': (88.45, 27.62)}
for s, (x, y) in LABEL_POS.items():
    labels.append({'type': 'Feature', 'properties': {'name': s.upper()}, 'geometry': {'type': 'Point', 'coordinates': [x, y]}})

countries = []
a0 = json.load(open('ne_admin0_ind.geojson'))
for f in a0['features']:
    nm = f['properties'].get('NAME_EN') or f['properties'].get('NAME')
    g = shape(f['geometry'])
    if not g.intersects(VIEW): continue
    countries.append(feat(g.intersection(VIEW), {'name': nm, 'india': nm == 'India'}, 0.01))
country_labels = [{'type': 'Feature', 'properties': {'name': n}, 'geometry': {'type': 'Point', 'coordinates': c}} for n, c in
                  [('BHUTAN', [90.4, 27.45]), ('BANGLADESH', [90.2, 24.0]), ('MYANMAR', [95.6, 23.6]), ('CHINA', [92.5, 29.6]), ('NEPAL', [87.0, 27.9])]]

rivers = []
rv = json.load(open('ne_10m_rivers_lake_centerlines.geojson'))
for f in rv['features']:
    if not f['geometry']: continue
    g = shape(f['geometry'])
    if not g.intersects(VIEW): continue
    nm = f['properties'].get('name_en') or f['properties'].get('name') or ''
    rivers.append(feat(g.intersection(VIEW), {'name': nm, 'rank': f['properties'].get('scalerank', 9)}, 0.005))
print('geo', len(states_fc), len(countries), len(rivers), sorted(set(r['properties']['name'] for r in rivers)))
with open(f'{OUT}/geo.js', 'w') as f:
    f.write('/* Boundaries: states © DataMeet (CC BY 4.0); countries & rivers: Natural Earth (public domain). Not an authoritative depiction of boundaries. */\n')
    f.write('window.NE_GEO=' + json.dumps({'states': {'type': 'FeatureCollection', 'features': states_fc},
                                           'stateLabels': {'type': 'FeatureCollection', 'features': labels},
                                           'countries': {'type': 'FeatureCollection', 'features': countries},
                                           'countryLabels': {'type': 'FeatureCollection', 'features': country_labels},
                                           'rivers': {'type': 'FeatureCollection', 'features': rivers},
                                           'bounds': [87.6, 21.8, 97.6, 29.6]}, separators=(',', ':'), ensure_ascii=False) + ';\n')

# ---------------------------------------------------------------- tolls
tl = json.load(open('rt_latest.json'))
fl = lambda v: float(v) if v not in (None, '') else None
region_prep = prep(REGION)
tolls = []
def clean_nh(s):
    s = s or ''
    m = re.search(r'new\s*(?:nh\s*)?(\d+[A-Z]?)', s, re.I)
    if m: return 'NH ' + m.group(1).upper()
    m = re.search(r'(\d+[A-Z]?)', s)
    return ('NH ' + m.group(1).upper()) if m else ''
for t in tl:
    la, lo = fl(t.get('latitude')), fl(t.get('longitude'))
    if la is None or lo is None or not t.get('active', True): continue
    if not region_prep.contains(Point(lo, la)): continue
    nm = re.sub(r'\s+', ' ', (t.get('tollplaza_name') or '').replace('*', '')).strip()
    nm = re.sub(r'\s*\(\s*', ' (', nm).replace(' )', ')')
    if 'toll' not in nm.lower(): nm += ' Toll Plaza'
    tolls.append({'name': nm, 'state': (t.get('state_name') or '').title(), 'nh': clean_nh(t.get('nh_no')), 'nhRaw': t.get('nh_no'),
                  'lat': la, 'lng': lo, 
                  
                  'lanes': t.get('project_lanes'), 
                  'type': t.get('project_type'), 'len': t.get('tollable_length')})
print('tolls', len(tolls))
with open(f'{OUT}/tolls.js', 'w') as f:
    f.write('/* NHAI fee plazas — rates from NHAI Rajmargyatra via github.com/ForceGT/india-toll-plazas. Rates change: verify before use. */\n')
    f.write('window.NE_TOLLS=' + json.dumps(tolls, separators=(',', ':'), ensure_ascii=False) + ';\n')
for f in os.listdir(OUT): print(f, os.path.getsize(f'{OUT}/{f}'))

# ---------------------------------------------------------------- districts layer + flood history
ifi = json.load(open('rel/INDIA_FLOOD_INVENTORY_V3.geojson'))
floods = [shape(f['geometry']) for f in ifi['features'] if f['geometry']]
floods = [g if g.is_valid else g.buffer(0) for g in floods]
floods = [g for g in floods if g.intersects(REGION)]
ftree = STRtree(floods)
dfeats = []
for i, d in enumerate(DISTS):
    rp = d['g'].representative_point()
    n = sum(1 for j in ftree.query(rp) if floods[int(j)].contains(rp))
    d['floods'] = n
    dfeats.append(feat(d['g'].intersection(VIEW), {'i': i, 'name': d['name'], 'state': d['state'], 'floods': n}, 0.004))
with open(f'{OUT}/districts.js', 'w') as f:
    f.write('/* Districts: Local Government Directory boundaries (CC0, via india-geodata). floods = recorded flood events whose mapped extent covers the district (India Flood Inventory v3, events 2014-16 with mapped extent, CC BY 4.0). */\n')
    f.write('window.NE_DISTRICTS=' + json.dumps({'type': 'FeatureCollection', 'features': dfeats}, separators=(',', ':'), ensure_ascii=False) + ';\n')
print('districts.js', os.path.getsize(f'{OUT}/districts.js'), 'flood counts', sorted(((d['floods'], d['name']) for d in DISTS), reverse=True)[:12])
