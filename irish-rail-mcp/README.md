# Irish Rail Realtime MCP

A Cloudflare Worker implementing the [Model Context Protocol](https://modelcontextprotocol.io) for the Irish Rail Realtime API.

## Tools

| Tool | Description |
|------|-------------|
| `query` | Natural language — "trains at Connolly", "current DARTs", "all stations" |
| `get_all_stations` | All 145+ stations with codes and GPS coordinates |
| `get_station_trains` | Real-time arrivals/departures for a station by code |
| `get_current_trains` | All trains currently running with live GPS positions |
| `get_train_movements` | Full schedule + movement history for a specific train |

## Deploy to Cloudflare Workers

### 1. Install dependencies
```bash
npm install
```

### 2. Login to Cloudflare
```bash
npx wrangler login
```

### 3. Deploy
```bash
npm run deploy
```

Your MCP will be live at:
```
https://irish-rail-mcp.<your-account>.workers.dev/mcp
```

### 4. Test it
```bash
# Health check
curl https://irish-rail-mcp.<your-account>.workers.dev/health

# List tools
curl -X POST https://irish-rail-mcp.<your-account>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Current trains
curl -X POST https://irish-rail-mcp.<your-account>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_current_trains","arguments":{"train_type":"D"}}}'

# Trains at Connolly
curl -X POST https://irish-rail-mcp.<your-account>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_station_trains","arguments":{"station_code":"CNLLY"}}}'
```

## Connect to IrishMCP Website

After deploying, update the endpoint in Supabase:

```sql
UPDATE public.mcps
SET
  status = 'live',
  endpoint_url = 'https://irish-rail-mcp.<your-account>.workers.dev/mcp'
WHERE slug = 'irish-rail-realtime';
```

Or use the Admin Dashboard → MCPs tab → change status to Live, then update endpoint_url in the Supabase Table Editor.

## Use with Claude Desktop

Add to `~/.claude/claude_desktop_config.json` (or `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "irish-rail": {
      "type": "streamableHttp",
      "url": "https://irish-rail-mcp.<your-account>.workers.dev/mcp"
    }
  }
}
```

## Local Development
```bash
npm run dev
# Server at http://localhost:8787/mcp
```

## Data Source

[Irish Rail Realtime API](http://api.irishrail.ie/realtime/) — public, no auth required.
