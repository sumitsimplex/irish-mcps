"""
CSO Statistics MCP — Python
Access Central Statistics Office datasets — census, economic indicators, population
Data source: CSO PxStat API (ws.cso.ie)
"""

import json

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

BASE = "https://ws.cso.ie/public/api.restful"
HEADERS = {"User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)"}

# Popular dataset codes for discovery
POPULAR_DATASETS = {
    "population": {"code": "PEA01", "name": "Population Estimates"},
    "census": {"code": "F1001", "name": "Census 2022 — Population by Area"},
    "cpi": {"code": "CPM01", "name": "Consumer Price Index"},
    "unemployment": {"code": "QLF18", "name": "Unemployment Rate"},
    "gdp": {"code": "NQQ36", "name": "GDP at Current Market Prices"},
    "house prices": {"code": "HPM09", "name": "Residential Property Price Index"},
    "housing": {"code": "HPM09", "name": "Residential Property Price Index"},
    "births": {"code": "VSA02", "name": "Births by County"},
    "deaths": {"code": "VSA07", "name": "Deaths by County"},
    "tourism": {"code": "TMA11", "name": "Overseas Trips to Ireland"},
    "crime": {"code": "CJA09", "name": "Recorded Crime Incidents"},
    "earnings": {"code": "EHQ02", "name": "Average Weekly Earnings"},
    "rent": {"code": "RIQ02", "name": "RTB Average Monthly Rent"},
    "migration": {"code": "PEA18", "name": "Population and Migration Estimates"},
    "motor vehicles": {"code": "TEA11", "name": "New Motor Vehicles Licensed"},
}


async def api_get(path: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{BASE}/{path}", headers=HEADERS, timeout=30)
        resp.raise_for_status()
        return resp.json()


# ─── Tool Implementations ───────────────────────────────────────────────────

async def get_dataset(table_code: str) -> str:
    data = await api_get(f"PxStat.Data.Cube_API.ReadDataset/{table_code}/JSON-stat/2.0/en")

    label = data.get("label", table_code)
    dimensions = data.get("dimension", {})
    dim_ids = data.get("id", [])
    sizes = data.get("size", [])
    values = data.get("value", [])
    updated = data.get("updated", "")

    lines = [f"Dataset: {label}", f"Table Code: {table_code}"]
    if updated:
        lines.append(f"Last Updated: {updated}")
    lines.append("")

    # Describe dimensions
    lines.append("Dimensions:")
    for dim_id in dim_ids:
        dim = dimensions.get(dim_id, {})
        dim_label = dim.get("label", dim_id)
        categories = dim.get("category", {})
        cat_labels = categories.get("label", {})
        cat_count = len(cat_labels)
        lines.append(f"  {dim_label}: {cat_count} categories")
        # Show first few categories
        shown = list(cat_labels.values())[:8]
        if shown:
            preview = ", ".join(str(s) for s in shown)
            if cat_count > 8:
                preview += f" ... (+{cat_count - 8} more)"
            lines.append(f"    [{preview}]")
    lines.append("")

    # Show total data points
    lines.append(f"Total data points: {len(values)}")

    # Show most recent values (last dimension is usually time)
    if dim_ids and values:
        time_dim_id = dim_ids[-1]
        time_dim = dimensions.get(time_dim_id, {})
        time_cats = time_dim.get("category", {})
        time_labels = list(time_cats.get("label", {}).values())

        if time_labels and len(dim_ids) >= 2:
            # Get first statistic's values across recent time periods
            first_dim_id = dim_ids[0]
            first_dim = dimensions.get(first_dim_id, {})
            first_labels = list(first_dim.get("category", {}).get("label", {}).values())

            # Calculate stride for time dimension
            stride = 1
            for s in sizes[dim_ids.index(time_dim_id)+1:]:
                stride *= s

            lines.append("")
            lines.append("Recent values:")

            # Show last 5 time periods for first statistic
            n_times = len(time_labels)
            n_stats = sizes[0] if sizes else 1
            total_per_stat = len(values) // n_stats if n_stats else len(values)

            for t_idx in range(max(0, n_times - 5), n_times):
                time_label = time_labels[t_idx]
                val = values[t_idx] if t_idx < len(values) else None
                stat_label = first_labels[0] if first_labels else ""
                if val is not None:
                    lines.append(f"  {time_label}: {val} ({stat_label})")

    return "\n".join(lines)


async def list_popular_datasets() -> str:
    lines = ["Popular CSO Datasets:", ""]
    for topic, info in POPULAR_DATASETS.items():
        lines.append(f"  {info['code']} — {info['name']} (search: \"{topic}\")")
    lines.append("")
    lines.append("Use get_dataset with the table code to fetch data.")
    lines.append("Browse all datasets at https://data.cso.ie")
    return "\n".join(lines)


async def search_datasets(topic: str) -> str:
    topic_lower = topic.lower()
    matches = []
    for kw, info in POPULAR_DATASETS.items():
        if kw in topic_lower or topic_lower in kw:
            matches.append(info)

    if not matches:
        lines = [f'No datasets found for "{topic}". Popular topics:', ""]
        for kw in POPULAR_DATASETS:
            lines.append(f"  - {kw}")
        lines.append("")
        lines.append("Or provide a table code directly (e.g. CPM01, PEA01)")
        return "\n".join(lines)

    if len(matches) == 1:
        return await get_dataset(matches[0]["code"])

    lines = [f'Datasets matching "{topic}":', ""]
    for m in matches:
        lines.append(f"  {m['code']} — {m['name']}")
    lines.append("")
    lines.append("Use get_dataset with the table code to fetch data.")
    return "\n".join(lines)


async def natural_language_query(query: str) -> str:
    q = query.lower()

    if any(kw in q for kw in ("list", "popular", "available", "what dataset", "browse")):
        return await list_popular_datasets()

    # Check if query contains a table code pattern (uppercase letters + digits)
    import re
    code_match = re.search(r"\b([A-Z]{2,4}\d{2,3})\b", query)
    if code_match:
        return await get_dataset(code_match.group(1))

    return await search_datasets(query)


# ─── MCP Tool Definitions ───────────────────────────────────────────────────

TOOLS = [
    {
        "name": "query",
        "description": "Natural language query for CSO statistics. Ask about population, GDP, CPI, unemployment, housing, crime, etc.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": 'e.g. "population of Ireland", "CPI data", "unemployment rate", "house prices"'},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_dataset",
        "description": "Fetch a specific CSO dataset by its table code (e.g. CPM01, PEA01, F1001).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "table_code": {"type": "string", "description": "CSO table code e.g. CPM01, PEA01, NQQ36, HPM09"},
            },
            "required": ["table_code"],
        },
    },
    {
        "name": "search_datasets",
        "description": "Search for CSO datasets by topic keyword.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "topic": {"type": "string", "description": "Topic to search for e.g. population, housing, crime, earnings"},
            },
            "required": ["topic"],
        },
    },
    {
        "name": "list_popular_datasets",
        "description": "List popular and commonly requested CSO datasets with their table codes.",
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
]


async def call_tool(name: str, args: dict) -> str:
    match name:
        case "query":
            return await natural_language_query(str(args.get("query", "popular datasets")))
        case "get_dataset":
            return await get_dataset(str(args["table_code"]))
        case "search_datasets":
            return await search_datasets(str(args["topic"]))
        case "list_popular_datasets":
            return await list_popular_datasets()
        case _:
            raise ValueError(f"Unknown tool: {name}")


# ─── MCP JSON-RPC Handler ───────────────────────────────────────────────────

def jsonrpc_ok(result, id_val):
    return JSONResponse({"jsonrpc": "2.0", "result": result, "id": id_val})

def jsonrpc_err(code: int, msg: str, id_val):
    return JSONResponse({"jsonrpc": "2.0", "error": {"code": code, "message": msg}, "id": id_val})


@app.api_route("/mcp", methods=["GET", "POST", "OPTIONS"])
@app.api_route("/mcp/", methods=["GET", "POST", "OPTIONS"])
async def mcp_handler(request: Request):
    if request.method == "OPTIONS":
        return Response(status_code=204)
    if request.method == "GET":
        return JSONResponse({
            "name": "CSO Statistics MCP", "version": "1.0.0",
            "description": "Central Statistics Office datasets — census, economy, population, housing",
            "tools": [t["name"] for t in TOOLS],
        })
    try:
        body = await request.json()
    except Exception:
        return jsonrpc_err(-32700, "Parse error", None)

    id_val = body.get("id")
    method = body.get("method")

    match method:
        case "initialize":
            return jsonrpc_ok({
                "protocolVersion": "2024-11-05",
                "serverInfo": {"name": "CSO Statistics MCP", "version": "1.0.0"},
                "capabilities": {"tools": {}},
            }, id_val)
        case "notifications/initialized":
            return Response(status_code=204)
        case "ping":
            return jsonrpc_ok({}, id_val)
        case "tools/list":
            return jsonrpc_ok({"tools": TOOLS}, id_val)
        case "tools/call":
            p = body.get("params", {})
            if not p.get("name"):
                return jsonrpc_err(-32602, "Missing tool name", id_val)
            try:
                text = await call_tool(p["name"], p.get("arguments", {}))
                return jsonrpc_ok({"content": [{"type": "text", "text": text}]}, id_val)
            except Exception as e:
                return jsonrpc_err(-32000, str(e), id_val)
        case _:
            return jsonrpc_err(-32601, f"Method not found: {method}", id_val)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "CSO Statistics MCP", "version": "1.0.0"}

@app.get("/")
async def root():
    return {"service": "CSO Statistics MCP", "mcp_endpoint": "/mcp",
            "tools": [{"name": t["name"], "description": t["description"]} for t in TOOLS]}
