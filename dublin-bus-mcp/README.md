# Dublin Bus & Bus Éireann Realtime MCP

Model Context Protocol server for Dublin Bus and Bus Éireann realtime data, powered by the National Transport Authority's GTFS-Realtime feed.

Hosted at: `https://dublin-bus.irishmcp.ie/mcp`

## Tools

- `query(query)` — natural-language query (e.g. "where is the 46A?", "Dublin Bus 16 delays")
- `get_vehicle_positions({ route_number?, operator?, limit? })` — live GPS positions and status
- `get_trip_updates({ route_number?, operator?, limit? })` — delays, on-time status, next stops
- `get_alerts({ route_number?, operator? })` — active service alerts and disruptions

`operator` accepts `dublin_bus`, `bus_eireann`, `go_ahead`, or `all` (default).

## Data

National Transport Authority GTFS-R v2 API:
- `Vehicles` — live positions
- `TripUpdates` — delays per stop
- `Alerts` — disruptions

The realtime feed only carries opaque internal `route_id`s (e.g. `5576_119660`). Friendly route numbers (e.g. `120`) and the operating agency are resolved through the static GTFS schedule, baked in as `src/routes.generated.json`.

Refresh that lookup whenever the schedule changes (NTA updates it weekly):

```bash
npm run update-routes   # downloads NTA static GTFS, regenerates the JSON
```

## Deploy

```bash
cd irish-mcps/dublin-bus-mcp
npm install
npm run update-routes                 # required before first deploy
npx wrangler secret put NTA_API_KEY   # paste key from developer.nationaltransport.ie
npx wrangler deploy
```

## Auth

Requires a free NTA API key from <https://developer.nationaltransport.ie>. Stored as the `NTA_API_KEY` Cloudflare Worker secret.
