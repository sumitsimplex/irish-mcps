"""
Dublin Bikes MCP — Python
Real-time station availability and bike counts for the Dublin Bikes scheme
Data source: Cyclocity GBFS (api.cyclocity.fr)
"""

import json
import math

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

STATUS_URL = "https://api.cyclocity.fr/contracts/dublin/gbfs/station_status.json"
INFO_URL = "https://api.cyclocity.fr/contracts/dublin/gbfs/station_information.json"
HEADERS = {"User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)"}


async def fetch_stations() -> tuple[list[dict], list[dict]]:
    async with httpx.AsyncClient() as client:
        info_resp, status_resp = await client.get(INFO_URL, headers=HEADERS, timeout=15), None
        status_resp = await client.get(STATUS_URL, headers=HEADERS, timeout=15)
        info_resp.raise_for_status()
        status_resp.raise_for_status()
        info_data = info_resp.json()["data"]["stations"]
        status_data = status_resp.json()["data"]["stations"]
    return info_data, status_data


def merge_stations(info: list[dict], status: list[dict]) -> list[dict]:
    status_map = {s["station_id"]: s for s in status}
    merged = []
    for i in info:
        sid = i["station_id"]
        s = status_map.get(sid, {})
        vehicle_types = s.get("vehicle_types_available", [])
        mechanical = 0
        electrical = 0
        for vt in vehicle_types:
            if vt.get("vehicle_type_id") == "mechanical":
                mechanical = vt.get("count", 0)
            elif vt.get("vehicle_type_id") == "electrical":
                electrical = vt.get("count", 0)
        merged.append({
            "id": sid,
            "name": i.get("name", ""),
            "address": i.get("address", ""),
            "lat": i.get("lat"),
            "lon": i.get("lon"),
            "capacity": i.get("capacity", 0),
            "bikes_available": s.get("num_bikes_available", 0),
            "mechanical_bikes": mechanical,
            "electric_bikes": electrical,
            "docks_available": s.get("num_docks_available", 0),
            "is_renting": s.get("is_renting", False),
            "is_returning": s.get("is_returning", False),
        })
    return merged


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))


# Station name lookup for common locations
KNOWN_LOCATIONS: dict[str, tuple[float, float]] = {
    "trinity": (53.3438, -6.2546),
    "trinity college": (53.3438, -6.2546),
    "st stephen's green": (53.3382, -6.2591),
    "stephens green": (53.3382, -6.2591),
    "grafton": (53.3414, -6.2595),
    "temple bar": (53.3455, -6.2643),
    "o'connell": (53.3498, -6.2603),
    "connolly": (53.3509, -6.2500),
    "heuston": (53.3464, -6.2924),
    "smithfield": (53.3474, -6.2780),
    "merrion square": (53.3395, -6.2482),
    "grand canal": (53.3389, -6.2387),
    "portobello": (53.3319, -6.2645),
    "rathmines": (53.3222, -6.2644),
    "phibsborough": (53.3594, -6.2675),
}


def find_location(query: str) -> tuple[float, float] | None:
    q = query.lower()
    for name, coords in KNOWN_LOCATIONS.items():
        if name in q:
            return coords
    return None


# ─── Tool Implementations ───────────────────────────────────────────────────

async def get_all_stations() -> str:
    info, status = await fetch_stations()
    stations = merge_stations(info, status)
    total_bikes = sum(s["bikes_available"] for s in stations)
    total_docks = sum(s["docks_available"] for s in stations)
    total_capacity = sum(s["capacity"] for s in stations)

    lines = [
        f"Dublin Bikes — {len(stations)} stations",
        f"Total bikes available: {total_bikes} | Empty docks: {total_docks} | Capacity: {total_capacity}",
        "",
    ]
    for s in sorted(stations, key=lambda x: x["name"]):
        status_icon = "🟢" if s["is_renting"] else "🔴"
        lines.append(
            f"  {status_icon} {s['name']}: {s['bikes_available']} bikes "
            f"({s['mechanical_bikes']}M/{s['electric_bikes']}E) | {s['docks_available']} docks free"
        )

    return "\n".join(lines)


async def get_station(station_name: str) -> str:
    info, status = await fetch_stations()
    stations = merge_stations(info, status)

    name_lower = station_name.lower()
    matches = [s for s in stations if name_lower in s["name"].lower() or name_lower in s.get("address", "").lower()]

    if not matches:
        # Try fuzzy: any word match
        words = name_lower.split()
        matches = [s for s in stations if any(w in s["name"].lower() for w in words)]

    if not matches:
        return f'No station found matching "{station_name}". Use get_all_stations to see the full list.'

    lines = []
    for s in matches[:5]:
        status_icon = "🟢 Open" if s["is_renting"] else "🔴 Closed"
        lines.extend([
            f"{s['name']} ({status_icon})",
            f"  Address: {s['address']}",
            f"  Bikes available: {s['bikes_available']} ({s['mechanical_bikes']} mechanical, {s['electric_bikes']} electric)",
            f"  Docks available: {s['docks_available']} of {s['capacity']}",
            f"  Location: {s['lat']}, {s['lon']}",
            f"  Returning: {'Yes' if s['is_returning'] else 'No'}",
            "",
        ])

    return "\n".join(lines)


async def find_nearest(lat: float, lon: float, limit: int = 5) -> str:
    info, status = await fetch_stations()
    stations = merge_stations(info, status)

    for s in stations:
        s["distance_km"] = haversine(lat, lon, s["lat"], s["lon"])

    nearby = sorted(stations, key=lambda x: x["distance_km"])[:max(1, min(limit, 20))]

    lines = [f"Nearest Dublin Bikes stations to ({lat:.4f}, {lon:.4f}):", ""]
    for s in nearby:
        dist = s["distance_km"]
        dist_str = f"{dist*1000:.0f}m" if dist < 1 else f"{dist:.1f}km"
        status_icon = "🟢" if s["is_renting"] else "🔴"
        lines.append(
            f"  {status_icon} {s['name']} ({dist_str}): "
            f"{s['bikes_available']} bikes | {s['docks_available']} docks free"
        )

    return "\n".join(lines)


async def natural_language_query(query: str) -> str:
    q = query.lower()

    if any(kw in q for kw in ("all station", "list station", "every station", "how many")):
        return await get_all_stations()

    if "near" in q or "closest" in q or "nearest" in q:
        loc = find_location(query)
        if loc:
            return await find_nearest(loc[0], loc[1])
        # Default to city centre
        return await find_nearest(53.3498, -6.2603)

    # Try to match a station name
    loc = find_location(query)
    if loc:
        return await find_nearest(loc[0], loc[1])

    # Try direct station search
    # Strip common words
    search = query
    for word in ["bikes", "bike", "station", "at", "in", "near", "dublin", "the", "any", "?"]:
        search = search.replace(word, "").replace(word.capitalize(), "")
    search = search.strip()
    if search:
        return await get_station(search)

    return await get_all_stations()


# ─── MCP Tool Definitions ───────────────────────────────────────────────────

TOOLS = [
    {
        "name": "query",
        "description": "Natural language query for Dublin Bikes. Ask about bike availability, nearest stations, or station details.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": 'e.g. "bikes near Trinity", "station at Grafton Street", "all stations"'},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_all_stations",
        "description": "Get all 117 Dublin Bikes stations with current bike and dock availability.",
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_station",
        "description": "Search for a Dublin Bikes station by name or address.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "station_name": {"type": "string", "description": "Station name or address to search for"},
            },
            "required": ["station_name"],
        },
    },
    {
        "name": "find_nearest",
        "description": "Find the nearest Dublin Bikes stations to a GPS coordinate.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "lat": {"type": "number", "description": "Latitude"},
                "lon": {"type": "number", "description": "Longitude"},
                "limit": {"type": "number", "description": "Number of results, 1–20 (default 5)"},
            },
            "required": ["lat", "lon"],
        },
    },
]


async def call_tool(name: str, args: dict) -> str:
    match name:
        case "query":
            return await natural_language_query(str(args.get("query", "all stations")))
        case "get_all_stations":
            return await get_all_stations()
        case "get_station":
            return await get_station(str(args["station_name"]))
        case "find_nearest":
            return await find_nearest(float(args["lat"]), float(args["lon"]), int(args.get("limit", 5)))
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
            "name": "Dublin Bikes MCP", "version": "1.0.0",
            "description": "Real-time Dublin Bikes station availability — bikes, e-bikes, docks",
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
                "serverInfo": {"name": "Dublin Bikes MCP", "version": "1.0.0"},
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
    return {"status": "ok", "service": "Dublin Bikes MCP", "version": "1.0.0"}

@app.get("/")
async def root():
    return {"service": "Dublin Bikes MCP", "mcp_endpoint": "/mcp",
            "tools": [{"name": t["name"], "description": t["description"]} for t in TOOLS]}
