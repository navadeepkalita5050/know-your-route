"""
Build data/localities.js — every post office (and so every PIN code) in the eight
North-East states plus north Bengal, with cleaned coordinates.

Source: All India Pincode Directory, Department of Posts (data.gov.in, Government
Open Data Licence – India), as mirrored at github.com/dropdevrahul/pincodes-india.

Coordinates in the source are self-reported and noisy. Cleaning:
  1. parse; fix swapped lat/lng; must fall inside the office's own state (+~10 km)
  2. per PIN, take the median of valid offices; offices > 35 km from it are rejected
  3. offices without a usable point take their PIN's median   (quality 1)
  4. PINs without any usable point take their district's median (quality 2)
"""
import csv, json, re, statistics, sys
from collections import defaultdict
from shapely.geometry import Point
from shapely.prepared import prep
from clip import STATES, WBN
from poly import hk

SRC = 'pin/dropdevrahul_pincodes-india_main_pincode.csv'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'out/localities.js'
NE = {'ASSAM': 'Assam', 'ARUNACHAL PRADESH': 'Arunachal Pradesh', 'MEGHALAYA': 'Meghalaya', 'MANIPUR': 'Manipur',
      'MIZORAM': 'Mizoram', 'NAGALAND': 'Nagaland', 'TRIPURA': 'Tripura', 'SIKKIM': 'Sikkim'}
WB_DIST = ('DARJEELING', 'JALPAIGURI', 'ALIPURDUAR', 'KALIMPONG', 'COOCH')

poly = {s: prep(STATES[s].buffer(0.1)) for s in NE.values()}
poly['West Bengal'] = prep(WBN.buffer(0.1))

def title(s):
    s = s.strip()
    words = []
    for w in re.split(r'(\s+|-|\()', s.lower()):
        if re.fullmatch(r'[ivx]+', w or '') and len(w) <= 4: words.append(w.upper()); continue
        words.append(w[:1].upper() + w[1:] if w else w)
    return ''.join(words)

def clean_name(n):
    n = re.sub(r'\s+(B\.?O|S\.?O|H\.?O|P\.?O)\.?$', '', n.strip(), flags=re.I)
    n = re.sub(r'\s+', ' ', n)
    if n.isupper() or n.islower(): n = title(n)
    return n

rows = []
for r in csv.DictReader(open(SRC, encoding='utf-8', errors='replace')):
    st = r['StateName'].strip().upper()
    if st in NE: state = NE[st]
    elif st == 'WEST BENGAL' and r['District'].strip().upper().startswith(WB_DIST): state = 'West Bengal'
    else: continue
    try:
        la, lo = float(r['Latitude']), float(r['Longitude'])
        if la > 60 and lo < 60: la, lo = lo, la
        ok = 21 < la < 30 and 87.5 < lo < 98 and poly[state].contains(Point(lo, la))
    except ValueError:
        ok, la, lo = False, None, None
    rows.append(dict(name=clean_name(r['OfficeName']), pin=r['Pincode'].strip(), district=title(r['District']), state=state,
                     type=r['OfficeType'].strip(), lat=la if ok else None, lng=lo if ok else None))
print('offices', len(rows), 'with raw coords', sum(1 for r in rows if r['lat'] is not None))

# A point shared by offices in 3+ different PINs is a district/sub-division centroid, not a real location
from collections import Counter
share = defaultdict(set)
for r in rows:
    if r['lat'] is not None: share[(round(r['lat'], 3), round(r['lng'], 3))].add(r['pin'])
centroid_pts = {k for k, v in share.items() if len(v) >= 3}
for r in rows:
    if r['lat'] is not None and (round(r['lat'], 3), round(r['lng'], 3)) in centroid_pts:
        r['centroid'] = (r['lng'], r['lat']); r['lat'] = r['lng'] = None
print('centroid-like points', len(centroid_pts))

# Offices named after a checked town/place take that point (curated list in data/atlas.js)
import json as _j
atlas = _j.loads(open('/home/claude/ne-road-atlas/data/atlas.js').read().split('=', 1)[1].rstrip(';\n'))
known = {}
for n, st, lng, lat in atlas['towns']:
    known[(re.sub(r'\s*\(.*\)', '', n).lower(), st)] = (lng, lat)
for p in atlas['places']:
    if p['cat'] in ('city', 'border', 'node') and not p.get('approx'):
        known.setdefault((p['name'].split(' (')[0].lower(), p['state']), (p['lng'], p['lat']))
known[('moreh', 'Manipur')] = (94.30, 24.25)
fixed = 0
for r in rows:
    k = (re.sub(r'\s+(bazar|town|h\.?o|s\.?o)$', '', r['name'].lower()).strip(), r['state'])
    if k in known:
        r['lng'], r['lat'] = known[k]; r['curated'] = True; fixed += 1
print('curated overrides', fixed)

by_pin = defaultdict(list)
for r in rows:
    if r['lat'] is not None: by_pin[r['pin']].append((r['lng'], r['lat']))
pin_med = {}
for pin, pts in by_pin.items():
    m = (statistics.median(p[0] for p in pts), statistics.median(p[1] for p in pts))
    good = [p for p in pts if hk(p, m) < 35]
    if good: m = (statistics.median(p[0] for p in good), statistics.median(p[1] for p in good))
    pin_med[pin] = m

by_dist = defaultdict(list)
for r in rows:
    if r['lat'] is not None and hk((r['lng'], r['lat']), pin_med[r['pin']]) < 35:
        by_dist[(r['state'], r['district'])].append((r['lng'], r['lat']))
dist_med = {k: (statistics.median(p[0] for p in v), statistics.median(p[1] for p in v)) for k, v in by_dist.items()}
by_dist_c = defaultdict(list)
for r in rows:
    if r.get('centroid'): by_dist_c[(r['state'], r['district'])].append(r['centroid'])
for k, v in by_dist_c.items():
    dist_med.setdefault(k, (statistics.median(p[0] for p in v), statistics.median(p[1] for p in v)))
# PINs with no own point but whose offices shared a centroid: use it at PIN level
for r in rows:
    if r['pin'] not in pin_med and r.get('centroid'): pin_med.setdefault(r['pin'] + '#c', r['centroid'])

out, q = [], [0, 0, 0, 0]
for r in rows:
    if r.get('curated'):
        lng, lat, quality = r['lng'], r['lat'], 0
    elif r['lat'] is not None and hk((r['lng'], r['lat']), pin_med[r['pin']]) < 35:
        lng, lat, quality = r['lng'], r['lat'], 0
    elif r['pin'] in pin_med:
        (lng, lat), quality = pin_med[r['pin']], 1
    elif (r['state'], r['district']) in dist_med:
        (lng, lat), quality = dist_med[(r['state'], r['district'])], 2
    elif r.get('centroid'):
        (lng, lat), quality = r['centroid'], 2
    else:
        q[3] += 1; continue
    q[quality] += 1
    out.append((r, round(lng, 4), round(lat, 4), quality))
print('placed exact/pin/district/dropped', q)

STATES_L = ['Assam', 'Arunachal Pradesh', 'Meghalaya', 'Manipur', 'Mizoram', 'Nagaland', 'Tripura', 'Sikkim', 'West Bengal']
districts = sorted({(r['state'], r['district']) for r, *_ in out})
d_idx = {d: i for i, d in enumerate(districts)}
TYPES = {'HO': 0, 'PO': 1, 'BO': 2}
data = {
    'states': STATES_L,
    'districts': [[STATES_L.index(s), d] for s, d in districts],
    # [name, pin, districtIdx, lng, lat, type(0 head / 1 sub / 2 branch office), quality(0 own point, 1 PIN centre, 2 district centre)]
    'rows': [[r['name'], int(r['pin']), d_idx[(r['state'], r['district'])], lng, lat, TYPES.get(r['type'], 2), qu]
             for r, lng, lat, qu in sorted(out, key=lambda x: (x[0]['pin'], x[0]['type'], x[0]['name']))],
}
with open(OUT, 'w') as f:
    f.write('/* Post offices & PIN codes — Department of Posts, All India Pincode Directory (data.gov.in, GODL-India). Coordinates cleaned by tools/build_pincodes.py; many are approximate. */\n')
    f.write('window.NE_LOCALITIES=' + json.dumps(data, separators=(',', ':'), ensure_ascii=False) + ';\n')
import os
print('districts', len(districts), 'pins', len({r['pin'] for r, *_ in out}), 'bytes', os.path.getsize(OUT))
