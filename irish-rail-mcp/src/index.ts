/**
 * Irish Rail Realtime MCP — Cloudflare Worker
 * Implements MCP Streamable HTTP (JSON-RPC over POST)
 * No Durable Objects required — works on free tier
 */

const RAIL = "http://api.irishrail.ie/realtime/realtime.asmx";

// ─── XML Parser ──────────────────────────────────────────────────────────────

function parseObjects(xml: string, tag: string, fields: string[]): Record<string, string>[] {
  const results: Record<string, string>[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  let m;
  while ((m = re.exec(xml)) !== null) {
    const obj: Record<string, string> = {};
    const inner = m[1];
    for (const f of fields) {
      const fr = new RegExp(`<${f}[^>]*>([\\s\\S]*?)<\\/${f}>`);
      const fm = fr.exec(inner);
      obj[f] = fm ? fm[1].trim() : "";
    }
    results.push(obj);
  }
  return results;
}

// ─── Irish Rail API ───────────────────────────────────────────────────────────

async function railGet(path: string, params: Record<string, string> = {}): Promise<string> {
  const url = new URL(`${RAIL}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)" },
  });
  if (!res.ok) throw new Error(`Irish Rail API error: ${res.status}`);
  return res.text();
}

// Static metadata for key stations — used when real-time returns no trains
// (mainline stops can have 60–120 min gaps between services)
const STATION_INFO: Record<string, { type: string; line: string; keyRoutes: string[] }> = {
  "MONVN": {
    type: "Mainline",
    line: "Dublin Heuston–Portlaoise–Limerick/Cork intercity",
    keyRoutes: [
      "Dublin Heuston (~45 min, direct)",
      "Portarlington (~10 min)",
      "Portlaoise (~20 min)",
      "Limerick (~1h 35 min)",
      "Cork (~2h 20 min)",
    ],
  },
  "KDARE": {
    type: "Mainline",
    line: "Dublin Heuston–Limerick/Cork intercity",
    keyRoutes: ["Dublin Heuston (~35 min)", "Newbridge (~7 min)", "Monasterevin (~15 min)", "Portlaoise (~35 min)"],
  },
  "NBRGE": {
    type: "Mainline",
    line: "Dublin Heuston–Limerick/Cork intercity",
    keyRoutes: ["Dublin Heuston (~40 min)", "Kildare (~7 min)", "Monasterevin (~15 min)"],
  },
  "PTRTN": {
    type: "Mainline",
    line: "Dublin Heuston–Portlaoise–Galway/Westport intercity",
    keyRoutes: ["Dublin Heuston (~1h 10 min)", "Monasterevin (~15 min)", "Portlaoise (~25 min)", "Galway (~2h)"],
  },
  "PTLSE": {
    type: "Mainline",
    line: "Dublin Heuston–Portlaoise–Cork/Limerick/Galway intercity",
    keyRoutes: ["Dublin Heuston (~1h 10 min)", "Monasterevin (~20 min)", "Kildare (~35 min)"],
  },
  "SALNS": {
    type: "Commuter",
    line: "Dublin Heuston–Kildare commuter (Naas served by Sallins station)",
    keyRoutes: ["Dublin Heuston (~35 min)", "Hazelhatch (~15 min)", "Kildare (~10 min)"],
  },
  "CNLLY": { type: "Intercity/DART/Suburban hub", line: "All northern/eastern routes", keyRoutes: ["Belfast (~2h)", "Drogheda (~35 min)", "Dundalk (~1h)", "DART northside"] },
  "HSTON": { type: "Intercity hub", line: "All western/southern routes", keyRoutes: ["Cork (~2h 30 min)", "Limerick (~2h)", "Galway (~2h 10 min)", "Monasterevin (~45 min)", "Kildare (~35 min)"] },
};

// Station name → code lookup (most common stations)
const STATION_CODES: Record<string, string> = {
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
  "monasterevin": "MONVN",
};

function findStationCode(query: string): string | null {
  const q = query.toLowerCase();
  for (const [name, code] of Object.entries(STATION_CODES)) {
    if (q.includes(name)) return code;
  }
  // Try to detect a raw 5-letter station code like CNLLY, MHIDE
  const codeMatch = query.match(/\b([A-Z]{3,6})\b/);
  if (codeMatch) return codeMatch[1];
  return null;
}

// Returns true if `phrase` appears as a whole word/phrase within `text`
function containsWholePhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z])${escaped}(?![a-z])`, "i").test(text);
}

async function lookupStationCode(query: string): Promise<string | null> {
  // First try the fast hardcoded lookup
  const code = findStationCode(query);
  if (code) return code;

  // Fall back to a live API search so any valid station name works
  try {
    const xml = await railGet("getAllStationsXML");
    const stations = parseObjects(xml, "objStation", ["StationCode", "StationDesc", "StationAlias"]);
    for (const s of stations) {
      if (
        containsWholePhrase(query, s.StationDesc) ||
        (s.StationAlias && containsWholePhrase(query, s.StationAlias))
      ) {
        return s.StationCode;
      }
    }
  } catch (e) {
    console.error("Station lookup API error:", e instanceof Error ? e.message : e);
  }
  return null;
}

// ─── Tool Implementations ─────────────────────────────────────────────────────

async function getAllStations(): Promise<string> {
  const xml = await railGet("getAllStationsXML");
  const stations = parseObjects(xml, "objStation", [
    "StationCode", "StationDesc", "StationAlias", "StationLatitude", "StationLongitude",
  ]);
  const lines = [`Found ${stations.length} Irish Rail stations:`, ""];
  for (const s of stations) {
    const alias = s.StationAlias ? ` (${s.StationAlias})` : "";
    lines.push(`  ${s.StationDesc}${alias} — code: ${s.StationCode}`);
  }
  return lines.join("\n");
}

async function getStationTrains(stationCode: string, minsAhead = 90): Promise<string> {
  const code = stationCode.toUpperCase();
  const xml = await railGet("getStationDataByCodeXML", {
    StationCode: code,
    NumMins: String(Math.min(minsAhead, 90)),
  });
  const trains = parseObjects(xml, "objStationData", [
    "Stationfullname", "Servertime", "Traincode", "Origin", "Destination",
    "Origintime", "Destinationtime", "Status", "Lastlocation",
    "Duein", "Late", "Exparrival", "Expdepart", "Scharrival", "Schdepart",
    "Direction", "Traintype", "Locationtype",
  ]);

  const meta = STATION_INFO[code];
  const metaLines: string[] = meta
    ? [
        `Station ${code} — ${meta.type} on the ${meta.line}`,
        `Typical routes: ${meta.keyRoutes.join(" | ")}`,
        "",
      ]
    : [];

  if (!trains.length) {
    const note = `No trains scheduled at ${code} in the next ${minsAhead} minutes (mainline services run every 60–120 min; check outside this window).`;
    return metaLines.length ? [...metaLines, note].join("\n") : note;
  }
  const stationName = trains[0]?.Stationfullname || code;
  const lines = [...metaLines, `${trains.length} train(s) at ${stationName} in the next ${minsAhead} mins:`, ""];
  for (const t of trains) {
    const late = parseInt(t.Late) > 0 ? ` (${t.Late} min late)` : "";
    const type = t.Traintype === "DART" ? "DART" : t.Traintype === "Train" ? "Mainline" : t.Traintype;
    lines.push(`  ${t.Origin} → ${t.Destination} [${type}]`);
    lines.push(`    Due in ${t.Duein} min | Status: ${t.Status}${late}`);
    lines.push(`    Exp arr: ${t.Exparrival} | Exp dep: ${t.Expdepart} | ${t.Direction}`);
    if (t.Lastlocation) lines.push(`    Last: ${t.Lastlocation}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function getCurrentTrains(trainType = "A"): Promise<string> {
  const xml = await railGet("getCurrentTrainsXML", { TrainType: trainType });
  const trains = parseObjects(xml, "objTrainPositions", [
    "TrainStatus", "TrainLatitude", "TrainLongitude", "TrainCode", "TrainDate",
    "PublicMessage", "Direction",
  ]);
  const withCode = trains.map(t => ({
    ...t,
    TrainCode: t.TrainCode || t["Code"] || "",
  }));
  const typeLabel = trainType === "D" ? "DART" : trainType === "M" ? "Mainline" : trainType === "S" ? "Suburban" : "All";
  const lines = [`${withCode.length} ${typeLabel} trains currently running:`, ""];
  for (const t of withCode.slice(0, 25)) {
    const msg = t.PublicMessage?.replace(/\\n/g, " ").trim() || "";
    lines.push(`  ${t.TrainCode} — ${t.TrainStatus} | ${t.Direction}`);
    if (msg) lines.push(`    ${msg}`);
    lines.push("");
  }
  if (withCode.length > 25) {
    lines.push(`  ... and ${withCode.length - 25} more trains`);
  }
  return lines.join("\n");
}

async function getTrainMovements(trainId: string, trainDate: string): Promise<string> {
  const xml = await railGet("getTrainMovementsXML", {
    TrainId: trainId.toUpperCase(),
    TrainDate: trainDate,
  });
  const movements = parseObjects(xml, "objTrainMovements", [
    "TrainCode", "TrainDate", "LocationCode", "LocationFullName", "LocationOrder",
    "LocationType", "TrainOrigin", "TrainDestination",
    "ScheduledArrival", "ScheduledDeparture",
    "ExpectedArrival", "ExpectedDeparture",
    "Arrival", "Departure", "StopType",
  ]);
  if (!movements.length) {
    return `No movements found for train ${trainId} on ${trainDate}. Check the train code and date format (e.g. "08 Mar 2026").`;
  }
  const info = movements[0];
  const lines = [`Train ${trainId} — ${info?.TrainOrigin} → ${info?.TrainDestination} (${trainDate}):`, ""];
  for (const m of movements) {
    const stopType = m.StopType === "S" ? "Stop" : m.StopType === "O" ? "Origin" : m.StopType === "D" ? "Destination" : m.StopType;
    const arr = m.Arrival || m.ExpectedArrival || m.ScheduledArrival || "-";
    const dep = m.Departure || m.ExpectedDeparture || m.ScheduledDeparture || "-";
    lines.push(`  ${m.LocationFullName} (${stopType})`);
    lines.push(`    Arr: ${arr} | Dep: ${dep}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function naturalLanguageQuery(query: string): Promise<string> {
  const q = query.toLowerCase();

  // Route: train movements (e.g. "movements for E123" or "train E123")
  const trainIdMatch = query.match(/\b([A-Z]\d{2,4}|[A-Z]{1,2}\d{3,4})\b/i);
  if ((q.includes("movement") || q.includes("journey") || q.includes("schedule")) && trainIdMatch) {
    const today = new Date();
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const trainDate = `${String(today.getDate()).padStart(2,"0")} ${months[today.getMonth()]} ${today.getFullYear()}`;
    return getTrainMovements(trainIdMatch[1].toUpperCase(), trainDate);
  }

  // Route: all stations
  if (q.includes("all station") || q.includes("list station") || q.includes("every station")) {
    return getAllStations();
  }

  // Route: current trains / what's running
  if (q.includes("current") || q.includes("running") || q.includes("active") || q.includes("now")) {
    const type = q.includes("dart") ? "D" : q.includes("mainline") ? "M" : q.includes("suburban") ? "S" : "A";
    return getCurrentTrains(type);
  }

  // Route: station lookup by name or code
  const code = await lookupStationCode(query);
  if (code) {
    const minsMatch = query.match(/(\d+)\s*min/i);
    const mins = minsMatch ? parseInt(minsMatch[1]) : 90;
    return getStationTrains(code, mins);
  }

  // Default: show current trains as a good demo
  return getCurrentTrains("A");
}

// ─── MCP Tool Definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "query",
    description: "Natural language query for Irish Rail data. Ask about trains at a station, current trains, all stations, or train movements. Monasterevin has its own station (MONVN) with direct Dublin Heuston mainline services.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'e.g. "trains at Dublin Connolly", "trains at Monasterevin", "current DART trains", "all stations", "movements for E123"' },
      },
      required: ["query"],
    },
  },
  {
    name: "get_all_stations",
    description: "Get all 145+ Irish Rail stations with their codes, names and GPS coordinates.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_station_trains",
    description: "Get real-time arrivals and departures for an Irish Rail station.",
    inputSchema: {
      type: "object",
      properties: {
        station_code: { type: "string", description: "Station code e.g. CNLLY (Connolly), HSTON (Heuston), MHIDE (Malahide), MONVN (Monasterevin)" },
        mins_ahead: { type: "number", description: "Minutes ahead to look, 1–90 (default 90)" },
      },
      required: ["station_code"],
    },
  },
  {
    name: "get_current_trains",
    description: "Get all trains currently running on the Irish Rail network with GPS positions and status.",
    inputSchema: {
      type: "object",
      properties: {
        train_type: {
          type: "string",
          enum: ["A", "M", "D", "S"],
          description: "A=All (default), M=Mainline, D=DART, S=Suburban",
        },
      },
      required: [],
    },
  },
  {
    name: "get_train_movements",
    description: "Get the full schedule and real-time movement history for a specific train.",
    inputSchema: {
      type: "object",
      properties: {
        train_id: { type: "string", description: "Train code e.g. E123, D400, A910" },
        train_date: { type: "string", description: "Date as DD MMM YYYY e.g. 08 Mar 2026" },
      },
      required: ["train_id", "train_date"],
    },
  },
];

// ─── Tool Dispatch ────────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "query":
      return naturalLanguageQuery(String(args.query ?? "current trains"));
    case "get_all_stations":
      return getAllStations();
    case "get_station_trains":
      return getStationTrains(String(args.station_code), Number(args.mins_ahead ?? 90));
    case "get_current_trains":
      return getCurrentTrains(String(args.train_type ?? "A"));
    case "get_train_movements":
      return getTrainMovements(String(args.train_id), String(args.train_date));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP JSON-RPC Handler ─────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function handleMCP(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  if (req.method === "GET") {
    return json({
      name: "Irish Rail Realtime MCP",
      version: "1.0.0",
      description: "Real-time Irish Rail train data via MCP",
      tools: TOOLS.map(t => t.name),
    });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

  let body: { jsonrpc?: string; method?: string; params?: unknown; id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, 400);
  }

  const id = body.id ?? null;
  const ok = (result: unknown) => json({ jsonrpc: "2.0", result, id });
  const err = (code: number, msg: string) => json({ jsonrpc: "2.0", error: { code, message: msg }, id });

  switch (body.method) {
    case "initialize":
      return ok({
        protocolVersion: "2024-11-05",
        serverInfo: { name: "Irish Rail Realtime MCP", version: "1.0.0" },
        capabilities: { tools: {} },
      });

    case "notifications/initialized":
      return new Response(null, { status: 204, headers: CORS });

    case "ping":
      return ok({});

    case "tools/list":
      return ok({ tools: TOOLS });

    case "tools/call": {
      const p = body.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (!p?.name) return err(-32602, "Missing tool name");
      try {
        const text = await callTool(p.name, p.arguments ?? {});
        return ok({ content: [{ type: "text", text }] });
      } catch (e) {
        return err(-32000, e instanceof Error ? e.message : "Tool failed");
      }
    }

    default:
      return err(-32601, `Method not found: ${body.method}`);
  }
}

// ─── Worker Entry Point ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/mcp" || pathname === "/mcp/") return handleMCP(request);

    if (pathname === "/health") {
      return json({ status: "ok", service: "Irish Rail Realtime MCP", version: "1.0.0" });
    }

    if (pathname === "/" || pathname === "") {
      return json({
        service: "Irish Rail Realtime MCP",
        mcp_endpoint: "/mcp",
        tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
      });
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
