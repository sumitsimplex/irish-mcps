# TFI Bus MCP

Cloudflare Worker MCP server for the nationwide Transport for Ireland bus network. It combines static GTFS data stored in Supabase with live GTFS-Realtime TripUpdates from the National Transport Authority.

MCP endpoint: `https://tfi-bus.irishmcp.ie/mcp`

## What This MCP Does

This server exposes seven tools:

- `search_stops` — find bus stops by name, by nearby coordinates, or by both.
- `get_routes_at_stop` — list routes and operators serving a stop.
- `get_timetable` — return scheduled trips and stop times for a route on a date.
- `plan_journey` — find direct scheduled journeys between two stops.
- `get_realtime_departures` — return live expected departures for a stop from GTFS-Realtime.
- `get_route_shape` — return a representative route shape as GeoJSON LineString.
- `list_operators` — list operators in the loaded GTFS feed with route counts.

## Prerequisites

- Supabase project with PostGIS and pg_trgm enabled.
- NTA developer API key from <https://developer.nationaltransport.ie/>.
- Cloudflare account with Workers and DNS access for `irishmcp.ie`.
- Node.js 20+.
- Wrangler v3 or newer.

## First-Time Setup

1. Create a Supabase project.
2. Run `src/db/schema.sql` in the Supabase SQL editor.
3. Add GitHub repository secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Set Wrangler secrets:

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put NTA_API_KEY
```

5. Install dependencies and load GTFS once:

```bash
npm ci
npm run loader
```

6. Deploy the Worker:

```bash
wrangler deploy
```

The Worker uses the Supabase anon key for read-only queries. The loader is the only component that uses the service role key.

## Keeping GTFS Fresh

TFI publishes the combined nationwide static feed at:

```text
https://www.transportforireland.ie/transitData/Data/GTFS_All.zip
```

The loader downloads the zip as a stream, computes a SHA-256 hash of the raw bytes, checks the latest hash in `gtfs_metadata`, and exits early when the feed is unchanged. If the hash differs, it parses the GTFS text files and upserts rows into Supabase in this order:

```text
agencies -> routes -> stops -> trips -> calendar -> calendar_dates -> stop_times -> shapes
```

`../.github/workflows/tfi-bus-gtfs-refresh.yml` runs the loader every Sunday at 03:00 UTC from the irish-mcps repository root and can also be triggered manually from GitHub Actions.

## Tool Reference

### search_stops

Input:

```json
{ "query": "Heuston" }
```

Output:

```json
[
  { "stop_id": "822GA00357", "stop_name": "Heuston Station", "stop_lat": 53.346, "stop_lon": -6.292, "distance_m": null }
]
```

Nearby search:

```json
{ "lat": 53.3498, "lon": -6.2603, "radius_km": 1 }
```

### get_routes_at_stop

Input:

```json
{ "stop_id": "822GA00357" }
```

Output:

```json
[
  {
    "route_id": "60-145-b12-1",
    "route_short_name": "145",
    "route_long_name": "Heuston Station - Ballywaltrim",
    "agency_name": "Dublin Bus",
    "headsigns": ["Ballywaltrim", "Heuston Station"]
  }
]
```

### get_timetable

Input:

```json
{ "route_id": "60-145-b12-1", "date": "2026-05-28", "direction_id": 0 }
```

Output:

```json
{
  "route_short_name": "145",
  "route_long_name": "Heuston Station - Ballywaltrim",
  "date": "2026-05-28",
  "direction_id": 0,
  "trips": [
    {
      "trip_id": "trip-1",
      "headsign": "Ballywaltrim",
      "stops": [
        { "stop_id": "822GA00357", "stop_name": "Heuston Station", "departure_time": "08:00:00" }
      ]
    }
  ]
}
```

### plan_journey

Input:

```json
{
  "origin_stop_id": "822GA00357",
  "destination_stop_id": "822GA00416",
  "date": "2026-05-28",
  "depart_after": "08:00"
}
```

Output:

```json
{
  "journeys": [
    {
      "trip_id": "trip-1",
      "route_short_name": "145",
      "route_long_name": "Heuston Station - Ballywaltrim",
      "agency_name": "Dublin Bus",
      "headsign": "Ballywaltrim",
      "departs_at": "08:05:00",
      "arrives_at": "08:42:00",
      "duration_minutes": 37,
      "intermediate_stops": [
        { "stop_id": "822GA00357", "stop_name": "Heuston Station", "departure_time": "08:05:00" }
      ]
    }
  ]
}
```

### get_realtime_departures

Input:

```json
{ "stop_id": "822GA00357", "limit": 10 }
```

Output:

```json
[
  {
    "route_short_name": "145",
    "headsign": "Ballywaltrim",
    "scheduled_departure": "2026-05-28T08:05:00.000Z",
    "expected_departure": "2026-05-28T08:07:00.000Z",
    "delay_seconds": 120,
    "vehicle_id": "10001"
  }
]
```

If the NTA API key is missing:

```json
{ "error": "NTA_API_KEY not configured", "docs": "https://developer.nationaltransport.ie" }
```

### get_route_shape

Input:

```json
{ "route_id": "60-145-b12-1", "direction_id": 0 }
```

Output:

```json
{ "type": "LineString", "coordinates": [[-6.292, 53.346], [-6.28, 53.344]] }
```

### list_operators

Input:

```json
{}
```

Output:

```json
[
  { "agency_id": "978", "agency_name": "Dublin Bus", "agency_url": "https://www.dublinbus.ie", "route_count": 120 }
]
```

## Registering On irishmcp.ie

After deployment, add the MCP to the IrishMCP directory database with:

- Name: `TFI Bus MCP`
- Slug: `tfi-bus`
- Endpoint: `https://tfi-bus.irishmcp.ie/mcp`
- Category: transport
- Status: live when the Worker and GTFS loader have both been verified

Follow the existing `*-mcp-live.sql` pattern in the main `irishmcp.ie` repository to add the directory row and changelog entry.
