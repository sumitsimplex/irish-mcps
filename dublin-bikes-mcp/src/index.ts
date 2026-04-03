/**
 * Dublin Bikes MCP — Cloudflare Worker
 * Implements MCP Streamable HTTP (JSON-RPC over POST)
 * Real-time station availability and bike counts for the Dublin Bikes scheme
 * Data source: Cyclocity GBFS (api.cyclocity.fr)
 */

const STATUS_URL = "https://api.cyclocity.fr/contracts/dublin/gbfs/station_status.json";
const INFO_URL = "https://api.cyclocity.fr/contracts/dublin/gbfs/station_information.json";
const HEADERS = { "User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)" };

// --- Data Fetching & Merging ------------------------------------------------

interface StationInfo {
  station_id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  capacity: number;
}

interface VehicleType {
  vehicle_type_id: string;
  count: number;
}

interface StationStatus {
  station_id: string;
  num_bikes_available: number;
  num_docks_available: number;
  is_renting: boolean;
  is_returning: boolean;
  vehicle_types_available?: VehicleType[];
}

interface MergedStation {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  capacity: number;
  bikes_available: number;
  mechanical_bikes: number;
  electric_bikes: number;
  docks_available: number;
  is_renting: boolean;
  is_returning: boolean;
  distance_km?: number;
}

async function fetchStations(): Promise<{ info: StationInfo[]; status: StationStatus[] }> {
  const [infoRes, statusRes] = await Promise.all([
    fetch(INFO_URL, { headers: HEADERS }),
    fetch(STATUS_URL, { headers: HEADERS }),
  ]);
  if (!infoRes.ok) throw new Error(`Station info API error: ${infoRes.status}`);
  if (!statusRes.ok) throw new Error(`Station status API error: ${statusRes.status}`);
  const infoJson = (await infoRes.json()) as { data: { stations: StationInfo[] } };
  const statusJson = (await statusRes.json()) as { data: { stations: StationStatus[] } };
  return { info: infoJson.data.stations, status: statusJson.data.stations };
}

function mergeStations(info: StationInfo[], status: StationStatus[]): MergedStation[] {
  const statusMap = new Map<string, StationStatus>();
  for (const s of status) statusMap.set(s.station_id, s);

  const merged: MergedStation[] = [];
  for (const i of info) {
    const s = statusMap.get(i.station_id) || ({} as Partial<StationStatus>);
    const vehicleTypes = (s as StationStatus).vehicle_types_available || [];
    let mechanical = 0;
    let electrical = 0;
    for (const vt of vehicleTypes) {
      if (vt.vehicle_type_id === "mechanical") mechanical = vt.count || 0;
      else if (vt.vehicle_type_id === "electrical") electrical = vt.count || 0;
    }
    merged.push({
      id: i.station_id,
      name: i.name || "",
      address: i.address || "",
      lat: i.lat,
      lon: i.lon,
      capacity: i.capacity || 0,
      bikes_available: (s as StationStatus).num_bikes_available || 0,
      mechanical_bikes: mechanical,
      electric_bikes: electrical,
      docks_available: (s as StationStatus).num_docks_available || 0,
      is_renting: (s as StationStatus).is_renting ?? false,
      is_returning: (s as StationStatus).is_returning ?? false,
    });
  }
  return merged;
}

// --- Haversine Distance -----------------------------------------------------

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dlat = (lat2 - lat1) * Math.PI / 180;
  const dlon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dlon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// --- Known Locations --------------------------------------------------------

const KNOWN_LOCATIONS: Record<string, [number, number]> = {
  "trinity": [53.3438, -6.2546],
  "trinity college": [53.3438, -6.2546],
  "st stephen's green": [53.3382, -6.2591],
  "stephens green": [53.3382, -6.2591],
  "grafton": [53.3414, -6.2595],
  "temple bar": [53.3455, -6.2643],
  "o'connell": [53.3498, -6.2603],
  "connolly": [53.3509, -6.2500],
  "heuston": [53.3464, -6.2924],
  "smithfield": [53.3474, -6.2780],
  "merrion square": [53.3395, -6.2482],
  "grand canal": [53.3389, -6.2387],
  "portobello": [53.3319, -6.2645],
  "rathmines": [53.3222, -6.2644],
  "phibsborough": [53.3594, -6.2675],
};

function findLocation(query: string): [number, number] | null {
  const q = query.toLowerCase();
  for (const [name, coords] of Object.entries(KNOWN_LOCATIONS)) {
    if (q.includes(name)) return coords;
  }
  return null;
}

// --- Tool Implementations ---------------------------------------------------

async function getAllStations(): Promise<string> {
  const { info, status } = await fetchStations();
  const stations = mergeStations(info, status);
  const totalBikes = stations.reduce((sum, s) => sum + s.bikes_available, 0);
  const totalDocks = stations.reduce((sum, s) => sum + s.docks_available, 0);
  const totalCapacity = stations.reduce((sum, s) => sum + s.capacity, 0);

  const sorted = stations.sort((a, b) => a.name.localeCompare(b.name));
  const lines = [
    `Dublin Bikes — ${stations.length} stations`,
    `Total bikes available: ${totalBikes} | Empty docks: ${totalDocks} | Capacity: ${totalCapacity}`,
    "",
  ];
  for (const s of sorted) {
    const icon = s.is_renting ? "OPEN" : "CLOSED";
    lines.push(
      `  [${icon}] ${s.name}: ${s.bikes_available} bikes (${s.mechanical_bikes}M/${s.electric_bikes}E) | ${s.docks_available} docks free`
    );
  }
  return lines.join("\n");
}

async function getStation(stationName: string): Promise<string> {
  const { info, status } = await fetchStations();
  const stations = mergeStations(info, status);

  const nameLower = stationName.toLowerCase();
  let matches = stations.filter(
    (s) => s.name.toLowerCase().includes(nameLower) || s.address.toLowerCase().includes(nameLower)
  );

  if (!matches.length) {
    const words = nameLower.split(/\s+/);
    matches = stations.filter((s) => words.some((w) => s.name.toLowerCase().includes(w)));
  }

  if (!matches.length) {
    return `No station found matching "${stationName}". Use get_all_stations to see the full list.`;
  }

  const lines: string[] = [];
  for (const s of matches.slice(0, 5)) {
    const statusLabel = s.is_renting ? "OPEN" : "CLOSED";
    lines.push(
      `${s.name} (${statusLabel})`,
      `  Address: ${s.address}`,
      `  Bikes available: ${s.bikes_available} (${s.mechanical_bikes} mechanical, ${s.electric_bikes} electric)`,
      `  Docks available: ${s.docks_available} of ${s.capacity}`,
      `  Location: ${s.lat}, ${s.lon}`,
      `  Returning: ${s.is_returning ? "Yes" : "No"}`,
      ""
    );
  }
  return lines.join("\n");
}

async function findNearest(lat: number, lon: number, limit = 5): Promise<string> {
  const { info, status } = await fetchStations();
  const stations = mergeStations(info, status);

  for (const s of stations) {
    s.distance_km = haversine(lat, lon, s.lat, s.lon);
  }

  const clamped = Math.max(1, Math.min(limit, 20));
  const nearby = stations.sort((a, b) => (a.distance_km || 0) - (b.distance_km || 0)).slice(0, clamped);

  const lines = [`Nearest Dublin Bikes stations to (${lat.toFixed(4)}, ${lon.toFixed(4)}):`, ""];
  for (const s of nearby) {
    const dist = s.distance_km!;
    const distStr = dist < 1 ? `${(dist * 1000).toFixed(0)}m` : `${dist.toFixed(1)}km`;
    const icon = s.is_renting ? "OPEN" : "CLOSED";
    lines.push(
      `  [${icon}] ${s.name} (${distStr}): ${s.bikes_available} bikes | ${s.docks_available} docks free`
    );
  }
  return lines.join("\n");
}

async function naturalLanguageQuery(query: string): Promise<string> {
  const q = query.toLowerCase();

  if (["all station", "list station", "every station", "how many"].some((kw) => q.includes(kw))) {
    return getAllStations();
  }

  if (q.includes("near") || q.includes("closest") || q.includes("nearest")) {
    const loc = findLocation(query);
    if (loc) return findNearest(loc[0], loc[1]);
    return findNearest(53.3498, -6.2603); // default to city centre
  }

  const loc = findLocation(query);
  if (loc) return findNearest(loc[0], loc[1]);

  // Try direct station search — strip common words
  let search = query;
  for (const word of ["bikes", "bike", "station", "at", "in", "near", "dublin", "the", "any", "?"]) {
    search = search.replace(new RegExp(word, "gi"), "");
  }
  search = search.trim();
  if (search) return getStation(search);

  return getAllStations();
}

// --- MCP Tool Definitions ---------------------------------------------------

const TOOLS = [
  {
    name: "query",
    description:
      "Natural language query for Dublin Bikes. Ask about bike availability, nearest stations, or station details.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'e.g. "bikes near Trinity", "station at Grafton Street", "all stations"',
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_all_stations",
    description: "Get all 117 Dublin Bikes stations with current bike and dock availability.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_station",
    description: "Search for a Dublin Bikes station by name or address.",
    inputSchema: {
      type: "object",
      properties: {
        station_name: { type: "string", description: "Station name or address to search for" },
      },
      required: ["station_name"],
    },
  },
  {
    name: "find_nearest",
    description: "Find the nearest Dublin Bikes stations to a GPS coordinate.",
    inputSchema: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Latitude" },
        lon: { type: "number", description: "Longitude" },
        limit: { type: "number", description: "Number of results, 1-20 (default 5)" },
      },
      required: ["lat", "lon"],
    },
  },
];

// --- Tool Dispatch ----------------------------------------------------------

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "query":
      return naturalLanguageQuery(String(args.query ?? "all stations"));
    case "get_all_stations":
      return getAllStations();
    case "get_station":
      return getStation(String(args.station_name));
    case "find_nearest":
      return findNearest(Number(args.lat), Number(args.lon), Number(args.limit ?? 5));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- MCP JSON-RPC Handler ---------------------------------------------------

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
      name: "Dublin Bikes MCP",
      version: "1.0.0",
      description: "Real-time Dublin Bikes station availability — bikes, e-bikes, docks",
      tools: TOOLS.map((t) => t.name),
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
        serverInfo: { name: "Dublin Bikes MCP", version: "1.0.0" },
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

// --- Worker Entry Point -----------------------------------------------------

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/mcp" || pathname === "/mcp/") return handleMCP(request);

    if (pathname === "/health") {
      return json({ status: "ok", service: "Dublin Bikes MCP", version: "1.0.0" });
    }

    if (pathname === "/" || pathname === "") {
      return json({
        service: "Dublin Bikes MCP",
        mcp_endpoint: "/mcp",
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
      });
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
