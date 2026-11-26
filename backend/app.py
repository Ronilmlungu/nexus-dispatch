"""GESL / Nexus Dispatch backend: Flask + PostGIS + pgRouting.

GET /api/route runs the three spatial analysis methods from the project description:
  1. KNN search       -> K nearest facilities by straight-line distance (<-> operator)
  2. Network analysis -> pgr_dijkstra from the click to every candidate, keep the fastest
  3. Hazard detection -> ST_Intersects(route line, hazard polygons)
"""
import json
import math
import os
from contextlib import contextmanager

from flask import Flask, jsonify, request
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/gesl")
FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
K_NEAREST = 5
FACILITY_TYPES = {"all", "hospital", "police", "fire"}
SEVERITIES = {"Low", "Medium", "High"}
CONNECTOR_SPEED_MS = 30 / 3.6  # click -> road and road -> facility, metres/second

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
pool = ThreadedConnectionPool(1, 10, DATABASE_URL)


@contextmanager
def db():
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


@app.after_request
def allow_cors(resp):  # lets the frontend run from Live Server (port 5500) too
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    return resp


# ---------- SQL ----------
# 1) KNN: index-assisted nearest facilities (<->), each snapped to its nearest road node
KNN_SQL = """
SELECT f.id, f.name, f.type, ST_Y(f.geom) AS lat, ST_X(f.geom) AS lng,
       ST_Distance(f.geom::geography, p.geom::geography) AS straight_m,
       (SELECT v.id FROM ways_vertices_pgr v ORDER BY v.geom <-> f.geom LIMIT 1) AS vertex_id
FROM facilities f,
     (SELECT ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326) AS geom) p
WHERE %(ftype)s = 'all' OR f.type = %(ftype)s
ORDER BY f.geom <-> p.geom
LIMIT %(k)s
"""

# 2) Network analysis: Dijkstra from the snapped click node to all candidates at once.
#    Edges are rebuilt in travel order (reversed when travelled against their digitised
#    direction) and merged into one LineString per candidate. Fastest candidate wins.
ROUTE_SQL = """
WITH start_v AS (
    SELECT id FROM ways_vertices_pgr
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326) LIMIT 1
),
paths AS (
    SELECT d.end_vid, d.path_seq, d.node, d.cost, w.source, ST_Length(w.geom::geography) AS length_m, w.geom
    FROM start_v,
         pgr_dijkstra(
           'SELECT id AS id, source, target, cost_s AS cost, reverse_cost_s AS reverse_cost FROM ways',
           start_v.id, %(ends)s::bigint[], true) d
    JOIN ways w ON w.id = d.edge
)
SELECT end_vid, SUM(cost) AS time_s, SUM(length_m) AS length_m,
       ST_AsGeoJSON(ST_MakeLine(
           CASE WHEN node = source THEN geom ELSE ST_Reverse(geom) END
           ORDER BY path_seq)) AS geojson
FROM paths
GROUP BY end_vid
ORDER BY time_s
LIMIT 1
"""

# 3) Hazard detection: overlay of the route LineString with hazard Polygons
HAZARD_SQL = """
SELECT id, hazard_type, severity, description
FROM hazards
WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromGeoJSON(%(line)s), 4326))
"""


# ---------- helpers ----------
def haversine_m(lat1, lng1, lat2, lng2):
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(a))


def feature_collection(rows, prop_keys):
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": r["geometry"],
         "properties": {k: r[k] for k in prop_keys}} for r in rows]}


def error(msg, code):
    return jsonify(error=msg), code


# ---------- routes ----------
@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/health")
def health():
    with db() as cur:
        cur.execute("SELECT postgis_version() AS postgis, pgr_version() AS pgrouting")
        return jsonify(status="ok", **cur.fetchone())


@app.get("/api/facilities")
def facilities():
    ftype = request.args.get("type", "all").lower()
    if ftype not in FACILITY_TYPES:
        return error("type must be one of: all, hospital, police, fire", 400)
    with db() as cur:
        cur.execute("""SELECT id, name, type, ST_AsGeoJSON(geom)::json AS geometry
                       FROM facilities WHERE %(t)s = 'all' OR type = %(t)s ORDER BY id""", {"t": ftype})
        return jsonify(feature_collection(cur.fetchall(), ["id", "name", "type"]))


@app.get("/api/hazards")
def hazards():
    with db() as cur:
        cur.execute("""SELECT id, hazard_type, severity, description,
                              ST_AsGeoJSON(geom)::json AS geometry FROM hazards ORDER BY id""")
        return jsonify(feature_collection(cur.fetchall(), ["id", "hazard_type", "severity", "description"]))


@app.post("/api/hazards")
def add_hazard():
    """Report a hazard as a circle: {lat, lng, radius_m, hazard_type, severity, description}"""
    b = request.get_json(silent=True) or {}
    try:
        lat, lng = float(b["lat"]), float(b["lng"])
        radius = float(b.get("radius_m", 200))
    except (KeyError, TypeError, ValueError):
        return error("lat, lng (and optional radius_m) must be numbers", 400)
    severity = b.get("severity", "Medium")
    if severity not in SEVERITIES or not 10 <= radius <= 5000:
        return error("severity must be Low/Medium/High and radius_m between 10 and 5000", 400)
    with db() as cur:
        cur.execute("""INSERT INTO hazards (hazard_type, severity, description, geom)
                       VALUES (%(t)s, %(s)s, %(d)s,
                         ST_Buffer(ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography, %(r)s)::geometry)
                       RETURNING id""",
                    {"t": b.get("hazard_type", "Flood"), "s": severity,
                     "d": b.get("description"), "lng": lng, "lat": lat, "r": radius})
        return jsonify(id=cur.fetchone()["id"]), 201


@app.delete("/api/hazards/<int:hazard_id>")
def delete_hazard(hazard_id):
    with db() as cur:
        cur.execute("DELETE FROM hazards WHERE id = %s", (hazard_id,))
        return ("", 204) if cur.rowcount else error("hazard not found", 404)


@app.get("/api/route")
def route():
    try:
        lat, lng = float(request.args["lat"]), float(request.args["lng"])
    except (KeyError, ValueError):
        return error("lat and lng query parameters are required numbers", 400)
    ftype = request.args.get("type", "all").lower()
    if ftype not in FACILITY_TYPES or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return error("invalid type or coordinates", 400)

    with db() as cur:
        cur.execute(KNN_SQL, {"lat": lat, "lng": lng, "ftype": ftype, "k": K_NEAREST})
        candidates = cur.fetchall()
        if not candidates:
            return error(f"No '{ftype}' facilities in the database", 404)

        cur.execute(ROUTE_SQL, {"lat": lat, "lng": lng, "ends": [c["vertex_id"] for c in candidates]})
        best = cur.fetchone()
        if not best:
            return error("No road route found. Is the road network imported and connected?", 404)

        fac = next(c for c in candidates if c["vertex_id"] == best["end_vid"])
        road = json.loads(best["geojson"])["coordinates"]  # [[lng, lat], ...]
        full = [[lng, lat]] + road + [[fac["lng"], fac["lat"]]]  # join click + facility to the road line

        cur.execute(HAZARD_SQL, {"line": json.dumps({"type": "LineString", "coordinates": full})})
        zones = cur.fetchall()

    connectors_m = (haversine_m(lat, lng, road[0][1], road[0][0])
                    + haversine_m(road[-1][1], road[-1][0], fac["lat"], fac["lng"]))
    return jsonify(
        facility={k: fac[k] for k in ("id", "name", "type", "lat", "lng")},
        distance_km=round((best["length_m"] + connectors_m) / 1000, 2),
        eta_min=max(1, round((best["time_s"] + connectors_m / CONNECTOR_SPEED_MS) / 60)),
        straight_line_km=round(fac["straight_m"] / 1000, 2),
        knn_nearest=candidates[0]["name"],  # nearest "as the crow flies" (may differ from the road winner)
        path=[[y, x] for x, y in full],     # Leaflet wants [lat, lng]
        hazard={"intersects": bool(zones), "zones": zones},
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

