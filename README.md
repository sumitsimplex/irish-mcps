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
├── oireachtas-mcp/      # Houses of the Oireachtas
└── property-price-mcp/  # Property Price Register
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
