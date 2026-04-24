# ☘️ Irish MCP Servers

Open-source [Model Context Protocol](https://modelcontextprotocol.io) servers for Ireland's public APIs and open data sources. These servers power [irishmcp.ie](https://irishmcp.ie) — Ireland's hosted MCP platform.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Built for Ireland](https://img.shields.io/badge/Built%20for-Ireland-009A49)](https://irishmcp.ie)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020)](https://workers.cloudflare.com)

---

## Available MCP Servers

| MCP | Description | Data Source |
|-----|-------------|-------------|
| [`irish-rail-mcp`](./irish-rail-mcp/) | Live train times, station info, and movements for Irish Rail | [Irish Rail Realtime API](http://api.irishrail.ie/realtime/) |
| [`luas-mcp`](./luas-mcp/) | Real-time Luas tram forecasts and stop information | [Luas Forecasts API](https://luasforecasts.rpa.ie) |
| [`met-eireann-mcp`](./met-eireann-mcp/) | Current weather, forecasts, and warnings from Met Éireann | [Met Éireann Open Data](https://data.gov.ie/dataset/met-eireann-weather-forecast-api) |
| [`eirgrid-mcp`](./eirgrid-mcp/) | Live electricity grid stats, renewable generation, and demand | [EirGrid SmartGrid Dashboard](https://www.smartgriddashboard.com) |
| [`dublin-bikes-mcp`](./dublin-bikes-mcp/) | Real-time Dublin Bikes station availability | [JCDecaux API](https://developer.jcdecaux.com) |
| [`cso-mcp`](./cso-mcp/) | Statistics from Ireland's Central Statistics Office | [CSO Open Data API](https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset) |
| [`oireachtas-mcp`](./oireachtas-mcp/) | Bills, debates, members, and votes from the Irish Parliament | [Oireachtas Open Data API](https://api.oireachtas.ie) |
| [`property-price-mcp`](./property-price-mcp/) | Residential property sale prices across Ireland | [Property Price Register](https://www.propertypriceregister.ie) |
| [`hse-service-finder-mcp`](./hse-service-finder-mcp/) | HSE hospitals, emergency departments, injury units, maternity and paediatric facilities | [HSE Service List](https://www.hse.ie/eng/services/list/) |

---

## Architecture

Every MCP server in this repository is a [Cloudflare Worker](https://workers.cloudflare.com) implementing the [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) for MCP.

```
mcps/
├── irish-rail-mcp/      # Irish Rail Realtime API
├── luas-mcp/            # Luas Forecasts
├── met-eireann-mcp/     # Met Éireann Weather
├── eirgrid-mcp/         # EirGrid Smart Grid
├── dublin-bikes-mcp/    # Dublin Bikes
├── cso-mcp/             # Central Statistics Office
├── oireachtas-mcp/          # Houses of the Oireachtas
├── property-price-mcp/      # Property Price Register
└── hse-service-finder-mcp/  # HSE hospitals & services
```

Each server follows the same pattern:

- `src/index.ts` — Worker entry point and MCP tool definitions
- `wrangler.toml` — Cloudflare Workers configuration
- `package.json` — Dependencies and scripts

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)

### Run locally

```bash
cd mcps/irish-rail-mcp   # or any other MCP
npm install
npm run dev              # starts at http://localhost:8787/mcp
```

### Deploy to Cloudflare Workers

```bash
cd mcps/irish-rail-mcp
npm install
npx wrangler login       # authenticate with Cloudflare
npm run deploy           # deploys to <name>.<account>.workers.dev
```

Your MCP is live at:
```
https://irish-rail-mcp.<your-account>.workers.dev/mcp
```

### Test your deployment

```bash
# Health check
curl https://irish-rail-mcp.<your-account>.workers.dev/health

# List available tools
curl -X POST https://irish-rail-mcp.<your-account>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Using with an AI Assistant

### Claude Desktop

Add any MCP to Claude Desktop by editing your config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "irish-rail": {
      "type": "streamableHttp",
      "url": "https://irishrail-realtime.irishmcp.ie/mcp"
    },
    "met-eireann": {
      "type": "streamableHttp",
      "url": "https://met-eireann-weather.irishmcp.ie/mcp"
    }
  }
}
```

> **Tip**: Use the hosted endpoints at [irishmcp.ie](https://irishmcp.ie) so you don't need to deploy your own instance.

---

## Technical deep-dive: under the hood

Every MCP in this repo shares the same skeleton:

- **Runtime**: Cloudflare Workers (V8 isolates, free tier, no Durable Objects).
- **Transport**: MCP Streamable HTTP — plain JSON-RPC 2.0 over POST to `/mcp`. Fully stateless, no SSE, no WebSockets.
- **Handler surface**: `initialize`, `notifications/initialized` (204), `ping`, `tools/list`, `tools/call`. Unknown methods return JSON-RPC `-32601`.
- **CORS**: `Access-Control-Allow-Origin: *` so the in-browser playground at irishmcp.ie can call workers directly.
- **Entrypoint**: single `src/index.ts` with routes `/`, `/health`, `/mcp`. The MCP plumbing is ~80 lines of JSON-RPC switch; the rest is domain logic.
- **NL `query` tool**: every server exposes a `query` tool alongside its typed tools. It pattern-matches intent from free-form text and delegates — cuts down on tool-picking mistakes by LLMs.

Below, one section per MCP — what it talks to, how it parses the data, and the implementation choices worth knowing about.

---

### `irish-rail-mcp` — live upstream XML

**Upstream**: `http://api.irishrail.ie/realtime/realtime.asmx` — legacy ASP.NET SOAP-ish endpoint returning **XML** (no JSON, no auth, no rate-limit docs). Endpoints used: `getAllStationsXML`, `getStationDataByCodeXML`, `getCurrentTrainsXML`, `getTrainMovementsXML`.

**Parsing**: hand-rolled regex XML parser (`parseObjects(xml, tag, fields)`) — Cloudflare Workers ship no `DOMParser`, and a full XML lib is overkill for this shape. Loops `<tag>...</tag>` blocks and extracts named children into `Record<string,string>`.

**Tools**: `query`, `get_all_stations`, `get_station_trains` (caps `mins_ahead` at 90), `get_current_trains` (A/M/D/S filter), `get_train_movements`.

**Worth stealing**:
- **Two-tier station resolution** — `findStationCode()` first hits a hardcoded dictionary of ~60 common station names → 5-letter codes (fast, no network). Miss falls back to `lookupStationCode()` which fetches `getAllStationsXML` and matches with `(?<![a-z])phrase(?![a-z])` (plain `\b` breaks around apostrophes/spaces in station names).
- **No caching** — train positions change every few seconds. If upstream throttled, `caches.default` with a 10–30s TTL is the drop-in fix.
- **Thin error surface** — `railGet` throws on non-2xx; top-level catches and returns JSON-RPC `-32000`. No retries — LLMs retry naturally.

**Gotchas**: Irish Rail occasionally returns HTML error pages instead of XML (regex parser returns `[]`). `getTrainMovementsXML` date format is unforgiving: `"8 Mar 2026"` fails, `"08 Mar 2026"` works.

---

### `luas-mcp` — XML with attributes + elements

**Upstream**: `https://luasforecasts.rpa.ie/xml/get.ashx` — Luas Forecasts API. Two actions: `stops` (full system list) and `forecast` (per-stop tram ETAs).

**Parsing**: regex XML parser that handles **both attributes and child elements**, plus a separate `parseSelfClosing` for `<stop abv="..." .../>` tags. `<direction>` → `<tram dueMins="..." destination="...">` blocks are parsed with nested regex.

**Tools**: `query`, `get_stop_forecast` (takes 3-letter stop code e.g. `STS`, `HEU`, `DUN`), `get_all_stops` (Red + Green line split).

**Worth stealing**:
- **Hardcoded stop dictionary** — ~70 entries mapping friendly names (including aliases like `"stephens green"` / `"st stephen's green"` / `"gpo"`) to official 3-letter codes. `findStopCode()` also detects raw codes via `\b[A-Z]{2,4}\b`.
- **`"DUE"` string passthrough** — Luas API returns literal `"DUE"` when a tram is at the stop; the formatter treats that as a special case rather than parsing to a number.
- **No auth, no key** — `encrypt=false` avoids the obfuscation option.

---

### `dublin-bus-mcp` — NTA GTFS-Realtime v2 (JSON-encoded)

**Upstream**: `https://api.nationaltransport.ie/gtfsr/v2` — requires `NTA_API_KEY` secret (set via `wrangler secret put`). Three feeds: `Vehicles`, `TripUpdates`, `Alerts`.

**Filtering**: NTA `route_id` is `"<op>-<route>-<variant>-<dir>"` (e.g. `60-46A-d12-1`). Operator prefix: `60-` = Dublin Bus, `64-` = Bus Éireann, `65-` = Go-Ahead (excluded). Route extraction is the middle segment.

**Tools**: `query`, `get_vehicle_positions` (GPS + status), `get_trip_updates` (delays — max delay across all stops is surfaced), `get_alerts` (filtered to currently-active `active_period` windows).

**Worth stealing**:
- **Server-side filter-by-prefix** — cheaper than asking NTA for per-route feeds; one feed pull serves many tool calls.
- **Delay formatting** — `formatDelaySecs` collapses per-stop delays to "N min late/early" at minute resolution.
- **Multi-language alert handling** — `getTranslation()` picks the `en` translation, falling back to the first available.
- **`current_status` humanisation** — `INCOMING_AT` → "Approaching", `STOPPED_AT` → "Stopped", etc.

---

### `dublin-bikes-mcp` — GBFS merge + Haversine

**Upstream**: `https://api.cyclocity.fr/contracts/dublin/gbfs/` — GBFS standard. Two endpoints fetched in parallel: `station_information.json` (static: name, address, GPS, capacity) and `station_status.json` (dynamic: bikes available, docks, mechanical vs electrical split).

**Merge**: `station_id` join → `MergedStation` with bikes broken into `mechanical_bikes` / `electric_bikes` from `vehicle_types_available`.

**Tools**: `query`, `get_all_stations`, `get_station` (substring match on name **or** address; falls back to per-word match), `find_nearest` (lat/lon → Haversine-sorted top-N, clamped 1–20).

**Worth stealing**:
- **Haversine inline** — no geo lib. `R=6371` km, standard formula.
- **Known-location shortcut** — `KNOWN_LOCATIONS` dict (Trinity, Grafton, Heuston, etc.) lets `"bikes near Trinity"` short-circuit to coordinates without a geocoding call.
- **Parallel fetch** — `Promise.all([INFO_URL, STATUS_URL])` cuts latency roughly in half vs sequential.

---

### `met-eireann-mcp` — dual upstream with fallback

**Upstream 1 (current)**: `https://prodapi.metweb.ie/observations/{county}/today` — Met Éireann's official observations feed. County-indexed, hourly readings, returns station name + temperature + weather description + wind + humidity + rainfall + pressure.

**Upstream 2 (forecast + fallback)**: `https://api.open-meteo.com/v1/forecast` — free, no key, same underlying ECMWF model. Used for multi-day forecasts and as the `get_current_conditions` fallback when Met Éireann is down.

**Tools**: `query`, `get_current_conditions`, `get_forecast` (1–7 days), `get_today_hourly`.

**Worth stealing**:
- **WMO code → description table** — `wmoDescription(code)` maps numeric weather codes from Open-Meteo to human strings. Ranged lookups (`code <= 48 → "Foggy"`) keep it compact.
- **County-indexed location dict** — ~35 entries mapping towns (`"tralee"`, `"athlone"`) to both their county (for Met Éireann) and GPS (for Open-Meteo). Same dict powers both APIs.
- **Graceful degradation** — try/catch around the Met Éireann call silently falls through to Open-Meteo so the tool keeps working.

---

### `eirgrid-mcp` — dashboard JSON probing

**Upstream**: `https://www.smartgriddashboard.com/api/chart/` — EirGrid's Next.js Smart Grid dashboard. Requires a custom header `Eirgrid-Content-Request: Nextjs` or the API refuses the request. Query params are `region` (`ROI`/`NI`/`ALL`), `chartType`, `dateRange`, and `areas`.

**Areas**: `demandactual`, `windactual`, `co2intensity`, `generationactual`. `chartType` is a coarser mapping — `demand`/`wind`/`co2`/`generation`.

**Tools**: `query`, `get_current_status` (snapshot across all four areas), `get_carbon_intensity`, `get_wind`, `get_demand`, `get_generation_mix`.

**Worth stealing**:
- **15-minute resolution** — each area returns `Rows[]` at 15-min intervals. `getCurrentStatus` grabs the last row of each; the time-series tools compute min/max/average.
- **Wind %** — derived client-side from `(wind / demand) * 100`. Surprisingly often the most valuable single number for users asking "is Ireland clean right now?".
- **Resilient parallel fetch** — `getCurrentStatus` runs each area in a `try/catch` so one 502 doesn't nuke the whole snapshot.

---

### `cso-mcp` — JSON-stat 2.0 introspection

**Upstream**: `https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/{code}/JSON-stat/2.0/en` — returns the [JSON-stat 2.0](https://json-stat.org) format (dimensions, categories, flat value array indexed by dimension products).

**Parsing**: walks `dimension`/`id`/`size`/`value` fields. Extracts dimension labels + category labels, then slices the last few values of the assumed time dimension.

**Tools**: `query`, `get_dataset` (raw table code e.g. `CPM01`), `search_datasets` (fuzzy topic match against the curated popular list), `list_popular_datasets`.

**Worth stealing**:
- **Curated `POPULAR_DATASETS` dictionary** — 15 topic→code entries (population, CPI, unemployment, GDP, crime, rent, etc.) turns "what's the CPI?" into a one-hop lookup without a search API call.
- **Dimension summarisation** — showing `catCount` + first 8 category labels + `(+N more)` keeps responses tight while making the cube structure visible to the LLM.
- **Regex dataset-code detection** — `\b([A-Z]{2,4}\d{2,3})\b` lets users paste codes directly into `query`.

---

### `oireachtas-mcp` — REST wrapper over deeply nested JSON

**Upstream**: `https://api.oireachtas.ie/v1` — the official Houses of the Oireachtas open-data API. Three endpoints used: `legislation`, `members`, `debates`.

**Parsing challenge**: responses are deeply nested and inconsistently typed — fields like `house`, `origin`, `by`, `represent` are sometimes objects (`{showAs: "Dáil Éireann"}`) and sometimes bare strings. Every accessor does `typeof obj === "object" ? obj.showAs : String(obj)`.

**Tools**: `query`, `search_legislation` (bill number + status filter), `search_members` (client-side `.includes()` on `fullName`), `search_debates` (date range).

**Worth stealing**:
- **"Current" filter via `dateRange.end === null`** — a member's `memberships[]` contains historical rows; only the one with no `end` is their current seat/party.
- **Defensive extraction** — helper pattern `typeof x === "object" ? x.showAs : String(x)` repeated for every field. Ugly but matches the API's inconsistency.
- **Intent routing by keyword class** — `member|TD|senator` → members, `debate|speech|sitting` → debates, `bill|legislation|act` → legislation.

---

### `property-price-mcp` — thin REST wrapper + client-side filter

**Upstream**: `https://priceregister.civictech.ie/api/v1/residential/sales` — community-maintained REST API over the official Property Price Register. Supports `limit` and `sort` but **no server-side county/price filters**.

**Filter strategy**: when a filter is requested, fetch `limit=500` rows and filter client-side; without a filter, fetch `limit=min(requested, 50)` directly.

**Tools**: `query`, `get_recent_sales`, `get_most_expensive`, `search_sales` (county + min/max price + sort).

**Worth stealing**:
- **NL price parsing** — `"300k"`, `"500 thousand"`, bare euro amounts. "under/below/less" → `maxPrice`, "over/above/more" → `minPrice`.
- **Hardcoded county list** — all 26 ROI counties inline. `findCounty()` runs a single `.includes()` pass.
- **Price formatter** — `formatPrice` rounds and inserts thousand separators via `replace(/\B(?=(\d{3})+(?!\d))/g, ",")`. Euro symbol is `€` to avoid source-encoding issues.

---

### `hse-service-finder-mcp` — curated static dataset

**Upstream**: none at runtime. HSE publishes at `https://www.hse.ie/eng/services/list/` but there's **no public API** — it's HTML intended for humans. Scraping at request time would be slow, fragile, and legally iffy.

**Dataset**: ~40-entry `FACILITIES: Facility[]` literal covering every public acute hospital, 24/7 ED, local injury unit, maternity and paediatric hospital in Ireland. Each entry carries `type`, `county`, `region` (Hospital Group), `address`, `phone`, `has_ed`, optional `trauma_level`, and `url`.

**Tools**: `query`, `list_hospitals` (filter by county / `ed_only` / type), `search_hospitals` (weighted substring scoring), `list_counties` (coverage summary), `get_facility` (by slug), `find_service` (delegates to HSE deep link).

**Worth stealing**:
- **`norm()` is the whole matching story** — `s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()` collapses `"St. James's"` / `"St James's"` / `"st james"` into one canonical form. Good enough, no fuzzy-search library.
- **Weighted scoring** — name hit = 2, county/address hit = 1. Handles "cork" correctly: Cork University Hospital ranks above other Cork-county facilities whose address merely contains "Cork".
- **Dataset lives in Git, not a DB** — updates are a PR + redeploy. For ~40 rows that change a few times a year, Supabase or KV would be over-engineered. Dataset is also versioned and reviewable.
- **`find_service` as a pointer** — for non-hospital services (GPs, pharmacies, mental-health teams) the tool returns a deep-linked HSE Service Finder URL with pre-filled query params rather than scraping.

---

### Side-by-side summary

| MCP | Upstream shape | Freshness | Parsing | Typical latency |
|-----|----------------|-----------|---------|-----------------|
| irish-rail | XML SOAP-ish | realtime | regex | 100–800 ms |
| luas | XML (attrs + elements) | realtime | regex | 100–400 ms |
| dublin-bus | GTFS-R JSON (keyed) | realtime | native | 200–600 ms |
| dublin-bikes | GBFS JSON (2 feeds) | realtime | native + merge | 150–400 ms |
| met-eireann | JSON + JSON fallback | realtime/forecast | native | 150–500 ms |
| eirgrid | dashboard JSON | 15-min | native | 200–600 ms |
| cso | JSON-stat 2.0 | daily/quarterly | native | 300–900 ms |
| oireachtas | deeply nested JSON | daily | defensive accessors | 200–700 ms |
| property-price | thin JSON + client filter | daily | native | 200–500 ms |
| hse-service-finder | in-code dataset | redeploy-gated | none | ~10 ms |

All ten converge on the same MCP contract. The protocol hides whether we're scraping a 2008 SOAP endpoint or filtering an in-memory array — and the LLM calling the tool doesn't need to care.

---

## Contributing

Contributions are welcome! Here's how to add a new Irish MCP server:

1. **Fork** this repository
2. **Create** a new directory under `mcps/` following the existing pattern
3. **Implement** your MCP server in `src/index.ts`
4. **Add** a `wrangler.toml`, `package.json`, and `README.md`
5. **Open a pull request** with a description of the data source and tools

### What makes a good Irish MCP?

- Wraps a publicly accessible Irish data source (no auth required, or auth is free)
- Adds meaningful tool abstractions (not just a raw API proxy)
- Has clear tool descriptions so AI assistants can use them effectively
- Returns structured, usable data

### Ideas for new MCPs

- Dublin Bus / Go-Ahead real-time arrivals
- HSE health service data
- Irish water supply / outage information
- An Post parcel tracking
- Revenue.ie tax calculators
- Courts Service case listings

Not a developer? [Submit a request](https://irishmcp.ie/request) on the website and we'll build it.

---

## License

[MIT](./LICENSE) — free to use, modify, and deploy.

---

## Related

- 🌐 **Hosted Platform**: [irishmcp.ie](https://irishmcp.ie) — try all MCPs in the browser, no setup needed
- 📖 **Docs**: [irishmcp.ie/docs](https://irishmcp.ie/docs)
- 💬 **Request an MCP**: [irishmcp.ie/request](https://irishmcp.ie/request)
