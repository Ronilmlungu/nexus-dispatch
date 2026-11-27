DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'ways_vertices_pgr' AND column_name = 'the_geom') THEN
    ALTER TABLE ways_vertices_pgr RENAME COLUMN the_geom TO geom;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ways_vertices_geom_idx ON ways_vertices_pgr USING GIST (geom);
ANALYZE;
