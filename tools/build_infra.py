"""
Build data/infra.js — static multimodal layers for the North-East:
  rail lines, stations and goods sheds (Indian Railways GeoPortal / PM GatiShakti, CC0 via india-geodata),
  national waterways and IWT terminals (India-WRIS, CC0 via india-geodata),
  ferry crossings (Survey of India, CC0 via india-geodata),
  commercial airports (curated list, public information).
"""
import json, re, sys, os
import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import LineString, MultiLineString, Point
from shapely.ops import linemerge, unary_union
from shapely.prepared import prep
from clip import REGION
from build_network_encode import encode

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out/infra.js'
RP = prep(REGION)

def rows(f):
    for r in pq.read_table('rel/' + f).to_pylist():
        g = wkb.loads(r['geometry'])
        if RP.intersects(g):
            r['g'] = g
            yield r

def title(s):
    s = re.sub(r'\s+', ' ', (s or '').strip())
    return ' '.join(w if (w.isupper() and len(w) <= 3 and w in ('JN', 'JN.')) else w.capitalize() for w in s.split(' ')).replace('Jn.', 'Jn').replace('Jn ', 'Jn ')

def lines_of(g):
    if g.geom_type == 'LineString': return [g]
    if g.geom_type == 'MultiLineString': return list(g.geoms)
    return [x for x in getattr(g, 'geoms', []) if x.geom_type == 'LineString']

# ---- rail lines
rail = [l for r in rows('IR_Tracks.parquet') for l in lines_of(r['g'].intersection(REGION))]
rail = lines_of(linemerge(unary_union(rail)))
rail = [l.simplify(0.0007) for l in rail if l.length > 0.002]
rail_enc = [encode(list(l.coords)) for l in rail]
print('rail lines', len(rail), 'km', round(sum(l.length for l in rail) * 105))

# ---- stations
TYPES = {'JUNCTION': 'Junction', 'CROSSING STN': 'Station', 'HALT': 'Halt', 'TERMINUS': 'Terminus'}
stations, seen = [], set()
for r in rows('IR_Stations.parquet'):
    code = (r['sttncode'] or '').strip()
    if not code or code in seen: continue
    seen.add(code)
    name = title(r['sttnname'])
    t = TYPES.get((r['sttntype'] or '').strip(), 'Station')
    if re.search(r'\bJN\.?\b|JUNCTION', (r['sttnname'] or '').upper()): t = 'Junction'
    stations.append([name, code, t, round(r['g'].x, 5), round(r['g'].y, 5), (r['division'] or '').strip()])
print('stations', len(stations), sum(1 for s in stations if s[2] == 'Junction'))

# ---- goods sheds
sheds, seen = [], set()
for r in rows('GatiShakti_Railway_Goods_Sheds.parquet'):
    code = (r['goods_shed'] or '').strip()
    key = code or r['name']
    if key in seen: continue
    seen.add(key)
    sheds.append([title(r['name']), code, (r['division'] or '').strip(), title(r['dist_name']), title(r['state_name']), round(r['g'].x, 5), round(r['g'].y, 5)])
print('goods sheds', len(sheds))

# ---- waterways
ww = []
for r in rows('WRIS_Waterways.parquet'):
    for l in lines_of(r['g'].intersection(REGION)):
        ww.append([r['wway'], (r['descript'] or '').strip(), encode(list(l.simplify(0.001).coords))])
fac = [[r['name'], r['type'], round(r['g'].x, 5), round(r['g'].y, 5)] for r in rows('WRIS_Waterway_facilities.parquet') if r['type'] == 'Terminal']
print('waterways', len(ww), 'terminals', fac)

# ---- ferries
fer = []
for r in rows('SOI_Ferries.parquet'):
    for l in lines_of(r['g']):
        if l.length * 105 < 0.08: continue
        fer.append([title(r['district']), encode(list(l.simplify(0.0002).coords))])
print('ferries', len(fer))

# ---- airports (commercial / civil enclaves with scheduled or regional service; public information)
AIRPORTS = [
    ['Lokpriya Gopinath Bordoloi International Airport', 'GAU', 'Guwahati', 'Assam', 91.5859, 26.1061],
    ['Bagdogra Airport', 'IXB', 'Siliguri', 'West Bengal', 88.3286, 26.6812],
    ['Silchar Airport (Kumbhirgram)', 'IXS', 'Silchar', 'Assam', 92.9787, 24.9129],
    ['Dibrugarh Airport (Mohanbari)', 'DIB', 'Dibrugarh', 'Assam', 95.0169, 27.4839],
    ['Jorhat Airport (Rowriah)', 'JRH', 'Jorhat', 'Assam', 94.1755, 26.7315],
    ['Tezpur Airport (Salonibari)', 'TEZ', 'Tezpur', 'Assam', 92.7847, 26.7091],
    ['Lilabari Airport', 'IXI', 'North Lakhimpur', 'Assam', 94.0976, 27.2955],
    ['Rupsi Airport', 'RUP', 'Dhubri', 'Assam', 89.9100, 26.1397],
    ['Bir Tikendrajit International Airport', 'IMF', 'Imphal', 'Manipur', 93.8967, 24.7600],
    ['Maharaja Bir Bikram Airport', 'IXA', 'Agartala', 'Tripura', 91.2404, 23.8870],
    ['Lengpui Airport', 'AJL', 'Aizawl', 'Mizoram', 92.6197, 23.8406],
    ['Dimapur Airport', 'DMU', 'Dimapur', 'Nagaland', 93.7711, 25.8839],
    ['Shillong Airport (Umroi)', 'SHL', 'Shillong', 'Meghalaya', 91.9787, 25.7036],
    ['Pakyong Airport', 'PYG', 'Gangtok', 'Sikkim', 88.5864, 27.2334],
    ['Donyi Polo Airport (Hollongi)', 'HGI', 'Itanagar', 'Arunachal Pradesh', 93.6433, 26.9706],
    ['Pasighat Airport', 'IXT', 'Pasighat', 'Arunachal Pradesh', 95.3356, 28.0661],
    ['Tezu Airport', 'TEI', 'Tezu', 'Arunachal Pradesh', 96.1344, 27.9412],
    ['Cooch Behar Airport', 'COH', 'Cooch Behar', 'West Bengal', 89.4672, 26.3305],
]
data = {'rail': rail_enc, 'stations': stations, 'sheds': sheds, 'waterways': ww, 'terminals': fac, 'ferries': fer, 'airports': AIRPORTS}
with open(OUT, 'w') as f:
    f.write('/* Multimodal layers — rail lines & stations: Indian Railways GeoPortal; goods sheds: PM GatiShakti; waterways & terminals: India-WRIS; ferries: Survey of India '
            '(all CC0 via github.com/yashveeeeeeer/india-geodata). Airports: public information. */\n')
    f.write('window.NE_INFRA=' + json.dumps(data, separators=(',', ':'), ensure_ascii=False) + ';\n')
print('bytes', os.path.getsize(OUT))
