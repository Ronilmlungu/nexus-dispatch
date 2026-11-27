import os
import sys

import psycopg2
import requests

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/gesl")
BBOX = "-15.45,35.25,-15.32,35.42"  # south,west,north,east (Zomba area)
TYPE_MAP = {"hospital": "hospital", "clinic": "hospital", "police": "police", "fire_station": "fire"}
HEADERS = {"User-Agent": "gesl-student-project/1.0", "Accept": "*/*"}
MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

query = f"""[out:json][timeout:90];
(nwr["amenity"~"^(hospital|clinic|police|fire_station)$"]({BBOX}););
out center;"""

elements = None
for url in MIRRORS:
    try:
        r = requests.post(url, data={"data": query}, headers=HEADERS, timeout=120)
        r.raise_for_status()
        elements = r.json()["elements"]
        break
    except Exception as e:
        print(f"{url} failed: {e}")
if elements is None:
    sys.exit("All Overpass servers failed. Wait a minute and run again.")

rows = []
for e in elements:
    ftype = TYPE_MAP.get(e.get("tags", {}).get("amenity"))
    lat = e.get("lat") or e.get("center", {}).get("lat")
    lng = e.get("lon") or e.get("center", {}).get("lon")
    if ftype and lat is not None:
        rows.append((e["tags"].get("name") or f"Unnamed {ftype}", ftype, lng, lat))

with psycopg2.connect(DATABASE_URL) as conn, conn.cursor() as cur:
    if "--replace" in sys.argv:
        cur.execute("TRUNCATE facilities RESTART IDENTITY")
    cur.executemany("INSERT INTO facilities (name, type, geom) VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))", rows)
print(f"Inserted {len(rows)} facilities")
