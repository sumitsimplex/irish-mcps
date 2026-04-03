"""
Irish Rail Realtime MCP — Python
Implements MCP Streamable HTTP (JSON-RPC over POST)
"""

import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

RAIL = "http://api.irishrail.ie/realtime/realtime.asmx"
HEADERS = {"User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)"}

# ─── XML Parser ──────────────────────────────────────────────────────────────

def parse_objects(xml_text: str, tag: str, fields: list[str]) -> list[dict[str, str]]:
    results = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return results
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"
    for elem in root.iter(f"{ns}{tag}"):
        obj = {}
        for f in fields:
            child = elem.find(f"{ns}{f}")
            obj[f] = (child.text or "").strip() if child is not None else ""
        results.append(obj)
    return results


# ─── Irish Rail API ──────────────────────────────────────────────────────────

async def rail_get(path: str, params: dict[str, str] | None = None) -> str:
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{RAIL}/{path}", params=params or {}, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        return resp.text


# ─── Station Lookup ──────────────────────────────────────────────────────────

STATION_CODES: dict[str, str] = {
    "connolly": "CNLLY", "dublin connolly": "CNLLY",
    "heuston": "HSTON", "dublin heuston": "HSTON",
    "pearse": "PERSE", "dublin pearse": "PERSE",
    "tara street": "TARA", "tara": "TARA",
    "grand canal dock": "GCDK", "grand canal": "GCDK",
    "lansdowne": "LNDN", "lansdowne road": "LNDN",
    "sandymount": "SNMT",
    "sydney parade": "SYDP",
    "booterstown": "BTSTN",
    "blackrock": "BROCK",
    "seapoint": "SEPNT",
    "salthill": "SLHLL",
    "dun laoghaire": "DUNLR", "dun laoire": "DUNLR",
    "sandycove": "SCOVE",
    "glenageary": "GLNGY",
    "dalkey": "DLKEY",
    "killiney": "KLNY",
    "shankill": "SHNKL",
    "bray": "BRAY",
    "greystones": "GRYST",
    "malahide": "MHIDE",
    "portmarnock": "PMRCK",
    "clongriffin": "CLNGR",
    "harmonstown": "HRMSTN",
    "killester": "KLSTR",
    "raheny": "RAHNY",
    "clontarf road": "CNTRF",
    "howth junction": "HWTHJ",
    "howth": "HWTH",
    "bayside": "BYSDE",
    "sutton": "SUTTN",
    "cork": "CORK",
    "limerick": "LMRCK",
    "galway": "GALWY",
    "waterford": "WFORD",
    "belfast": "BFSTC",
    "drogheda": "DRGDA",
    "dundalk": "DNDLK",
    "newry": "NEWRY",
    "portlaoise": "PTLSE",
    "kildare": "KDARE",
    "newbridge": "NBRGE",
    "athlone": "ATHLNE",
    "tullamore": "TLLMR",
    "thurles": "THRLS",
    "templemore": "TPMOR",
    "clondalkin": "CLDKN",
    "hazelhatch": "HZLCH",
    "celbridge": "HZLCH",
    "adamstown": "ADMTN",
    "lucan": "LCAN",
    "sallins": "SALNS",
    "naas": "SALNS",
    "portarlington": "PTRTN",
}


def find_station_code(query: str) -> str | None:
    q = query.lower()
    for name, code in STATION_CODES.items():
        if name in q:
            return code
    m = re.search(r"\b([A-Z]{3,6})\b", query)
    return m.group(1) if m else None


# ─── Tool Implementations ───────────────────────────────────────────────────

async def get_all_stations() -> str:
    xml = await rail_get("getAllStationsXML")
    stations = parse_objects(xml, "objStation", [
        "StationCode", "StationDesc", "StationAlias",
        "StationLatitude", "StationLongitude", "StationId",
    ])
    return f"Found {len(stations)} Irish Rail stations:\n\n" + json.dumps(stations, indent=2)


async def get_station_trains(station_code: str, mins_ahead: int = 90) -> str:
    xml = await rail_get("getStationDataByCodeXML", {
        "StationCode": station_code.upper(),
        "NumMins": str(min(mins_ahead, 90)),
    })
    trains = parse_objects(xml, "objStationData", [
        "Stationfullname", "Servertime", "Traincode", "Origin", "Destination",
        "Origintime", "Destinationtime", "Status", "Lastlocation",
        "Duein", "Late", "Exparrival", "Expdepart", "Scharrival", "Schdepart",
        "Direction", "Traintype", "Locationtype",
    ])
    if not trains:
        return f"No trains scheduled at {station_code} in the next {mins_ahead} minutes."
    name = trains[0].get("Stationfullname", station_code)
    return f"{len(trains)} train(s) at {name} in the next {mins_ahead} minutes:\n\n" + json.dumps(trains, indent=2)


async def get_current_trains(train_type: str = "A") -> str:
    xml = await rail_get("getCurrentTrainsXML", {"TrainType": train_type})
    trains = parse_objects(xml, "objTrainPositions", [
        "TrainStatus", "TrainLatitude", "TrainLongitude", "TrainCode",
        "TrainDate", "PublicMessage", "Direction",
    ])
    label = {"D": "DART", "M": "Mainline", "S": "Suburban"}.get(train_type, "All")
    return f"{len(trains)} {label} trains currently running:\n\n" + json.dumps(trains, indent=2)


async def get_train_movements(train_id: str, train_date: str) -> str:
    xml = await rail_get("getTrainMovementsXML", {
        "TrainId": train_id.upper(),
        "TrainDate": train_date,
    })
    movements = parse_objects(xml, "objTrainMovements", [
        "TrainCode", "TrainDate", "LocationCode", "LocationFullName", "LocationOrder",
        "LocationType", "TrainOrigin", "TrainDestination",
        "ScheduledArrival", "ScheduledDeparture",
        "ExpectedArrival", "ExpectedDeparture",
        "Arrival", "Departure", "AutoArrival", "AutoDepart", "StopType",
    ])
    if not movements:
        return f'No movements found for train {train_id} on {train_date}. Check the train code and date format (e.g. "08 Mar 2026").'
    info = movements[0]
    return (
        f"Train {train_id} — {info.get('TrainOrigin', '?')} → {info.get('TrainDestination', '?')} on {train_date}:\n\n"
        + json.dumps(movements, indent=2)
    )


async def natural_language_query(query: str) -> str:
    q = query.lower()

    train_id_match = re.search(r"\b([A-Z]\d{2,4}|[A-Z]{1,2}\d{3,4})\b", query, re.I)
    if ("movement" in q or "journey" in q or "schedule" in q) and train_id_match:
        now = datetime.now()
        months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        train_date = f"{now.day:02d} {months[now.month - 1]} {now.year}"
        return await get_train_movements(train_id_match.group(1).upper(), train_date)

    if any(kw in q for kw in ("all station", "list station", "every station")):
        return await get_all_stations()

    if any(kw in q for kw in ("current", "running", "active", "now")):
        t = "D" if "dart" in q else "M" if "mainline" in q else "S" if "suburban" in q else "A"
        return await get_current_trains(t)

    code = find_station_code(query)
    if code:
        mins_match = re.search(r"(\d+)\s*min", query, re.I)
        mins = int(mins_match.group(1)) if mins_match else 90
        return await get_station_trains(code, mins)

    return await get_current_trains("A")


# ─── MCP Tool Definitions ───────────────────────────────────────────────────

TOOLS = [
    {
        "name": "query",
        "description": "Natural language query for Irish Rail data. Ask about trains at a station, current trains, all stations, or train movements.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": 'e.g. "trains at Dublin Connolly", "current DART trains", "all stations", "movements for E123"'},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_all_stations",
        "description": "Get all 145+ Irish Rail stations with their codes, names and GPS coordinates.",
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_station_trains",
        "description": "Get real-time arrivals and departures for an Irish Rail station.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "station_code": {"type": "string", "description": "Station code e.g. CNLLY (Connolly), HSTON (Heuston), MHIDE (Malahide)"},
                "mins_ahead": {"type": "number", "description": "Minutes ahead to look, 1–90 (default 90)"},
            },
            "required": ["station_code"],
        },
    },
    {
        "name": "get_current_trains",
        "description": "Get all trains currently running on the Irish Rail network with GPS positions and status.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "train_type": {"type": "string", "enum": ["A", "M", "D", "S"], "description": "A=All (default), M=Mainline, D=DART, S=Suburban"},
            },
            "required": [],
        },
    },
    {
        "name": "get_train_movements",
        "description": "Get the full schedule and real-time movement history for a specific train.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "train_id": {"type": "string", "description": "Train code e.g. E123, D400, A910"},
                "train_date": {"type": "string", "description": "Date as DD MMM YYYY e.g. 08 Mar 2026"},
            },
            "required": ["train_id", "train_date"],
        },
    },
]


# ─── Tool Dispatch ──────────────────────────────────────────────────────────

async def call_tool(name: str, args: dict) -> str:
    match name:
        case "query":
            return await natural_language_query(str(args.get("query", "current trains")))
        case "get_all_stations":
            return await get_all_stations()
        case "get_station_trains":
            return await get_station_trains(str(args["station_code"]), int(args.get("mins_ahead", 90)))
        case "get_current_trains":
            return await get_current_trains(str(args.get("train_type", "A")))
        case "get_train_movements":
            return await get_train_movements(str(args["train_id"]), str(args["train_date"]))
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
            "name": "Irish Rail Realtime MCP",
            "version": "1.0.0",
            "description": "Real-time Irish Rail train data via MCP",
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
                "serverInfo": {"name": "Irish Rail Realtime MCP", "version": "1.0.0"},
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
    return {"status": "ok", "service": "Irish Rail Realtime MCP", "version": "1.0.0"}


@app.get("/")
async def root():
    return {
        "service": "Irish Rail Realtime MCP",
        "mcp_endpoint": "/mcp",
        "tools": [{"name": t["name"], "description": t["description"]} for t in TOOLS],
    }
