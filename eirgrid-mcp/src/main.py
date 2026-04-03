"""
EirGrid Carbon Intensity MCP — Python
Live electricity grid status, wind generation and carbon intensity
Data source: EirGrid Smart Grid Dashboard (smartgriddashboard.com)
"""

import json
from datetime import datetime, timedelta

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

BASE = "https://www.smartgriddashboard.com/DashboardService.svc/data"
HEADERS = {"User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)"}


def fmt_date(dt: datetime) -> str:
    return dt.strftime("%d-%b-%Y+%H%%3A%M")


async def eirgrid_get(area: str, region: str = "ROI", hours: int = 2) -> dict:
    now = datetime.utcnow()
    date_from = fmt_date(now - timedelta(hours=hours))
    date_to = fmt_date(now)
    url = f"{BASE}?area={area}&region={region}&datefrom={date_from}&dateto={date_to}"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        return resp.json()


# ─── Tool Implementations ───────────────────────────────────────────────────

async def get_current_status(region: str = "ROI") -> str:
    areas = ["demandactual", "windactual", "co2intensity", "generationactual"]
    results = {}
    for area in areas:
        try:
            data = await eirgrid_get(area, region, hours=1)
            rows = data.get("Rows", [])
            if rows:
                latest = rows[-1]
                results[area] = {"value": latest.get("Value"), "time": latest.get("EffectiveTime")}
        except Exception:
            results[area] = {"value": "unavailable", "time": ""}

    region_label = "Republic of Ireland" if region == "ROI" else "Northern Ireland" if region == "NI" else "All-Island"
    lines = [f"EirGrid Current Status — {region_label}"]
    if results.get("demandactual", {}).get("time"):
        lines.append(f"As of: {results['demandactual']['time']}")
    lines.append("")

    demand = results.get("demandactual", {}).get("value", "?")
    wind = results.get("windactual", {}).get("value", "?")
    co2 = results.get("co2intensity", {}).get("value", "?")
    gen = results.get("generationactual", {}).get("value", "?")

    lines.append(f"  System Demand: {demand} MW")
    lines.append(f"  Total Generation: {gen} MW")
    lines.append(f"  Wind Generation: {wind} MW")
    if demand and demand != "?" and wind and wind != "?":
        try:
            pct = round(float(wind) / float(demand) * 100, 1)
            lines.append(f"  Wind Percentage: {pct}%")
        except (ValueError, ZeroDivisionError):
            pass
    lines.append(f"  Carbon Intensity: {co2} gCO2/kWh")

    return "\n".join(lines)


async def get_generation_mix(region: str = "ROI") -> str:
    areas = ["demandactual", "windactual", "generationactual"]
    results = {}
    for area in areas:
        try:
            data = await eirgrid_get(area, region, hours=1)
            rows = data.get("Rows", [])
            if rows:
                results[area] = rows[-1].get("Value")
        except Exception:
            pass

    region_label = "Republic of Ireland" if region == "ROI" else "Northern Ireland" if region == "NI" else "All-Island"
    demand = results.get("demandactual", "?")
    wind = results.get("windactual", "?")
    gen = results.get("generationactual", "?")

    lines = [f"Generation Mix — {region_label}", ""]
    lines.append(f"  Total Generation: {gen} MW")
    lines.append(f"  Wind: {wind} MW")
    if gen and gen != "?" and wind and wind != "?":
        try:
            non_wind = float(gen) - float(wind)
            lines.append(f"  Non-Wind: {non_wind:.0f} MW")
            lines.append(f"  Wind Share: {float(wind)/float(gen)*100:.1f}%")
        except (ValueError, ZeroDivisionError):
            pass
    lines.append(f"  System Demand: {demand} MW")

    return "\n".join(lines)


async def get_carbon_intensity(region: str = "ROI", hours: int = 24) -> str:
    hours = max(1, min(hours, 48))
    data = await eirgrid_get("co2intensity", region, hours)
    rows = data.get("Rows", [])
    if not rows:
        return "No carbon intensity data available."

    region_label = "Republic of Ireland" if region == "ROI" else "Northern Ireland" if region == "NI" else "All-Island"
    values = [r["Value"] for r in rows if r.get("Value") is not None]
    if not values:
        return "No carbon intensity data available."

    lines = [f"Carbon Intensity — {region_label} (last {hours}h)", ""]
    lines.append(f"  Current: {values[-1]} gCO2/kWh")
    lines.append(f"  Min: {min(values)} gCO2/kWh")
    lines.append(f"  Max: {max(values)} gCO2/kWh")
    lines.append(f"  Average: {sum(values)/len(values):.0f} gCO2/kWh")
    lines.append(f"  Data points: {len(values)} (15-min intervals)")

    lines.append("")
    lines.append("Recent readings:")
    for r in rows[-8:]:
        lines.append(f"  {r.get('EffectiveTime', '?')}: {r.get('Value', '?')} gCO2/kWh")

    return "\n".join(lines)


async def get_demand(region: str = "ROI", hours: int = 24) -> str:
    hours = max(1, min(hours, 48))
    data = await eirgrid_get("demandactual", region, hours)
    rows = data.get("Rows", [])
    if not rows:
        return "No demand data available."

    region_label = "Republic of Ireland" if region == "ROI" else "Northern Ireland" if region == "NI" else "All-Island"
    values = [r["Value"] for r in rows if r.get("Value") is not None]
    if not values:
        return "No demand data available."

    lines = [f"System Demand — {region_label} (last {hours}h)", ""]
    lines.append(f"  Current: {values[-1]} MW")
    lines.append(f"  Min: {min(values)} MW")
    lines.append(f"  Max: {max(values)} MW")
    lines.append(f"  Average: {sum(values)/len(values):.0f} MW")

    lines.append("")
    lines.append("Recent readings:")
    for r in rows[-8:]:
        lines.append(f"  {r.get('EffectiveTime', '?')}: {r.get('Value', '?')} MW")

    return "\n".join(lines)


async def get_wind(region: str = "ROI", hours: int = 24) -> str:
    hours = max(1, min(hours, 48))
    data = await eirgrid_get("windactual", region, hours)
    rows = data.get("Rows", [])
    if not rows:
        return "No wind data available."

    region_label = "Republic of Ireland" if region == "ROI" else "Northern Ireland" if region == "NI" else "All-Island"
    values = [r["Value"] for r in rows if r.get("Value") is not None]
    if not values:
        return "No wind data available."

    lines = [f"Wind Generation — {region_label} (last {hours}h)", ""]
    lines.append(f"  Current: {values[-1]} MW")
    lines.append(f"  Min: {min(values)} MW")
    lines.append(f"  Max: {max(values)} MW")
    lines.append(f"  Average: {sum(values)/len(values):.0f} MW")

    lines.append("")
    lines.append("Recent readings:")
    for r in rows[-8:]:
        lines.append(f"  {r.get('EffectiveTime', '?')}: {r.get('Value', '?')} MW")

    return "\n".join(lines)


async def natural_language_query(query: str) -> str:
    q = query.lower()
    region = "NI" if "northern" in q or " ni " in q else "ALL" if "all island" in q or "all-island" in q else "ROI"

    if "carbon" in q or "co2" in q or "emission" in q:
        return await get_carbon_intensity(region)
    if "wind" in q:
        return await get_wind(region)
    if "demand" in q or "consumption" in q:
        return await get_demand(region)
    if "mix" in q or "generation" in q:
        return await get_generation_mix(region)
    return await get_current_status(region)


# ─── MCP Tool Definitions ───────────────────────────────────────────────────

TOOLS = [
    {
        "name": "query",
        "description": "Natural language query for Irish electricity grid data. Ask about carbon intensity, wind generation, demand, or generation mix.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": 'e.g. "current grid status", "carbon intensity", "wind generation", "electricity demand"'},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_current_status",
        "description": "Get current grid snapshot: demand, generation, wind, and carbon intensity.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "region": {"type": "string", "enum": ["ROI", "NI", "ALL"], "description": "ROI (default), NI, or ALL (all-island)"},
            },
            "required": [],
        },
    },
    {
        "name": "get_carbon_intensity",
        "description": "Get carbon intensity of electricity generation (gCO2/kWh) over a time period.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "region": {"type": "string", "enum": ["ROI", "NI", "ALL"], "description": "ROI (default), NI, or ALL"},
                "hours": {"type": "number", "description": "Hours of history, 1–48 (default 24)"},
            },
            "required": [],
        },
    },
    {
        "name": "get_wind",
        "description": "Get wind generation data in MW over a time period.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "region": {"type": "string", "enum": ["ROI", "NI", "ALL"], "description": "ROI (default), NI, or ALL"},
                "hours": {"type": "number", "description": "Hours of history, 1–48 (default 24)"},
            },
            "required": [],
        },
    },
    {
        "name": "get_demand",
        "description": "Get electricity demand data in MW over a time period.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "region": {"type": "string", "enum": ["ROI", "NI", "ALL"], "description": "ROI (default), NI, or ALL"},
                "hours": {"type": "number", "description": "Hours of history, 1–48 (default 24)"},
            },
            "required": [],
        },
    },
    {
        "name": "get_generation_mix",
        "description": "Get current generation mix breakdown (wind vs non-wind).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "region": {"type": "string", "enum": ["ROI", "NI", "ALL"], "description": "ROI (default), NI, or ALL"},
            },
            "required": [],
        },
    },
]


async def call_tool(name: str, args: dict) -> str:
    match name:
        case "query":
            return await natural_language_query(str(args.get("query", "current status")))
        case "get_current_status":
            return await get_current_status(str(args.get("region", "ROI")))
        case "get_carbon_intensity":
            return await get_carbon_intensity(str(args.get("region", "ROI")), int(args.get("hours", 24)))
        case "get_wind":
            return await get_wind(str(args.get("region", "ROI")), int(args.get("hours", 24)))
        case "get_demand":
            return await get_demand(str(args.get("region", "ROI")), int(args.get("hours", 24)))
        case "get_generation_mix":
            return await get_generation_mix(str(args.get("region", "ROI")))
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
            "name": "EirGrid Carbon Intensity MCP", "version": "1.0.0",
            "description": "Live Irish electricity grid — carbon intensity, wind generation, demand",
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
                "serverInfo": {"name": "EirGrid Carbon Intensity MCP", "version": "1.0.0"},
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
    return {"status": "ok", "service": "EirGrid Carbon Intensity MCP", "version": "1.0.0"}

@app.get("/")
async def root():
    return {"service": "EirGrid Carbon Intensity MCP", "mcp_endpoint": "/mcp",
            "tools": [{"name": t["name"], "description": t["description"]} for t in TOOLS]}
