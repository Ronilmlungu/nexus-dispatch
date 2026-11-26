# Nexus Dispatch (GESL) – Geospatial Emergency Service Locator

Flask + PostgreSQL/PostGIS + pgRouting + Leaflet.

```
frontend/   HTML, CSS, Leaflet (map.js calls the API)
backend/    Flask API (app.py) + OSM facility importer
database/   schema.sql, seed.sql, post_import.sql
```

## Setup
Requires PostgreSQL with PostGIS and pgRouting, Python 3.10+, and `osm2pgrouting`.

```bash
# 1. Database
createdb -U postgres gesl
psql -U postgres -d gesl -f database/schema.sql

# 2. Road network from OpenStreetMap (Zomba bbox) -> creates `ways` and `ways_vertices_pgr`
curl -G "https://overpass-api.de/api/interpreter" \
  --data-urlencode 'data=[out:xml][timeout:120];(way["highway"](-15.45,35.25,-15.32,35.42);>;);out;' -o zomba.osm
osm2pgrouting --f zomba.osm --conf mapconfig_for_cars.xml --dbname gesl --username postgres --clean
psql -U postgres -d gesl -f database/post_import.sql

# 3. Data: demo seed, or real OSM facilities
psql -U postgres -d gesl -f database/seed.sql
# python backend/import_facilities.py --replace

# 4. Run
cd backend && python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export DATABASE_URL=postgresql://postgres:YOURPASSWORD@localhost:5432/gesl   # Windows: set DATABASE_URL=...
python app.py        # open http://localhost:5000
```

## API
| Endpoint | Purpose |
|---|---|
| `GET /api/health` | DB + PostGIS + pgRouting versions |
| `GET /api/facilities?type=all\|hospital\|police\|fire` | GeoJSON facilities |
| `GET /api/hazards` | GeoJSON hazard polygons |
| `POST /api/hazards` | Report a hazard `{lat,lng,radius_m,hazard_type,severity}` |
| `DELETE /api/hazards/<id>` | Remove a hazard |
| `GET /api/route?lat=&lng=&type=` | KNN -> Dijkstra -> hazard check; returns facility, km, ETA, path, hazard flag |

## Spatial analysis (see `backend/app.py`)
1. **KNN** – `ORDER BY geom <-> point LIMIT 5` on a GiST index.
2. **Network analysis** – `pgr_dijkstra` one-to-many from the snapped click node; the fastest by road wins (may differ from the straight-line nearest).
3. **Hazard detection** – `ST_Intersects(route, hazard polygons)`; the route turns red in the UI.
