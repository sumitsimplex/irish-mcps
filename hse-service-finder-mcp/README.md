# HSE Service Finder MCP

Model Context Protocol server for locating HSE (Health Service Executive) public acute hospitals, emergency departments, injury units, maternity and paediatric hospitals across Ireland.

Hosted at: `https://hse-service-finder.irishmcp.ie/mcp`

## Tools

- `query(query)` — natural-language search across HSE facilities
- `list_hospitals({ county?, ed_only?, type? })` — filter the full facility list
- `search_hospitals({ query, limit? })` — free-text search over names, addresses, counties
- `list_counties()` — counties with at least one HSE acute facility
- `find_service({ category, county? })` — deep link to HSE Service Finder for GPs, pharmacies, mental-health teams, etc.

## Data

Curated reference dataset of ~40 HSE public acute hospitals, local injury units, maternity hospitals, and paediatric hospitals (Children's Health Ireland). Sourced from public HSE listings at <https://www.hse.ie/eng/services/list/>.

Community services (GPs, pharmacies, mental-health teams) are not redistributed here — the MCP instead returns the canonical HSE Service Finder URL for those categories.

## Deploy

```bash
cd irish-mcps/hse-service-finder-mcp
npm install
npx wrangler deploy
```
