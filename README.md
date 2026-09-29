# Star Cement North East · Know Your Route

A route-planning and road-knowledge tool for the logistics team, covering the eight North-East states and the north Bengal gateway.

**Fully static.** Every map layer, route and number is computed in the browser from data files in this folder. There is no API, no key, no server, no database and no online map service. It can be hosted on GitHub Pages as-is, or opened offline by double-clicking `index.html`.

---

## What's inside

**Route sheet.** Pick any two places (towns, post offices, PIN codes, railway stations, airports) or click the map. You get a leg-by-leg sheet, laid out like a railway timetable. This is the plain-text copy the app produces:

```
KNOW YOUR ROUTE: Guwahati → Shillong
108 km · Truck ~4 h 21 m (no stops) · 1 toll plaza

0 km  Guwahati
   | Local roads 4.6 km (estimated)
4.6 km  Near Dispur
   | NH 27 · 17 km · 4-lane · 64% plains, 36% hilly or rolling · no toll
21 km  NH 27 / NH 6 junction
   | NH 6 · 85 km · 4-lane · Hilly / rolling · 1 toll plaza
   |   via Nongpoh
   |   toll: Pahammawlein
107 km  Leave the highway
   | Local roads 1.8 km (estimated)
108 km  Shillong
```

Each leg shows highway number, distance, time, lane type, terrain, toll plazas (names and position, no fees), maintaining agency, states and towns passed. **Copy route sheet** gives a plain-text version for WhatsApp or email. Below the sheet: terrain and lane split, districts crossed with mapped floods (2014–16), nearest station and airport at each end, and notices (Inner Line Permit, flood-prone districts, hill roads in monsoon, approximate endpoints).

**Reach maps.** From any place or map point: how far a car or truck gets in 2, 4, 6, 8 and 12 hours, and how many PIN codes fall in each band.

**Explore.** State profiles and a searchable list of highways, 136 districts, cities, towns, post offices and PIN codes, railway stations, rail goods sheds, airports and 24 NHAI toll plazas.

**Map layers.** National Highways drawn by lane count, state roads, railways, waterways and ferries, airports, district boundaries and flood-history shading.

**Learn.** Nine short notes: Siliguri corridor, Inner Line Permit, hill roads, monsoon, lane types, NH agencies, flood history, rail and waterways, reach maps.

---

## Files

```
ne-road-atlas/
├── index.html            the page
├── css/app.css           styling (light and dark)
├── js/app.js             map, panels, search, route sheet, reach maps
├── js/router.js          offline routing engine (Dijkstra on the road graph)
├── lib/                  MapLibre GL JS 5.24 (map renderer, BSD-3), bundled locally
├── data/
│   ├── network.js        road network: 4,788 sections, ~19,500 km, with lanes, agency, corridor, terrain, district and state for each part
│   ├── roads.js          highway catalogue (number, name, length, lanes, agency, states)
│   ├── localities.js     8,117 post offices / 1,062 PIN codes (796 routable)
│   ├── districts.js      136 current district boundaries with flood-event counts (2014–16)
│   ├── infra.js          rail lines, 360 stations, goods sheds, waterways, 263 ferry crossings, 18 airports
│   ├── tolls.js          NHAI toll plazas in the region: name, highway and location (no fees)
│   ├── geo.js            states, neighbouring countries, rivers
│   ├── atlas.js          reference text: states, cities, towns, notes (edit this)
│   └── glyphs.js         map label font (Noto Sans), so labels work offline
├── tools/                Python scripts that built the data files (for future refreshes)
└── README.md
```

---

## Open it or put it online

**Locally:** double-click `index.html`. If your browser blocks local files, run `python3 -m http.server 8000` inside the folder and open <http://localhost:8000>.

**GitHub Pages:**
1. Create a repository and upload the whole folder, keeping the structure, with `index.html` at the top.
2. Go to **Settings → Pages → Deploy from a branch → `main` / root → Save**.
3. The site goes live at `https://<username>.github.io/<repo>/`.

**Netlify:** drag the folder onto <https://app.netlify.com/drop>.

**Cloudflare Pages / Vercel:** upload or import the folder. There is no build command, and the output directory is the root.

The site is about 3.8 MB and loads in a couple of seconds on a normal connection.

---

## How the numbers are produced

| Output | Method |
|---|---|
| Road network | OpenStreetMap alignments of all National Highways in the region, plus Assam, West Bengal and Mizoram state and district roads, joined at junctions. Short gaps were bridged by hand and are drawn dashed. |
| Road type | Each road section is matched (within 600 m, same NH number preferred) to MoRTH's National Highway layer on PM GatiShakti, **dated 30 June 2022**. This gives lanes, agency, corridor type and Bharatmala status. About 88% of NH length matched. Some roads have been widened since 2022. |
| Distance | Measured along the network, with a small correction for winding hill roads (+1% plains, +5% rolling, +12% hills). |
| Terrain | How much the road bends per km: plains under 55°/km, rolling 55–120°/km, hills above 120°/km. |
| Time | Speed set by lanes and terrain. Car: about 62 km/h on 4-lane plains down to 22–34 km/h in hills. Truck: about 45 km/h down to 14–21 km/h. Single and intermediate lanes are slower. No traffic, stops or breaks are included. |
| Local roads | From a place off the network to the nearest highway: straight line × 1.3, at 30 km/h (car) or 20 km/h (truck). |
| Post offices | India Post directory, cleaned: swapped coordinates fixed, points outside their state or far from the rest of their PIN rejected, district-centroid points detected, and offices matched to checked towns. 4,145 sit at their own point, 1,979 at their PIN area's centre and 1,993 at their district centre. District-centre offices are searchable but not routable, so 796 of the 1,062 PIN codes can be routed to. |
| Flood history | Number of flood events in the India Flood Inventory v3 whose mapped extent covers the district. Only events from 2014–16 have mapped extents in this release, so this is a short-period district indicator, not a flood line on each road. |
| Rail & air access | Straight-line distance to the nearest railway station and airport. |
| Reach map | The same time model, run outward from the start point. Each routable PIN code is counted once, at its point on the nearest road. |

Sample outputs, city centre to city centre by car: Guwahati–Shillong 108 km, Siliguri–Gangtok 116 km, Silchar–Aizawl 182 km, Guwahati–Jorhat 309 km, Tezpur–Tawang 316 km, Guwahati–Dibrugarh 454 km.

### Known limitations
- The Jorhat–Sivasagar stretch of the old NH 37 (AT Road) is missing from the source, so routes there detour.
- The goods-shed list from PM GatiShakti is incomplete for parts of Assam.
- There is no landslide-location dataset. Hill risk is inferred from terrain.
- River ferries are shown on the map but not used in routing.
- Toll fees are deliberately left out because they change every year. Everything in the data is structural and changes slowly.

---

## Editing and refreshing

- **Text and places:** edit `data/atlas.js` and refresh the page.
- **Data refresh (optional, for developers):** the scripts in `tools/` rebuild the data files from the public sources below (Python 3 with `shapely`, `networkx`, `pyshp`, `pyarrow`). Run `build_network.py`, `build_pincodes.py` and `build_infra.py`. The top of each script lists the input files it expects.

---

## Sources & licences

| Data | Source | Licence |
|---|---|---|
| Road geometry | © OpenStreetMap contributors, via [RoadTracker India](https://github.com/ForPublicOrg/roadtrackerindia) | ODbL 1.0 |
| Highway lanes, agency, corridors | MoRTH National Highway layer on PM GatiShakti, via [india-geodata](https://github.com/yashveeeeeeer/india-geodata) | CC0 |
| District boundaries | Local Government Directory, via india-geodata | CC0 |
| Flood events | [India Flood Inventory v3](https://github.com/hydrosenselab/India-Flood-Inventory) | CC BY 4.0 |
| Rail lines & stations | Indian Railways GeoPortal, via india-geodata | CC0 |
| Rail goods sheds | PM GatiShakti, via india-geodata | CC0 |
| Waterways & terminals | India-WRIS, via india-geodata | CC0 |
| Ferry crossings | Survey of India, via india-geodata | CC0 |
| Post offices & PIN codes | Department of Posts, All India Pincode Directory (data.gov.in), via [pincodes-india](https://github.com/dropdevrahul/pincodes-india) | GODL-India |
| Toll plaza locations | NHAI Rajmargyatra, via [india-toll-plazas](https://github.com/ForceGT/india-toll-plazas) | Government open data |
| State boundaries | [DataMeet](https://github.com/datameet/maps) | CC BY 4.0 |
| Rivers, neighbouring countries | [Natural Earth](https://www.naturalearthdata.com) (India point of view) | Public domain |
| Map renderer | [MapLibre GL JS](https://maplibre.org) | BSD-3 |
| Label font | Noto Sans | SIL OFL |

The map credits OpenStreetMap contributors, as ODbL requires. Public information only: no company-internal or operational data. Boundaries are indicative and not an authoritative depiction.
