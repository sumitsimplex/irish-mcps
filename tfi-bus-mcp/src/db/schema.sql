-- TFI Bus MCP Supabase schema
-- Run once in the Supabase SQL editor.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS gtfs_metadata (
  id              SERIAL PRIMARY KEY,
  zip_hash        TEXT NOT NULL,
  loaded_at       TIMESTAMPTZ DEFAULT now(),
  row_counts      JSONB
);

CREATE TABLE IF NOT EXISTS agencies (
  agency_id       TEXT PRIMARY KEY,
  agency_name     TEXT NOT NULL,
  agency_url      TEXT,
  agency_timezone TEXT
);

CREATE TABLE IF NOT EXISTS routes (
  route_id         TEXT PRIMARY KEY,
  agency_id        TEXT REFERENCES agencies(agency_id),
  route_short_name TEXT,
  route_long_name  TEXT,
  route_type       INTEGER
);

CREATE TABLE IF NOT EXISTS stops (
  stop_id          TEXT PRIMARY KEY,
  stop_name        TEXT NOT NULL,
  stop_lat         DOUBLE PRECISION NOT NULL,
  stop_lon         DOUBLE PRECISION NOT NULL,
  geom             GEOGRAPHY(Point, 4326)
);

CREATE TABLE IF NOT EXISTS trips (
  trip_id          TEXT PRIMARY KEY,
  route_id         TEXT REFERENCES routes(route_id),
  service_id       TEXT NOT NULL,
  trip_headsign    TEXT,
  direction_id     INTEGER,
  shape_id         TEXT
);

CREATE TABLE IF NOT EXISTS stop_times (
  trip_id          TEXT REFERENCES trips(trip_id),
  stop_sequence    INTEGER NOT NULL,
  stop_id          TEXT REFERENCES stops(stop_id),
  arrival_time     TEXT,
  departure_time   TEXT,
  PRIMARY KEY (trip_id, stop_sequence)
);

CREATE TABLE IF NOT EXISTS calendar (
  service_id       TEXT PRIMARY KEY,
  monday           BOOLEAN,
  tuesday          BOOLEAN,
  wednesday        BOOLEAN,
  thursday         BOOLEAN,
  friday           BOOLEAN,
  saturday         BOOLEAN,
  sunday           BOOLEAN,
  start_date       DATE,
  end_date         DATE
);

CREATE TABLE IF NOT EXISTS calendar_dates (
  service_id       TEXT,
  date             DATE,
  exception_type   INTEGER,
  PRIMARY KEY (service_id, date)
);

CREATE TABLE IF NOT EXISTS shapes (
  shape_id          TEXT,
  shape_pt_sequence INTEGER,
  shape_pt_lat      DOUBLE PRECISION,
  shape_pt_lon      DOUBLE PRECISION,
  PRIMARY KEY (shape_id, shape_pt_sequence)
);

CREATE INDEX IF NOT EXISTS idx_stop_times_stop     ON stop_times(stop_id);
CREATE INDEX IF NOT EXISTS idx_stop_times_trip     ON stop_times(trip_id);
CREATE INDEX IF NOT EXISTS idx_trips_route         ON trips(route_id);
CREATE INDEX IF NOT EXISTS idx_trips_service       ON trips(service_id);
CREATE INDEX IF NOT EXISTS idx_stops_name_trgm     ON stops USING gin(stop_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_stops_geom          ON stops USING gist(geom);
CREATE INDEX IF NOT EXISTS idx_calendar_service    ON calendar(service_id);
CREATE INDEX IF NOT EXISTS idx_cal_dates_service   ON calendar_dates(service_id);
CREATE INDEX IF NOT EXISTS idx_shapes_id           ON shapes(shape_id);

CREATE OR REPLACE FUNCTION set_stop_geom()
RETURNS TRIGGER AS $$
BEGIN
  NEW.geom = ST_SetSRID(ST_MakePoint(NEW.stop_lon, NEW.stop_lat), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stop_geom ON stops;
CREATE TRIGGER trg_stop_geom
BEFORE INSERT OR UPDATE ON stops
FOR EACH ROW EXECUTE FUNCTION set_stop_geom();

CREATE OR REPLACE FUNCTION search_stops_rpc(
  p_query TEXT DEFAULT NULL,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lon DOUBLE PRECISION DEFAULT NULL,
  p_radius_m DOUBLE PRECISION DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  stop_id TEXT,
  stop_name TEXT,
  stop_lat DOUBLE PRECISION,
  stop_lon DOUBLE PRECISION,
  distance_m DOUBLE PRECISION
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    s.stop_id,
    s.stop_name,
    s.stop_lat,
    s.stop_lon,
    CASE
      WHEN p_lat IS NOT NULL AND p_lon IS NOT NULL
      THEN ST_Distance(s.geom, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography)
      ELSE NULL
    END AS distance_m
  FROM stops s
  WHERE
    (p_query IS NULL OR s.stop_name ILIKE ('%' || p_query || '%'))
    AND (
      p_lat IS NULL OR p_lon IS NULL OR p_radius_m IS NULL
      OR ST_DWithin(s.geom, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography, p_radius_m)
    )
  ORDER BY
    CASE WHEN p_query IS NOT NULL THEN similarity(s.stop_name, p_query) ELSE 0 END DESC,
    distance_m ASC NULLS LAST,
    s.stop_name ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
$$;

CREATE OR REPLACE FUNCTION get_routes_at_stop_rpc(p_stop_id TEXT)
RETURNS TABLE (
  route_id TEXT,
  route_short_name TEXT,
  route_long_name TEXT,
  agency_name TEXT,
  headsigns TEXT[]
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    r.route_id,
    r.route_short_name,
    r.route_long_name,
    a.agency_name,
    array_remove(array_agg(DISTINCT t.trip_headsign ORDER BY t.trip_headsign), NULL) AS headsigns
  FROM stop_times st
  JOIN trips t ON t.trip_id = st.trip_id
  JOIN routes r ON r.route_id = t.route_id
  LEFT JOIN agencies a ON a.agency_id = r.agency_id
  WHERE st.stop_id = p_stop_id
  GROUP BY r.route_id, r.route_short_name, r.route_long_name, a.agency_name
  ORDER BY r.route_short_name NULLS LAST, r.route_long_name NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION active_service_ids_rpc(p_date DATE)
RETURNS TABLE (service_id TEXT)
LANGUAGE SQL
STABLE
AS $$
  WITH weekday_services AS (
    SELECT c.service_id
    FROM calendar c
    WHERE c.start_date <= p_date
      AND c.end_date >= p_date
      AND CASE EXTRACT(DOW FROM p_date)::INTEGER
        WHEN 0 THEN c.sunday
        WHEN 1 THEN c.monday
        WHEN 2 THEN c.tuesday
        WHEN 3 THEN c.wednesday
        WHEN 4 THEN c.thursday
        WHEN 5 THEN c.friday
        WHEN 6 THEN c.saturday
      END
  ),
  removed AS (
    SELECT cd.service_id
    FROM calendar_dates cd
    WHERE cd.date = p_date AND cd.exception_type = 2
  ),
  added AS (
    SELECT cd.service_id
    FROM calendar_dates cd
    WHERE cd.date = p_date AND cd.exception_type = 1
  )
  SELECT service_id FROM weekday_services
  EXCEPT
  SELECT service_id FROM removed
  UNION
  SELECT service_id FROM added;
$$;

CREATE OR REPLACE FUNCTION list_operators_rpc()
RETURNS TABLE (
  agency_id TEXT,
  agency_name TEXT,
  agency_url TEXT,
  route_count BIGINT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    a.agency_id,
    a.agency_name,
    a.agency_url,
    COUNT(r.route_id) AS route_count
  FROM agencies a
  LEFT JOIN routes r ON r.agency_id = a.agency_id
  GROUP BY a.agency_id, a.agency_name, a.agency_url
  ORDER BY a.agency_name;
$$;
