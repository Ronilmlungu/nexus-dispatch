-- Run first:  psql -U postgres -d gesl -f database/schema.sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;

-- 5.1 facilities
CREATE TABLE IF NOT EXISTS facilities (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('hospital', 'police', 'fire')),
    geom geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS facilities_geom_idx ON facilities USING GIST (geom);

-- 5.2 hazards
CREATE TABLE IF NOT EXISTS hazards (
    id          SERIAL PRIMARY KEY,
    hazard_type TEXT NOT NULL,
    severity    TEXT NOT NULL CHECK (severity IN ('Low', 'Medium', 'High')),
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    geom        geometry(Polygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS hazards_geom_idx ON hazards USING GIST (geom);

-- 5.3 ways and 5.4 ways_vertices_pgr are created by osm2pgrouting (see README).
