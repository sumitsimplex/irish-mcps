/**
 * Met Éireann Weather MCP — Cloudflare Worker
 * Current conditions: Met Éireann Observations API (prodapi.metweb.ie)
 * Forecasts: Open-Meteo (open-meteo.com) — free, no key, same underlying model
 */

const OBSERVATIONS_API = "https://prodapi.metweb.ie/observations";
const FORECAST_API = "https://api.open-meteo.com/v1/forecast";

// ─── Location Data ────────────────────────────────────────────────────────────

interface Location {
  lat: number;
  lon: number;
  county: string; // for observations API
}

const LOCATIONS: Record<string, Location> = {
  "dublin":     { lat: 53.3498, lon: -6.2603,  county: "Dublin" },
  "cork":       { lat: 51.8985, lon: -8.4756,  county: "Cork" },
  "galway":     { lat: 53.2707, lon: -9.0568,  county: "Galway" },
  "limerick":   { lat: 52.6638, lon: -8.6267,  county: "Limerick" },
  "waterford":  { lat: 52.2593, lon: -7.1101,  county: "Waterford" },
  "kilkenny":   { lat: 52.6541, lon: -7.2448,  county: "Kilkenny" },
  "sligo":      { lat: 54.2766, lon: -8.4761,  county: "Sligo" },
  "wexford":    { lat: 52.3369, lon: -6.4633,  county: "Wexford" },
  "kerry":      { lat: 52.1545, lon: -9.5669,  county: "Kerry" },
  "tralee":     { lat: 52.2675, lon: -9.6987,  county: "Kerry" },
  "killarney":  { lat: 52.0599, lon: -9.5044,  county: "Kerry" },
  "donegal":    { lat: 54.6538, lon: -8.1096,  county: "Donegal" },
  "mayo":       { lat: 53.8483, lon: -9.2993,  county: "Mayo" },
  "castlebar":  { lat: 53.8550, lon: -9.2983,  county: "Mayo" },
  "tipperary":  { lat: 52.4735, lon: -8.1619,  county: "Tipperary" },
  "clare":      { lat: 52.9045, lon: -9.0000,  county: "Clare" },
  "ennis":      { lat: 52.8436, lon: -8.9862,  county: "Clare" },
  "wicklow":    { lat: 52.9808, lon: -6.0439,  county: "Wicklow" },
  "kildare":    { lat: 53.1609, lon: -6.9111,  county: "Kildare" },
  "naas":       { lat: 53.2197, lon: -6.6658,  county: "Kildare" },
  "meath":      { lat: 53.6550, lon: -6.6564,  county: "Meath" },
  "navan":      { lat: 53.6542, lon: -6.6800,  county: "Meath" },
  "louth":      { lat: 53.9981, lon: -6.4130,  county: "Louth" },
  "dundalk":    { lat: 54.0015, lon: -6.4050,  county: "Louth" },
  "drogheda":   { lat: 53.7185, lon: -6.3536,  county: "Louth" },
  "offaly":     { lat: 53.2745, lon: -7.4901,  county: "Offaly" },
  "laois":      { lat: 52.9941, lon: -7.3324,  county: "Laois" },
  "carlow":     { lat: 52.8382, lon: -6.9334,  county: "Carlow" },
  "cavan":      { lat: 53.9897, lon: -7.3633,  county: "Cavan" },
  "monaghan":   { lat: 54.2492, lon: -6.9683,  county: "Monaghan" },
  "roscommon":  { lat: 53.6274, lon: -8.1859,  county: "Roscommon" },
  "longford":   { lat: 53.7276, lon: -7.7966,  county: "Longford" },
  "westmeath":  { lat: 53.5350, lon: -7.4653,  county: "Westmeath" },
  "athlone":    { lat: 53.4229, lon: -7.9397,  county: "Westmeath" },
  "leitrim":    { lat: 54.1247, lon: -8.0003,  county: "Leitrim" },
};

function findLocation(query: string): Location | null {
  const q = query.toLowerCase();
  for (const [name, loc] of Object.entries(LOCATIONS)) {
    if (q.includes(name)) return loc;
  }
  return null;
}

// ─── WMO Weather Code → Description ──────────────────────────────────────────

function wmoDescription(code: number): string {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Foggy";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

// ─── Tool Implementations ─────────────────────────────────────────────────────

async function getCurrentConditions(locationQuery: string): Promise<string> {
  const loc = findLocation(locationQuery);
  if (!loc) return `Unknown location: "${locationQuery}". Try a county name like Dublin, Cork, Galway, Kerry, etc.`;

  try {
    const res = await fetch(`${OBSERVATIONS_API}/${loc.county}/today`, {
      headers: { "User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)" },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data: {
      name: string; temperature: string; weatherDescription: string;
      windSpeed: string; windGust: string; cardinalWindDirection: string;
      humidity: string; rainfall: string; pressure: string; reportTime: string;
    }[] = await res.json();

    if (!data.length) return `No observations available for ${loc.county}.`;

    const latest = data[data.length - 1];
    const lines = [
      `Current conditions in ${loc.county} (${latest.name}, as of ${latest.reportTime}):`,
      `  Weather: ${latest.weatherDescription}`,
      `  Temperature: ${latest.temperature}°C`,
      `  Wind: ${latest.windSpeed} km/h ${latest.cardinalWindDirection} (gusts ${latest.windGust} km/h)`,
      `  Humidity: ${latest.humidity.trim()}%`,
      `  Rainfall: ${latest.rainfall.trim()} mm`,
      `  Pressure: ${latest.pressure} hPa`,
    ];
    return lines.join("\n");
  } catch {
    // Fall back to Open-Meteo current if Met Éireann fails
    const res = await fetch(
      `${FORECAST_API}?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,precipitation,windspeed_10m,windgusts_10m,weathercode,relativehumidity_2m&timezone=Europe/Dublin`,
      { headers: { "User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)" } }
    );
    if (!res.ok) throw new Error("Both weather APIs failed");
    const data: { current: { temperature_2m: number; precipitation: number; windspeed_10m: number; windgusts_10m: number; weathercode: number; relativehumidity_2m: number; time: string } } = await res.json();
    const c = data.current;
    return [
      `Current conditions in ${loc.county} (${c.time}):`,
      `  Weather: ${wmoDescription(c.weathercode)}`,
      `  Temperature: ${c.temperature_2m}°C`,
      `  Wind: ${c.windspeed_10m} km/h (gusts ${c.windgusts_10m} km/h)`,
      `  Humidity: ${c.relativehumidity_2m}%`,
      `  Precipitation: ${c.precipitation} mm`,
    ].join("\n");
  }
}

async function getForecast(locationQuery: string, days = 5): Promise<string> {
  const loc = findLocation(locationQuery);
  if (!loc) return `Unknown location: "${locationQuery}". Try a county name like Dublin, Cork, Galway, Kerry, etc.`;

  const d = Math.min(Math.max(days, 1), 7);
  const res = await fetch(
    `${FORECAST_API}?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max,windgusts_10m_max&timezone=Europe/Dublin&forecast_days=${d}`,
    { headers: { "User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)" } }
  );
  if (!res.ok) throw new Error(`Forecast API error: ${res.status}`);
  const data: {
    daily: {
      time: string[]; weathercode: number[];
      temperature_2m_max: number[]; temperature_2m_min: number[];
      precipitation_sum: number[]; windspeed_10m_max: number[]; windgusts_10m_max: number[];
    }
  } = await res.json();

  const { daily } = data;
  const lines = [`${d}-day forecast for ${loc.county}:\n`];
  for (let i = 0; i < daily.time.length; i++) {
    const date = new Date(daily.time[i]);
    const day = date.toLocaleDateString("en-IE", { weekday: "long", month: "short", day: "numeric" });
    lines.push(
      `${day}`,
      `  ${wmoDescription(daily.weathercode[i])}`,
      `  High: ${daily.temperature_2m_max[i]}°C  Low: ${daily.temperature_2m_min[i]}°C`,
      `  Rain: ${daily.precipitation_sum[i]} mm  Wind: ${daily.windspeed_10m_max[i]} km/h (gusts ${daily.windgusts_10m_max[i]} km/h)`,
      ``
    );
  }
  return lines.join("\n");
}

async function getTodayHourly(locationQuery: string): Promise<string> {
  const loc = findLocation(locationQuery);
  if (!loc) return `Unknown location: "${locationQuery}". Try a county name like Dublin, Cork, Galway, Kerry, etc.`;

  try {
    const res = await fetch(`${OBSERVATIONS_API}/${loc.county}/today`, {
      headers: { "User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)" },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data: { reportTime: string; temperature: string; weatherDescription: string; windSpeed: string; cardinalWindDirection: string; rainfall: string }[] = await res.json();
    if (!data.length) return `No hourly data for ${loc.county} today.`;

    const lines = [`Today's hourly observations for ${loc.county} (${data[0].reportTime} – ${data[data.length - 1].reportTime}):\n`];
    for (const h of data) {
      lines.push(`${h.reportTime}  ${h.temperature}°C  ${h.weatherDescription}  Wind: ${h.windSpeed} km/h ${h.cardinalWindDirection}  Rain: ${h.rainfall.trim()} mm`);
    }
    return lines.join("\n");
  } catch {
    return `Could not retrieve hourly data for ${loc.county}.`;
  }
}

async function naturalLanguageQuery(query: string): Promise<string> {
  const q = query.toLowerCase();
  const loc = findLocation(query) ? query : "Dublin";

  if (q.includes("forecast") || q.includes("week") || q.includes("tomorrow") || q.includes("weekend") || q.includes("day")) {
    const daysMatch = query.match(/(\d+)\s*day/i);
    const days = daysMatch ? parseInt(daysMatch[1]) : 5;
    return getForecast(loc, days);
  }
  if (q.includes("hourly") || q.includes("today") || q.includes("hour")) {
    return getTodayHourly(loc);
  }
  return getCurrentConditions(loc);
}

// ─── MCP Tool Definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "query",
    description: "Natural language weather query for any Irish location. Ask about current conditions, forecasts, or today's hourly breakdown.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'e.g. "Weather in Dublin", "5 day forecast for Cork", "Is it raining in Galway?", "Weekend forecast Kerry"',
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_current_conditions",
    description: "Get current weather conditions for an Irish county or city from Met Éireann observations.",
    inputSchema: {
      type: "object",
      properties: {
        location: { type: "string", description: "County or city name e.g. Dublin, Cork, Galway, Kerry, Limerick" },
      },
      required: ["location"],
    },
  },
  {
    name: "get_forecast",
    description: "Get a multi-day weather forecast for an Irish location (1–7 days).",
    inputSchema: {
      type: "object",
      properties: {
        location: { type: "string", description: "County or city name e.g. Dublin, Cork, Galway" },
        days: { type: "number", description: "Number of days to forecast, 1–7 (default 5)" },
      },
      required: ["location"],
    },
  },
  {
    name: "get_today_hourly",
    description: "Get today's hourly weather observations for an Irish county from Met Éireann.",
    inputSchema: {
      type: "object",
      properties: {
        location: { type: "string", description: "County or city name e.g. Dublin, Cork, Galway" },
      },
      required: ["location"],
    },
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
      return naturalLanguageQuery(String(args.query ?? "Weather in Dublin"));
    case "get_current_conditions":
      return getCurrentConditions(String(args.location));
    case "get_forecast":
      return getForecast(String(args.location), Number(args.days ?? 5));
    case "get_today_hourly":
      return getTodayHourly(String(args.location));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMCP(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  if (req.method === "GET") {
    return json({
      name: "Met Éireann Weather MCP",
      version: "1.0.0",
      description: "Live Irish weather — current conditions, forecasts and hourly data",
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
        serverInfo: { name: "Met Éireann Weather MCP", version: "1.0.0" },
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
      return json({ status: "ok", service: "Met Éireann Weather MCP", version: "1.0.0" });
    }

    if (pathname === "/" || pathname === "") {
      return json({
        service: "Met Éireann Weather MCP",
        mcp_endpoint: "/mcp",
        tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
      });
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
