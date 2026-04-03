"""
Luas Realtime MCP — Python
Implements MCP Streamable HTTP (JSON-RPC over POST)
Data source: Luas Forecasts API (luasforecasts.rpa.ie)
"""

import json
import re
import xml.etree.ElementTree as ET

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

LUAS_API = "https://luasforecasts.rpa.ie/xml/get.ashx"
HEADERS = {"User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)"}

# ─── Luas API ────────────────────────────────────────────────────────────────

async def luas_get(params: dict[str, str]) -> str:
    async with httpx.AsyncClient() as client:
        resp = await client.get(LUAS_API, params=params, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        return resp.text


# ─── Stop Lookup ─────────────────────────────────────────────────────────────

STOP_CODES: dict[str, str] = {
    # Red Line — Tallaght branch
    "tallaght": "TAL", "fettercairn": "FET", "cheeverstown": "CVN",
    "citywest": "CIT", "fortunestown": "FOR", "bridgewater": "BRI",
    "belgard": "BEL", "kingswood": "KIN",
    # Red Line — Saggart branch
    "saggart": "SAG",
    # Red Line — City
    "heuston": "HEU", "museum": "MUS",
    "james's": "JAM", "james": "JAM", "st james": "JAM",
    "fatima": "FAT", "rialto": "RIA",
    "suir road": "SUI", "suir": "SUI",
    "goldenbridge": "GOL", "drimnagh": "DRI", "bluebell": "BLU",
    "kylemore": "KYL", "red cow": "RED",
    "bambury's corner": "BAM", "bambury": "BAM",
    "cookstown": "COO",
    # Red Line — Docklands
    "jervis": "JER", "abbey street": "ABB", "abbey": "ABB",
    "busaras": "BUS", "connolly": "CON",
    "mayor square": "MAY", "mayor": "MAY",
    "george's dock": "GDK", "georges dock": "GDK",
    "spencer dock": "SDK", "the point": "TPT", "point": "TPT",
    # Green Line
    "st stephen's green": "STS", "stephens green": "STS", "stephen's green": "STS",
    "broombridge": "BRO", "cabra": "CAB", "phibsborough": "PHI",
    "grangegorman": "GRA", "broadstone": "BDS", "dominick": "DOM",
    "parnell": "PAR",
    "o'connell - gpo": "OCP", "o'connell": "OCP", "gpo": "OCP",
    "o'connell upper": "OCU", "marlborough": "MAR",
    "westmoreland": "WES", "trinity": "TRY", "trinity college": "TRY",
    "dawson": "DAW", "st stephen's green south": "STG",
    "harcourt": "HAR", "charlemont": "CHA", "ranelagh": "RAN",
    "beechwood": "BEE", "cowper": "COW", "milltown": "MIL",
    "windy arbour": "WIN", "dundrum": "DUN", "balally": "BAL",
    "kilmacud": "KIL", "stillorgan": "STI", "sandyford": "SAN",
    "central park": "CPK", "glencairn": "GLC", "the gallops": "GAL",
    "leopardstown valley": "LPV", "leopardstown": "LPV",
    "ballyogan wood": "BAW", "carrickmines": "CAR",
    "laughanstown": "LAU", "cherrywood": "CHE", "brides glen": "BRG",
}


def find_stop_code(query: str) -> str | None:
    q = query.lower()
    for name, code in STOP_CODES.items():
        if name in q:
            return code
    m = re.search(r"\b([A-Z]{2,4})\b", query)
    return m.group(1) if m else None


# ─── Tool Implementations ───────────────────────────────────────────────────

async def get_all_stops() -> str:
    xml_text = await luas_get({"action": "stops", "encrypt": "false"})
    # Parse using regex since the Luas XML uses a mix of self-closing and regular tags
    red_match = re.search(r'<line id="red"[^>]*>([\s\S]*?)</line>', xml_text, re.I)
    green_match = re.search(r'<line id="green"[^>]*>([\s\S]*?)</line>', xml_text, re.I)

    def parse_stops(block: str) -> list[dict]:
        stops = []
        for m in re.finditer(r'<stop\s+([^>]*?)(?:>([^<]*)</stop>|/>)', block):
            attrs_str, text = m.group(1), (m.group(2) or "").strip()
            attrs = dict(re.findall(r'(\w+)="([^"]*)"', attrs_str))
            attrs["name"] = text or attrs.get("pronunciation", "")
            stops.append(attrs)
        return stops

    red = parse_stops(red_match.group(1)) if red_match else []
    green = parse_stops(green_match.group(1)) if green_match else []

    return (
        f"Luas stops ({len(red)} Red Line, {len(green)} Green Line):\n\n"
        f"RED LINE ({len(red)} stops):\n{json.dumps(red, indent=2)}\n\n"
        f"GREEN LINE ({len(green)} stops):\n{json.dumps(green, indent=2)}"
    )


async def get_stop_forecast(stop_abbr: str) -> str:
    xml_text = await luas_get({"action": "forecast", "stop": stop_abbr.upper(), "encrypt": "false"})

    # Extract stop name and metadata from attributes
    stop_name_match = re.search(r'stop="([^"]*)"', xml_text)
    created_match = re.search(r'created="([^"]*)"', xml_text)
    message_match = re.search(r'message="([^"]*)"', xml_text)
    stop_name = stop_name_match.group(1) if stop_name_match else stop_abbr
    created = created_match.group(1) if created_match else ""
    message = message_match.group(1) if message_match else ""

    # Parse directions and trams
    directions = []
    for dm in re.finditer(r'<direction name="([^"]+)">([\s\S]*?)</direction>', xml_text):
        dir_name = dm.group(1)
        trams = []
        for tm in re.finditer(r'<tram dueMins="([^"]+)" destination="([^"]+)"', dm.group(2)):
            trams.append({"dueMins": tm.group(1), "destination": tm.group(2)})
        directions.append({"name": dir_name, "trams": trams})

    if not directions:
        return f"No forecast data for stop {stop_abbr}. Check the stop abbreviation (use get_all_stops to find it)."

    lines = [f"Stop: {stop_name} ({stop_abbr.upper()})", f"Updated: {created}"]
    if message:
        lines.append(f"Service message: {message}")
    lines.append("")

    for d in directions:
        lines.append(f"→ {d['name']}:")
        if not d["trams"]:
            lines.append("  No trams scheduled.")
        else:
            for tram in d["trams"]:
                due = "Due now" if tram["dueMins"] == "DUE" else f"{tram['dueMins']} min"
                lines.append(f"  {due} → {tram['destination']}")

    return "\n".join(lines)


async def natural_language_query(query: str) -> str:
    q = query.lower()

    if any(kw in q for kw in ("all stop", "list stop", "every stop", "stations")):
        return await get_all_stops()

    code = find_stop_code(query)
    if code:
        return await get_stop_forecast(code)

    return await get_stop_forecast("STS")


# ─── MCP Tool Definitions ───────────────────────────────────────────────────

TOOLS = [
    {
        "name": "query",
        "description": "Natural language query for Luas tram data. Ask about next trams at a stop or list all stops.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": 'e.g. "next trams at Heuston", "trams at St Stephen\'s Green", "all stops", "Dundrum trams"'},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_stop_forecast",
        "description": "Get next tram arrival times for a Luas stop on the Red or Green line.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "stop": {"type": "string", "description": "Stop abbreviation e.g. STS (St Stephen's Green), HEU (Heuston), DUN (Dundrum)"},
            },
            "required": ["stop"],
        },
    },
    {
        "name": "get_all_stops",
        "description": "List all Luas stops on the Red and Green lines with their abbreviations, GPS coordinates and park-and-ride info.",
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
]


# ─── Tool Dispatch ──────────────────────────────────────────────────────────

async def call_tool(name: str, args: dict) -> str:
    match name:
        case "query":
            return await natural_language_query(str(args.get("query", "next trams at St Stephen's Green")))
        case "get_stop_forecast":
            return await get_stop_forecast(str(args["stop"]))
        case "get_all_stops":
            return await get_all_stops()
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
            "name": "Luas Realtime MCP",
            "version": "1.0.0",
            "description": "Live Luas tram times for Red and Green lines",
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
                "serverInfo": {"name": "Luas Realtime MCP", "version": "1.0.0"},
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
    return {"status": "ok", "service": "Luas Realtime MCP", "version": "1.0.0"}


@app.get("/")
async def root():
    return {
        "service": "Luas Realtime MCP",
        "mcp_endpoint": "/mcp",
        "tools": [{"name": t["name"], "description": t["description"]} for t in TOOLS],
    }
