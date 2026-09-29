import json,os,glob
from poly import decode,hk
import shapefile
from shapely.geometry import shape, LineString, box
from shapely.ops import unary_union
r=shapefile.Reader('dm_Admin2')
NE=['Arunachal Pradesh','Assam','Manipur','Meghalaya','Mizoram','Nagaland','Sikkim','Tripura']
STATES={rec[0]:shape(sh.__geo_interface__) for rec,sh in zip(r.records(),r.shapes()) if rec[0] in NE+['West Bengal']}
WBN=STATES['West Bengal'].intersection(box(87.9,25.9,89.95,27.3))
REGION=unary_union([STATES[s] for s in NE]+[WBN]).buffer(0.03)
def lj(p):
    try: return json.load(open(p))
    except Exception: return None
def roads():
    out=[]
    for f in sorted(glob.glob('geom/*')):
        g=lj(f); rid=os.path.basename(f)[:-5]
        if not g: continue
        c=decode(g['data'],g.get('precision',5))
        if len(c)<2: continue
        ls=LineString(c)
        if not ls.intersects(REGION): continue
        part=ls.intersection(REGION)
        parts=[part] if part.geom_type=='LineString' else [p for p in getattr(part,'geoms',[]) if p.geom_type=='LineString']
        parts=[p for p in parts if p.length>0.005]
        if not parts: continue
        km=sum(sum(hk(a,b) for a,b in zip(p.coords,p.coords[1:])) for p in parts)
        if km<1: continue
        meta=lj('roads/'+rid+'.json') or {}
        out.append(dict(id=rid,meta=meta,parts=parts,km=km,full=ls))
    return out
