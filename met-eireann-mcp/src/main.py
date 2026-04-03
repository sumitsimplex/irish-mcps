"""
Met Éireann Weather MCP — Python
Current conditions: Met Éireann Observations API (prodapi.metweb.ie)
Forecasts: Open-Meteo (open-meteo.com) — free, no key, same underlying model
"""

import json
import re
from dataclasses import dataclass

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

OBSERVATIONS_API = "https://prodapi.metweb.ie/observations"
FORECAST_API = "https://api.open-meteo.com/v1/forecast"
HEADERS = {"User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)"}

# ─── Location Data ───────────────────────────────────────────────────────────

@dataclass
class Location:
    lat: float
    lon: float
    county: str

LOCATIONS: dict[str, Location] = {
    "dublin":     Location(53.3498, -6.2603,  "Dublin"),
    "cork":       Location(51.8985, -8.4756,  "Cork"),
    "galway":     Location(53.2707, -9.0568,  "Galway"),
    "limerick":   Location(52.6638, -8.6267,  "Limerick"),
    "waterford":  Location(52.2593, -7.1101,  "Waterford"),
    "kilkenny":   Location(52.6541, -7.2448,  "Kilkenny"),
    "sligo":      Location(54.2766, -8.4761,  "Sligo"),
    "wexford":    Location(52.3369, -6.4633,  "Wexford"),
    "kerry":      Location(52.1545, -9.5669,  "Kerry"),
    "tralee":     Location(52.2675, -9.6987,  "Kerry"),
    "killarney":  Location(52.0599, -9.5044,  "Kerry"),
    "donegal":    Location(54.6538, -8.1096,  "Donegal"),
    "mayo":       Location(53.8483, -9.2993,  "Mayo"),
    "castlebar":  Location(53.8550, -9.2983,  "Mayo"),
    "tipperary":  Location(52.4735, -8.1619,  "Tipperary"),
    "clare":      Location(52.9045, -9.0000,  "Clare"),
    "ennis":      Location(52.8436, -8.9862,  "Clare"),
    "wicklow":    Location(52.9808, -6.0439,  "Wicklow"),
    "kildare":    Location(53.1609, -6.9111,  "Kildare"),
    "naas":       Location(53.2197, -6.6658,  "Kildare"),
    "meath":      Location(53.6550, -6.6564,  "Meath"),
    "navan":      Location(53.6542, -6.6800,  "Meath"),
    "louth":      Location(53.9981, -6.4130,  "Louth"),
    "dundalk":    Location(54.0015, -6.4050,  "Louth"),
    "drogheda":   Location(53.7185, -6.3536,  "Louth"),
    "offaly":     Location(53.2745, -7.4901,  "Offaly"),
    "laois":      Location(52.9941, -7.3324,  "Laois"),
    "carlow":     Location(52.8382, -6.9334,  "Carlow"),
    "cavan":      Location(53.9897, -7.3633,  "Cavan"),
    "monaghan":   Location(54.2492, -6.9683,  "Monaghan"),
    "roscommon":  Location(53.6274, -8.1859,  "Roscommon"),
    "longford":   Location(53.7276, -7.7966,  "Longford"),
    "westmeath":  Location(53.5350, -7.4653,  "Westmeath"),
    "athlone":    Location(53.4229, -7.9397,  "Westmeath"),
    "leitrim":    Location(54.1247, -8.0003,  "Leitrim"),
}


def find_location(query: str) -> Location | None:
    q = query.lower()
    for name, loc in LOCATIONS.items():
        if name in q:
            return loc
    return None


# ─── WMO Weather Code → Description ─────────────────────────────────────────

def wmo_description(code: int) -> str:
    if code == 0: return "Clear sky"
    if code == 1: return "Mainly clear"
    if code == 2: return "Partly cloudy"
    if code == 3: return "Overcast"
    if code <= 48: return "Foggy"
    if code <= 57: return "Drizzle"
    if code <= 67: return "Rain"
    if code <= 77: return "Snow"
    if code <= 82: return "Rain showers"
    if code <= 86: return "Snow showers"
    return "Thunderstorm"


# ─── Tool Implementations ───────────────────────────────────────────────────

async def get_current_conditions(location_query: str) -> str:
    loc = find_location(location_query)
    if not loc:
        return f'Unknown location: "{location_query}". Try a county name like Dublin, Cork, Galway, Kerry, etc.'

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{OBSERVATIONS_API}/{loc.county}/today", headers=HEADERS, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            if not data:
                return f"No observations available for {loc.county}."
            latest = data[-1]
            return "\n".join([
                f"Current conditions in {loc.county} ({latest['name']}, as of {latest['reportTime']}):",
                f"  Weather: {latest['weatherDescription']}",
                f"  Temperature: {latest['temperature']}°C",
                f"  Wind: {latest['windSpeed']} km/h {latest['cardinalWindDirection']} (gusts {latest['windGust']} km/h)",
                f"  Humidity: {latest['humidity'].strip()}%",
                f"  Rainfall: {latest['rainfall'].strip()} mm",
                f"  Pressure: {latest['pressure']} hPa",
            ])
        except Exception:
            # Fallback to Open-Meteo
            resp = await client.get(FORECAST_API, params={
                "latitude": loc.lat, "longitude": loc.lon,
                "current": "temperature_2m,precipitation,windspeed_10m,windgusts_10m,weathercode,relativehumidity_2m",
                "timezone": "Europe/Dublin",
            }, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            c = resp.json()["current"]
            return "\n".join([
                f"Current conditions in {loc.county} ({c['time']}):",
                f"  Weather: {wmo_description(c['weathercode'])}",
                f"  Temperature: {c['temperature_2m']}°C",
                f"  Wind: {c['windspeed_10m']} km/h (gusts {c['windgusts_10m']} km/h)",
                f"  Humidity: {c['relativehumidity_2m']}%",
                f"  Precipitation: {c['precipitation']} mm",
            ])


async def get_forecast(location_query: str, days: int = 5) -> str:
    loc = find_location(location_query)
    if not loc:
        return f'Unknown location: "{location_query}". Try a county name like Dublin, Cork, Galway, Kerry, etc.'

    d = max(1, min(days, 7))
    async with httpx.AsyncClient() as client:
        resp = await client.get(FORECAST_API, params={
            "latitude": loc.lat, "longitude": loc.lon,
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max,windgusts_10m_max",
            "timezone": "Europe/Dublin", "forecast_days": d,
        }, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        daily = resp.json()["daily"]

    lines = [f"{d}-day forecast for {loc.county}:\n"]
    for i in range(len(daily["time"])):
        from datetime import date as dt_date
        parts = daily["time"][i].split("-")
        day_date = dt_date(int(parts[0]), int(parts[1]), int(parts[2]))
        day_str = day_date.strftime("%A, %b %d")
        lines.extend([
            day_str,
            f"  {wmo_description(daily['weathercode'][i])}",
            f"  High: {daily['temperature_2m_max'][i]}°C  Low: {daily['temperature_2m_min'][i]}°C",
            f"  Rain: {daily['precipitation_sum'][i]} mm  Wind: {daily['windspeed_10m_max'][i]} km/h (gusts {daily['windgusts_10m_max'][i]} km/h)",
            "",
        ])
    return "\n".join(lines)


async def get_today_hourly(location_query: str) -> str:
    loc = find_location(location_query)
    if not loc:
        return f'Unknown location: "{location_query}". Try a county name like Dublin, Cork, Galway, Kerry, etc.'

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{OBSERVATIONS_API}/{loc.county}/today", headers=HEADERS, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            if not data:
                return f"No hourly data for {loc.county} today."
            lines = [f"Today's hourly observations for {loc.county} ({data[0]['reportTime']} – {data[-1]['reportTime']}):\n"]
            for h in data:
                lines.append(
                    f"{h['reportTime']}  {h['temperature']}°C  {h['weatherDescription']}  "
                    f"Wind: {h['windSpeed']} km/h {h['cardinalWindDirection']}  Rain: {h['rainfall'].strip()} mm"
                )
            return "\n".join(lines)
        except Exception:
            return f"Could not retrieve hourly data for {loc.county}."


async def natural_language_query(query: str) -> str:
    q = query.lower()
    loc_str = query if find_location(query) else "Dublin"

    if any(kw in q for kw in ("forecast", "week", "tomorrow", "weekend", "day")):
        days_match = re.search(r"(\d+)\s*day", query, re.I)
        days = int(days_match.group(1)) if days_match else 5
        return await get_forecast(loc_str, days)
    if any(kw in q for kw in ("hourly", "today", "hour")):
        return await get_today_hourly(loc_str)
    return await get_current_conditions(loc_str)


# ─── MCP Tool Definitions ───────────────────────────────────────────────────

TOOLS = [
    {
        "name": "query",
        "description": "Natural language weather query for any Irish location. Ask about current conditions, forecasts, or today's hourly breakdown.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": 'e.g. "Weather in Dublin", "5 day forecast for Cork", "Is it raining in Galway?", "Weekend forecast Kerry"'},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_current_conditions",
        "description": "Get current weather conditions for an Irish county or city from Met Éireann observations.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "County or city name e.g. Dublin, Cork, Galway, Kerry, Limerick"},
            },
            "required": ["location"],
        },
    },
    {
        "name": "get_forecast",
        "description": "Get a multi-day weather forecast for an Irish location (1–7 days).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "County or city name e.g. Dublin, Cork, Galway"},
                "days": {"type": "number", "description": "Number of days to forecast, 1–7 (default 5)"},
            },
            "required": ["location"],
        },
    },
    {
        "name": "get_today_hourly",
        "description": "Get today's hourly weather observations for an Irish county from Met Éireann.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "County or city name e.g. Dublin, Cork, Galway"},
            },
            "required": ["location"],
        },
    },
]


# ─── Tool Dispatch ──────────────────────────────────────────────────────────

async def call_tool(name: str, args: dict) -> str:
    match name:
        case "query":
            return await natural_language_query(str(args.get("query", "Weather in Dublin")))
        case "get_current_conditions":
            return await get_current_conditions(str(args["location"]))
        case "get_forecast":
            return await get_forecast(str(args["location"]), int(args.get("days", 5)))
        case "get_today_hourly":
            return await get_today_hourly(str(args["location"]))
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
            "name": "Met Éireann Weather MCP",
            "version": "1.0.0",
            "description": "Live Irish weather — current conditions, forecasts and hourly data",
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
                "serverInfo": {"name": "Met Éireann Weather MCP", "version": "1.0.0"},
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
    return {"status": "ok", "service": "Met Éireann Weather MCP", "version": "1.0.0"}


@app.get("/")
async def root():
    return {
        "service": "Met Éireann Weather MCP",
        "mcp_endpoint": "/mcp",
        "tools": [{"name": t["name"], "description": t["description"]} for t in TOOLS],
    }
