/**
 * Luas Realtime MCP — Cloudflare Worker
 * Implements MCP Streamable HTTP (JSON-RPC over POST)
 * Data source: Luas Forecasts API (luasforecasts.rpa.ie)
 */

const LUAS_API = "https://luasforecasts.rpa.ie/xml/get.ashx";

// ─── XML Parser ───────────────────────────────────────────────────────────────

function parseAttr(xml: string, attr: string): string {
  const m = new RegExp(`${attr}="([^"]*)"`, "i").exec(xml);
  return m ? m[1].trim() : "";
}

function parseObjects(xml: string, tag: string, fields: string[]): Record<string, string>[] {
  const results: Record<string, string>[] = [];
  const re = new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "g");
  let m;
  while ((m = re.exec(xml)) !== null) {
    const obj: Record<string, string> = {};
    const attrs = m[1];
    const inner = m[2];
    for (const f of fields) {
      // Try as attribute first, then as child element
      const attrVal = parseAttr(attrs, f);
      if (attrVal) { obj[f] = attrVal; continue; }
      const fr = new RegExp(`<${f}[^>]*>([\\s\\S]*?)<\\/${f}>`);
      const fm = fr.exec(inner);
      obj[f] = fm ? fm[1].trim() : "";
    }
    results.push(obj);
  }
  return results;
}

function parseSelfClosing(xml: string, tag: string, fields: string[]): Record<string, string>[] {
  const results: Record<string, string>[] = [];
  const re = new RegExp(`<${tag}([^/]*)/?>`, "g");
  let m;
  while ((m = re.exec(xml)) !== null) {
    const obj: Record<string, string> = {};
    for (const f of fields) obj[f] = parseAttr(m[1], f);
    results.push(obj);
  }
  return results;
}

// ─── Luas API ─────────────────────────────────────────────────────────────────

async function luasGet(params: Record<string, string>): Promise<string> {
  const url = new URL(LUAS_API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)" },
  });
  if (!res.ok) throw new Error(`Luas API error: ${res.status}`);
  return res.text();
}

// ─── Stop Name → Abbreviation Lookup ──────────────────────────────────────────

const STOP_CODES: Record<string, string> = {
  // Red Line — Tallaght branch
  "tallaght": "TAL",
  "fettercairn": "FET",
  "cheeverstown": "CVN",
  "citywest": "CIT",
  "fortunestown": "FOR",
  "bridgewater": "BRI",
  "belgard": "BEL",
  "kingswood": "KIN",
  // Red Line — Saggart branch
  "saggart": "SAG",
  // Red Line — City
  "heuston": "HEU",
  "museum": "MUS",
  "james's": "JAM", "james": "JAM", "st james": "JAM",
  "fatima": "FAT",
  "rialto": "RIA",
  "suir road": "SUI", "suir": "SUI",
  "goldenbridge": "GOL",
  "drimnagh": "DRI",
  "bluebell": "BLU",
  "kylemore": "KYL",
  "red cow": "RED",
  "bambury's corner": "BAM", "bambury": "BAM",
  "cookstown": "COO",
  // Red Line — Docklands
  "jervis": "JER",
  "abbey street": "ABB", "abbey": "ABB",
  "busaras": "BUS",
  "connolly": "CON",
  "mayor square": "MAY", "mayor": "MAY",
  "george's dock": "GDK", "georges dock": "GDK",
  "spencer dock": "SDK",
  "the point": "TPT", "point": "TPT",
  // Green Line — South
  "st stephen's green": "STS", "stephens green": "STS", "stephen's green": "STS",
  "broombridge": "BRO",
  "cabra": "CAB",
  "phibsborough": "PHI",
  "grangegorman": "GRA",
  "broadstone": "BDS",
  "dominick": "DOM",
  "parnell": "PAR",
  "o'connell - gpo": "OCP", "o'connell": "OCP", "gpo": "OCP",
  "o'connell upper": "OCU",
  "marlborough": "MAR",
  "westmoreland": "WES",
  "trinity": "TRY", "trinity college": "TRY",
  "dawson": "DAW",
  "st stephen's green south": "STG",
  "harcourt": "HAR",
  "charlemont": "CHA",
  "ranelagh": "RAN",
  "beechwood": "BEE",
  "cowper": "COW",
  "milltown": "MIL",
  "windy arbour": "WIN",
  "dundrum": "DUN",
  "balally": "BAL",
  "kilmacud": "KIL",
  "stillorgan": "STI",
  "sandyford": "SAN",
  "central park": "CPK",
  "glencairn": "GLC",
  "the gallops": "GAL",
  "leopardstown valley": "LPV", "leopardstown": "LPV",
  "ballyogan wood": "BAW",
  "carrickmines": "CAR",
  "laughanstown": "LAU",
  "cherrywood": "CHE",
  "brides glen": "BRG",
};

function findStopCode(query: string): string | null {
  const q = query.toLowerCase();
  for (const [name, code] of Object.entries(STOP_CODES)) {
    if (q.includes(name)) return code;
  }
  // Raw abbreviation (e.g. STS, TAL)
  const raw = query.match(/\b([A-Z]{2,4})\b/);
  if (raw) return raw[1];
  return null;
}

// ─── Tool Implementations ─────────────────────────────────────────────────────

async function getAllStops(): Promise<string> {
  const xml = await luasGet({ action: "stops", encrypt: "false" });

  // Parse Red and Green line stops separately
  const redMatch = /<line id="red"[^>]*>([\s\S]*?)<\/line>/i.exec(xml);
  const greenMatch = /<line id="green"[^>]*>([\s\S]*?)<\/line>/i.exec(xml);

  function parseStops(block: string) {
    return parseSelfClosing(block, "stop", ["abv", "isParkRide", "isCycleRide", "lat", "long", "pronunciation"]).map((s, i) => {
      // extract text content from the original stop tag
      const re = new RegExp(`<stop[^>]*abv="${s.abv}"[^>]*>([^<]*)<\/stop>`);
      const m = re.exec(block);
      return { ...s, name: m ? m[1].trim() : s.pronunciation };
    });
  }

  const red = redMatch ? parseStops(redMatch[1]) : [];
  const green = greenMatch ? parseStops(greenMatch[1]) : [];

  return `Luas stops (${red.length} Red Line, ${green.length} Green Line):\n\n` +
    `RED LINE (${red.length} stops):\n` + JSON.stringify(red, null, 2) +
    `\n\nGREEN LINE (${green.length} stops):\n` + JSON.stringify(green, null, 2);
}

async function getStopForecast(stopAbbr: string): Promise<string> {
  const xml = await luasGet({ action: "forecast", stop: stopAbbr.toUpperCase(), encrypt: "false" });

  const stopName = parseAttr(xml, "stop") || stopAbbr;
  const message = parseAttr(xml, "message");
  const created = parseAttr(xml, "created");

  // Parse directions
  const dirRe = /<direction name="([^"]+)">([\s\S]*?)<\/direction>/g;
  let m;
  const directions: { name: string; trams: { dueMins: string; destination: string }[] }[] = [];

  while ((m = dirRe.exec(xml)) !== null) {
    const dirName = m[1];
    const tramRe = /<tram dueMins="([^"]+)" destination="([^"]+)"/g;
    let t;
    const trams: { dueMins: string; destination: string }[] = [];
    while ((t = tramRe.exec(m[2])) !== null) {
      trams.push({ dueMins: t[1], destination: t[2] });
    }
    directions.push({ name: dirName, trams });
  }

  if (!directions.length) {
    return `No forecast data for stop ${stopAbbr}. Check the stop abbreviation (use get_all_stops to find it).`;
  }

  const lines: string[] = [`Stop: ${stopName} (${stopAbbr.toUpperCase()})`, `Updated: ${created}`];
  if (message) lines.push(`Service message: ${message}`);
  lines.push("");

  for (const dir of directions) {
    lines.push(`→ ${dir.name}:`);
    if (!dir.trams.length) {
      lines.push("  No trams scheduled.");
    } else {
      for (const tram of dir.trams) {
        const due = tram.dueMins === "DUE" ? "Due now" : `${tram.dueMins} min`;
        lines.push(`  ${due} → ${tram.destination}`);
      }
    }
  }

  return lines.join("\n");
}

async function naturalLanguageQuery(query: string): Promise<string> {
  const q = query.toLowerCase();

  if (q.includes("all stop") || q.includes("list stop") || q.includes("every stop") || q.includes("stations")) {
    return getAllStops();
  }

  const code = findStopCode(query);
  if (code) return getStopForecast(code);

  // Default: show a popular stop
  return getStopForecast("STS");
}

// ─── MCP Tool Definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "query",
    description: "Natural language query for Luas tram data. Ask about next trams at a stop or list all stops.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'e.g. "next trams at Heuston", "trams at St Stephen\'s Green", "all stops", "Dundrum trams"',
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_stop_forecast",
    description: "Get next tram arrival times for a Luas stop on the Red or Green line.",
    inputSchema: {
      type: "object",
      properties: {
        stop: {
          type: "string",
          description: "Stop abbreviation e.g. STS (St Stephen's Green), HEU (Heuston), DUN (Dundrum), TAL (Tallaght), BRG (Brides Glen)",
        },
      },
      required: ["stop"],
    },
  },
  {
    name: "get_all_stops",
    description: "List all Luas stops on the Red and Green lines with their abbreviations, GPS coordinates and park-and-ride info.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

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

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "query":
      return naturalLanguageQuery(String(args.query ?? "next trams at St Stephen's Green"));
    case "get_stop_forecast":
      return getStopForecast(String(args.stop));
    case "get_all_stops":
      return getAllStops();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMCP(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  if (req.method === "GET") {
    return json({
      name: "Luas Realtime MCP",
      version: "1.0.0",
      description: "Live Luas tram times for Red and Green lines",
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
        serverInfo: { name: "Luas Realtime MCP", version: "1.0.0" },
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
      return json({ status: "ok", service: "Luas Realtime MCP", version: "1.0.0" });
    }

    if (pathname === "/" || pathname === "") {
      return json({
        service: "Luas Realtime MCP",
        mcp_endpoint: "/mcp",
        tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
      });
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
