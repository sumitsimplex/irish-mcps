"""
Oireachtas Debates MCP — Python
Full text of Dáil and Seanad debates, bills, acts and member records
Data source: Oireachtas Open Data API (api.oireachtas.ie)
"""

import json
import re

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

BASE = "https://api.oireachtas.ie/v1"
HEADERS = {"User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)"}


async def api_get(path: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{BASE}/{path}", params=params or {}, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        return resp.json()


# ─── Tool Implementations ───────────────────────────────────────────────────

async def search_legislation(query: str = "", bill_status: str = "", limit: int = 10) -> str:
    params: dict = {"limit": min(limit, 50)}
    if query:
        params["bill_no"] = query
    if bill_status:
        params["bill_status"] = bill_status
    data = await api_get("legislation", params)
    results = data.get("results", [])
    total = data.get("head", {}).get("counts", {}).get("billCount", "?")

    if not results:
        return "No legislation found matching your criteria."

    lines = [f"Legislation ({len(results)} of {total} total):", ""]
    for r in results:
        bill = r.get("bill", {})
        title = bill.get("shortTitleEn", "Untitled")
        bill_no = bill.get("billNo", "?")
        year = bill.get("billYear", "?")
        status = bill.get("status", "?")
        source = bill.get("source", "?")
        bill_type = bill.get("billType", "?")
        origin = bill.get("originHouse", {})
        origin_name = origin.get("showAs", "?") if isinstance(origin, dict) else str(origin)
        lines.append(f"  {title} (Bill No. {bill_no}/{year})")
        lines.append(f"    Status: {status} | Type: {bill_type} | Source: {source}")
        lines.append(f"    Origin: {origin_name}")

        sponsors = bill.get("sponsors", [])
        if sponsors:
            sponsor_names = []
            for s in sponsors[:3]:
                sp = s.get("sponsor", {})
                by = sp.get("by", {})
                name = by.get("showAs", "") if isinstance(by, dict) else str(by)
                if name:
                    sponsor_names.append(name)
            if sponsor_names:
                lines.append(f"    Sponsors: {', '.join(sponsor_names)}")

        stage = bill.get("mostRecentStage", {})
        if stage:
            event = stage.get("event", {})
            stage_uri = event.get("showAs", "") if isinstance(event, dict) else ""
            if stage_uri:
                lines.append(f"    Latest stage: {stage_uri}")
        lines.append("")

    return "\n".join(lines)


async def search_members(name: str = "", limit: int = 20) -> str:
    params: dict = {"limit": min(limit, 50)}
    data = await api_get("members", params)
    results = data.get("results", [])
    total = data.get("head", {}).get("counts", {}).get("memberCount", "?")

    if not results:
        return "No members found."

    # Filter by name if provided
    if name:
        name_lower = name.lower()
        results = [r for r in results if name_lower in r.get("member", {}).get("fullName", "").lower()]
        if not results:
            return f'No members found matching "{name}".'

    lines = [f"Oireachtas Members ({len(results)} shown, {total} total):", ""]
    for r in results:
        member = r.get("member", {})
        full_name = member.get("fullName", "?")
        memberships = member.get("memberships", [])

        current_info = []
        for ms in memberships:
            membership = ms.get("membership", {})
            house = membership.get("house", {})
            house_name = house.get("showAs", "") if isinstance(house, dict) else str(house)
            represents = membership.get("represents", [])
            rep_names = []
            for rep in represents:
                r_obj = rep.get("represent", {})
                r_name = r_obj.get("showAs", "") if isinstance(r_obj, dict) else str(r_obj)
                if r_name:
                    rep_names.append(r_name)
            parties = membership.get("parties", [])
            party_names = []
            for p in parties:
                p_obj = p.get("party", {})
                p_name = p_obj.get("showAs", "") if isinstance(p_obj, dict) else str(p_obj)
                if p_name:
                    party_names.append(p_name)
            date_range = membership.get("dateRange", {})
            end = date_range.get("end") if isinstance(date_range, dict) else None
            if not end:
                info_parts = []
                if house_name:
                    info_parts.append(house_name)
                if rep_names:
                    info_parts.append(f"({', '.join(rep_names)})")
                if party_names:
                    info_parts.append(f"- {party_names[-1]}")
                current_info.append(" ".join(info_parts))

        lines.append(f"  {full_name}")
        for info in current_info:
            lines.append(f"    {info}")
        if not current_info:
            lines.append("    (historical member)")
        lines.append("")

    return "\n".join(lines)


async def search_debates(query: str = "", date_start: str = "", date_end: str = "", limit: int = 10) -> str:
    params: dict = {"limit": min(limit, 50)}
    if date_start:
        params["date_start"] = date_start
    if date_end:
        params["date_end"] = date_end
    data = await api_get("debates", params)
    results = data.get("results", [])

    if not results:
        return "No debates found for the given criteria."

    lines = [f"Oireachtas Debates ({len(results)} results):", ""]
    for r in results:
        debate = r.get("debateRecord", r)
        date = debate.get("date", debate.get("contextDate", "?"))
        house = debate.get("house", {})
        house_name = house.get("showAs", str(house)) if isinstance(house, dict) else str(house)
        chamber = debate.get("chamber", {})
        chamber_name = chamber.get("showAs", "") if isinstance(chamber, dict) else str(chamber)
        sections = debate.get("debateSections", [])
        counts = debate.get("counts", {})

        lines.append(f"  {date} — {house_name}{' (' + chamber_name + ')' if chamber_name else ''}")
        if counts:
            lines.append(f"    Speeches: {counts.get('speechCount', '?')} | Contributors: {counts.get('speakerCount', '?')}")

        if sections:
            section_titles = []
            for s in sections[:5]:
                sec = s.get("debateSection", s)
                title = sec.get("showAs", sec.get("title", ""))
                if title:
                    section_titles.append(title)
            if section_titles:
                lines.append(f"    Topics: {'; '.join(section_titles)}")

        formats = debate.get("formats", {})
        if formats:
            pdf = formats.get("pdf", {})
            if pdf and isinstance(pdf, dict):
                pdf_uri = pdf.get("uri", "")
                if pdf_uri:
                    lines.append(f"    PDF: {pdf_uri}")
        lines.append("")

    return "\n".join(lines)


async def natural_language_query(query: str) -> str:
    q = query.lower()

    if any(kw in q for kw in ("member", "td", "senator", "deputy", "minister")):
        # Try to extract a name
        name = ""
        for word in ["member", "td", "senator", "deputy", "minister", "who is", "find", "search"]:
            q_clean = q.replace(word, "").strip()
        # Use the cleaned query as a name search
        name = query
        for word in ["member", "TD", "Senator", "Deputy", "Minister", "who is", "find", "search", "?", "the"]:
            name = name.replace(word, "").replace(word.lower(), "").strip()
        return await search_members(name=name if name else "")

    if any(kw in q for kw in ("debate", "speech", "dáil", "dail", "seanad", "sitting", "session")):
        return await search_debates(query=query)

    if any(kw in q for kw in ("bill", "legislation", "act", "law", "passed", "enacted")):
        return await search_legislation(query=query)

    # Default: recent legislation
    return await search_legislation(limit=10)


# ─── MCP Tool Definitions ───────────────────────────────────────────────────

TOOLS = [
    {
        "name": "query",
        "description": "Natural language query for Oireachtas data. Ask about legislation, members, or debates.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": 'e.g. "recent bills", "who is the TD for Dublin Bay South", "Dáil debates this week"'},
            },
            "required": ["query"],
        },
    },
    {
        "name": "search_legislation",
        "description": "Search bills and acts in the Oireachtas. Filter by bill number or status.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Bill number or search term"},
                "bill_status": {"type": "string", "description": "Filter by status e.g. Current, Enacted, Rejected, Withdrawn, Lapsed"},
                "limit": {"type": "number", "description": "Max results 1–50 (default 10)"},
            },
            "required": [],
        },
    },
    {
        "name": "search_members",
        "description": "Search Oireachtas members (TDs and Senators) by name.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Member name to search for"},
                "limit": {"type": "number", "description": "Max results 1–50 (default 20)"},
            },
            "required": [],
        },
    },
    {
        "name": "search_debates",
        "description": "Search Dáil and Seanad debate records by date range.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "date_start": {"type": "string", "description": "Start date YYYY-MM-DD"},
                "date_end": {"type": "string", "description": "End date YYYY-MM-DD"},
                "limit": {"type": "number", "description": "Max results 1–50 (default 10)"},
            },
            "required": [],
        },
    },
]


async def call_tool(name: str, args: dict) -> str:
    match name:
        case "query":
            return await natural_language_query(str(args.get("query", "recent legislation")))
        case "search_legislation":
            return await search_legislation(
                query=str(args.get("query", "")),
                bill_status=str(args.get("bill_status", "")),
                limit=int(args.get("limit", 10)),
            )
        case "search_members":
            return await search_members(name=str(args.get("name", "")), limit=int(args.get("limit", 20)))
        case "search_debates":
            return await search_debates(
                date_start=str(args.get("date_start", "")),
                date_end=str(args.get("date_end", "")),
                limit=int(args.get("limit", 10)),
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
            "name": "Oireachtas Debates MCP", "version": "1.0.0",
            "description": "Dáil and Seanad debates, bills, acts and member records",
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
                "serverInfo": {"name": "Oireachtas Debates MCP", "version": "1.0.0"},
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
    return {"status": "ok", "service": "Oireachtas Debates MCP", "version": "1.0.0"}

@app.get("/")
async def root():
    return {"service": "Oireachtas Debates MCP", "mcp_endpoint": "/mcp",
            "tools": [{"name": t["name"], "description": t["description"]} for t in TOOLS]}
