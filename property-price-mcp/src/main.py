"""
Property Price Register MCP — Python
Search all residential property sale prices in Ireland since 2010
Data source: CivicTech PPR API (priceregister.civictech.ie)
"""

import json
import re

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

BASE = "https://priceregister.civictech.ie/api/v1/residential"
HEADERS = {"User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)"}

COUNTIES = [
    "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway",
    "Kerry", "Kildare", "Kilkenny", "Laois", "Leitrim", "Limerick",
    "Longford", "Louth", "Mayo", "Meath", "Monaghan", "Offaly",
    "Roscommon", "Sligo", "Tipperary", "Waterford", "Westmeath",
    "Wexford", "Wicklow",
]


async def api_get(path: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{BASE}/{path}", params=params or {}, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        return resp.json()


def find_county(query: str) -> str | None:
    q = query.lower()
    for c in COUNTIES:
        if c.lower() in q:
            return c
    return None


def format_price(price: float | int) -> str:
    return f"\u20ac{price:,.0f}"


# ─── Tool Implementations ───────────────────────────────────────────────────

async def search_sales(
    county: str = "",
    min_price: int = 0,
    max_price: int = 0,
    sort: str = "date-desc",
    limit: int = 20,
) -> str:
    params: dict = {"limit": min(limit, 50), "sort": sort}

    data = await api_get("sales", params)
    results = data.get("data", [])
    total = data.get("total_rows", "?")

    # Filter by county if specified
    if county:
        county_lower = county.lower()
        results = [r for r in results if county_lower in r.get("county", "").lower()]

    # Filter by price range
    if min_price > 0:
        results = [r for r in results if r.get("price_in_euros", 0) >= min_price]
    if max_price > 0:
        results = [r for r in results if r.get("price_in_euros", 0) <= max_price]

    if not results:
        return "No sales found matching your criteria."

    lines = [f"Property Sales ({len(results)} results, {total} total in register):", ""]

    for r in results:
        price = format_price(r.get("price_in_euros", 0))
        date = r.get("date_of_sale", "?")
        address = r.get("address", "?")
        county_name = r.get("county", "?")
        eircode = r.get("eircode", "")
        desc = r.get("description_of_property", "")
        vat = " (VAT excl)" if r.get("vat_exclusive") else ""
        not_full = " *not full market price*" if r.get("not_full_market_price") else ""

        lines.append(f"  {price}{vat}{not_full}")
        lines.append(f"    {address}, {county_name}{' ' + eircode if eircode else ''}")
        lines.append(f"    Date: {date} | {desc}")
        lines.append("")

    return "\n".join(lines)


async def get_recent_sales(county: str = "", limit: int = 20) -> str:
    return await search_sales(county=county, sort="date-desc", limit=limit)


async def get_most_expensive(county: str = "", limit: int = 10) -> str:
    return await search_sales(county=county, sort="price-desc", limit=limit)


async def natural_language_query(query: str) -> str:
    q = query.lower()
    county = find_county(query) or ""

    # Price extraction
    price_match = re.search(r"(\d[\d,]*)\s*(?:k|thousand)", q)
    min_price = 0
    max_price = 0
    if price_match:
        val = int(price_match.group(1).replace(",", "")) * 1000
        if "under" in q or "below" in q or "less" in q or "max" in q:
            max_price = val
        elif "over" in q or "above" in q or "more" in q or "min" in q:
            min_price = val

    euro_match = re.search(r"€?([\d,]+)", q)
    if not price_match and euro_match:
        val = int(euro_match.group(1).replace(",", ""))
        if val > 1000:
            if "under" in q or "below" in q or "less" in q:
                max_price = val
            elif "over" in q or "above" in q or "more" in q:
                min_price = val

    if any(kw in q for kw in ("expensive", "highest", "top", "most")):
        return await get_most_expensive(county=county)

    if any(kw in q for kw in ("cheap", "lowest", "bottom", "least")):
        return await search_sales(county=county, sort="price-asc")

    if min_price or max_price:
        return await search_sales(county=county, min_price=min_price, max_price=max_price)

    return await get_recent_sales(county=county)


# ─── MCP Tool Definitions ───────────────────────────────────────────────────

TOOLS = [
    {
        "name": "query",
        "description": "Natural language query for Irish property sales. Ask about recent sales, prices in a county, most expensive, etc.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": 'e.g. "recent sales in Dublin", "most expensive in Cork", "houses under 300k in Galway"'},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_recent_sales",
        "description": "Get the most recent property sales, optionally filtered by county.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "county": {"type": "string", "description": "County name e.g. Dublin, Cork, Galway (optional)"},
                "limit": {"type": "number", "description": "Max results 1–50 (default 20)"},
            },
            "required": [],
        },
    },
    {
        "name": "get_most_expensive",
        "description": "Get the most expensive property sales, optionally filtered by county.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "county": {"type": "string", "description": "County name (optional)"},
                "limit": {"type": "number", "description": "Max results 1–50 (default 10)"},
            },
            "required": [],
        },
    },
    {
        "name": "search_sales",
        "description": "Search property sales with filters for county, price range, and sorting.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "county": {"type": "string", "description": "County name (optional)"},
                "min_price": {"type": "number", "description": "Minimum price in euros (optional)"},
                "max_price": {"type": "number", "description": "Maximum price in euros (optional)"},
                "sort": {"type": "string", "enum": ["date-desc", "date-asc", "price-desc", "price-asc"], "description": "Sort order (default date-desc)"},
                "limit": {"type": "number", "description": "Max results 1–50 (default 20)"},
            },
            "required": [],
        },
    },
]


async def call_tool(name: str, args: dict) -> str:
    match name:
        case "query":
            return await natural_language_query(str(args.get("query", "recent sales")))
        case "get_recent_sales":
            return await get_recent_sales(county=str(args.get("county", "")), limit=int(args.get("limit", 20)))
        case "get_most_expensive":
            return await get_most_expensive(county=str(args.get("county", "")), limit=int(args.get("limit", 10)))
        case "search_sales":
            return await search_sales(
                county=str(args.get("county", "")),
                min_price=int(args.get("min_price", 0)),
                max_price=int(args.get("max_price", 0)),
                sort=str(args.get("sort", "date-desc")),
                limit=int(args.get("limit", 20)),
            )
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
            "name": "Property Price Register MCP", "version": "1.0.0",
            "description": "Irish residential property sale prices since 2010",
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
                "serverInfo": {"name": "Property Price Register MCP", "version": "1.0.0"},
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
    return {"status": "ok", "service": "Property Price Register MCP", "version": "1.0.0"}

@app.get("/")
async def root():
    return {"service": "Property Price Register MCP", "mcp_endpoint": "/mcp",
            "tools": [{"name": t["name"], "description": t["description"]} for t in TOOLS]}
