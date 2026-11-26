-- Demo data taken from the frontend mock (placeholder coordinates). Replace facilities with
-- real OSM data via backend/import_facilities.py --replace
TRUNCATE facilities, hazards RESTART IDENTITY;

INSERT INTO facilities (name, type, geom) VALUES
 ('Zomba Central Hospital',  'hospital', ST_SetSRID(ST_MakePoint(35.3200, -15.3850), 4326)),
 ('Matawale Private Clinic', 'hospital', ST_SetSRID(ST_MakePoint(35.3300, -15.3750), 4326)),
 ('Zomba Police Station',    'police',   ST_SetSRID(ST_MakePoint(35.3180, -15.3880), 4326)),
 ('Zomba City Police',       'police',   ST_SetSRID(ST_MakePoint(35.3400, -15.3700), 4326));

INSERT INTO hazards (hazard_type, severity, description, geom) VALUES
 ('Flood', 'High', 'Reported flood zone',
  ST_GeomFromText('POLYGON((35.3170 -15.3810, 35.3230 -15.3810, 35.3230 -15.3870, 35.3170 -15.3870, 35.3170 -15.3810))', 4326));
