/**
 * EirGrid Carbon Intensity MCP — Cloudflare Worker
 * Implements MCP Streamable HTTP (JSON-RPC over POST)
 * Live electricity grid status, wind generation and carbon intensity
 * Data source: EirGrid Smart Grid Dashboard (smartgriddashboard.com)
 */

const BASE = "https://www.smartgriddashboard.com/api/chart/";

// ─── EirGrid API ──────────────────────────────────────────────────────────────

// Map area name to chartType used by the new SGB dashboard API
function chartType(area: string): string {
  if (area === "demandactual") return "demand";
  if (area === "windactual") return "wind";
  if (area === "co2intensity") return "co2";
  if (area === "generationactual") return "generation";
  return "demand";
}

function dateRange(hours: number): string {
  if (hours <= 1) return "hour";
  if (hours <= 24) return "day";
  if (hours <= 168) return "week";
  return "month";
}

async function eirgridGet(area: string, region: string = "ROI", hours: number = 2): Promise<any> {
  const params = new URLSearchParams({
    region: region.toUpperCase(),
    chartType: chartType(area),
    dateRange: dateRange(hours),
    dateFrom: "",
    dateTo: "",
    areas: area,
  });
  const url = `${BASE}?${params}`;
  const res = await fetch(url, {
    headers: {
      "Eirgrid-Content-Request": "Nextjs",
      "User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)",
    },
  });
  if (!res.ok) throw new Error(`EirGrid API error: ${res.status}`);
  return res.json();
}

function regionLabel(region: string): string {
  if (region === "ROI") return "Republic of Ireland";
  if (region === "NI") return "Northern Ireland";
  return "All-Island";
}

// ─── Tool Implementations ─────────────────────────────────────────────────────

async function getCurrentStatus(region: string = "ROI"): Promise<string> {
  const areas = ["demandactual", "windactual", "co2intensity", "generationactual"];
  const results: Record<string, { value: any; time: string }> = {};

  for (const area of areas) {
    try {
      const data = await eirgridGet(area, region, 1);
      const rows = data.Rows || [];
      if (rows.length) {
        const latest = rows[rows.length - 1];
        results[area] = { value: latest.Value, time: latest.EffectiveTime || "" };
      }
    } catch {
      results[area] = { value: "unavailable", time: "" };
    }
  }

  const lines: string[] = [`EirGrid Current Status — ${regionLabel(region)}`];
  if (results.demandactual?.time) {
    lines.push(`As of: ${results.demandactual.time}`);
  }
  lines.push("");

  const demand = results.demandactual?.value ?? "?";
  const wind = results.windactual?.value ?? "?";
  const co2 = results.co2intensity?.value ?? "?";
  const gen = results.generationactual?.value ?? "?";

  lines.push(`  System Demand: ${demand} MW`);
  lines.push(`  Total Generation: ${gen} MW`);
  lines.push(`  Wind Generation: ${wind} MW`);
  if (demand !== "?" && wind !== "?") {
    try {
      const pct = (parseFloat(wind) / parseFloat(demand) * 100).toFixed(1);
      lines.push(`  Wind Percentage: ${pct}%`);
    } catch {}
  }
  lines.push(`  Carbon Intensity: ${co2} gCO2/kWh`);

  return lines.join("\n");
}

async function getGenerationMix(region: string = "ROI"): Promise<string> {
  const areas = ["demandactual", "windactual", "generationactual"];
  const results: Record<string, any> = {};

  for (const area of areas) {
    try {
      const data = await eirgridGet(area, region, 1);
      const rows = data.Rows || [];
      if (rows.length) {
        results[area] = rows[rows.length - 1].Value;
      }
    } catch {}
  }

  const demand = results.demandactual ?? "?";
  const wind = results.windactual ?? "?";
  const gen = results.generationactual ?? "?";

  const lines: string[] = [`Generation Mix — ${regionLabel(region)}`, ""];
  lines.push(`  Total Generation: ${gen} MW`);
  lines.push(`  Wind: ${wind} MW`);
  if (gen !== "?" && wind !== "?") {
    try {
      const nonWind = parseFloat(gen) - parseFloat(wind);
      lines.push(`  Non-Wind: ${nonWind.toFixed(0)} MW`);
      lines.push(`  Wind Share: ${(parseFloat(wind) / parseFloat(gen) * 100).toFixed(1)}%`);
    } catch {}
  }
  lines.push(`  System Demand: ${demand} MW`);

  return lines.join("\n");
}

async function getCarbonIntensity(region: string = "ROI", hours: number = 24): Promise<string> {
  hours = Math.max(1, Math.min(hours, 48));
  const data = await eirgridGet("co2intensity", region, hours);
  const rows: any[] = data.Rows || [];
  if (!rows.length) return "No carbon intensity data available.";

  const values: number[] = rows.filter((r: any) => r.Value != null).map((r: any) => r.Value);
  if (!values.length) return "No carbon intensity data available.";

  const lines: string[] = [`Carbon Intensity — ${regionLabel(region)} (last ${hours}h)`, ""];
  lines.push(`  Current: ${values[values.length - 1]} gCO2/kWh`);
  lines.push(`  Min: ${Math.min(...values)} gCO2/kWh`);
  lines.push(`  Max: ${Math.max(...values)} gCO2/kWh`);
  lines.push(`  Average: ${Math.round(values.reduce((a, b) => a + b, 0) / values.length)} gCO2/kWh`);
  lines.push(`  Data points: ${values.length} (15-min intervals)`);

  lines.push("");
  lines.push("Recent readings:");
  for (const r of rows.slice(-8)) {
    lines.push(`  ${r.EffectiveTime ?? "?"}: ${r.Value ?? "?"} gCO2/kWh`);
  }

  return lines.join("\n");
}

async function getDemand(region: string = "ROI", hours: number = 24): Promise<string> {
  hours = Math.max(1, Math.min(hours, 48));
  const data = await eirgridGet("demandactual", region, hours);
  const rows: any[] = data.Rows || [];
  if (!rows.length) return "No demand data available.";

  const values: number[] = rows.filter((r: any) => r.Value != null).map((r: any) => r.Value);
  if (!values.length) return "No demand data available.";

  const lines: string[] = [`System Demand — ${regionLabel(region)} (last ${hours}h)`, ""];
  lines.push(`  Current: ${values[values.length - 1]} MW`);
  lines.push(`  Min: ${Math.min(...values)} MW`);
  lines.push(`  Max: ${Math.max(...values)} MW`);
  lines.push(`  Average: ${Math.round(values.reduce((a, b) => a + b, 0) / values.length)} MW`);

  lines.push("");
  lines.push("Recent readings:");
  for (const r of rows.slice(-8)) {
    lines.push(`  ${r.EffectiveTime ?? "?"}: ${r.Value ?? "?"} MW`);
  }

  return lines.join("\n");
}

async function getWind(region: string = "ROI", hours: number = 24): Promise<string> {
  hours = Math.max(1, Math.min(hours, 48));
  const data = await eirgridGet("windactual", region, hours);
  const rows: any[] = data.Rows || [];
  if (!rows.length) return "No wind data available.";

  const values: number[] = rows.filter((r: any) => r.Value != null).map((r: any) => r.Value);
  if (!values.length) return "No wind data available.";

  const lines: string[] = [`Wind Generation — ${regionLabel(region)} (last ${hours}h)`, ""];
  lines.push(`  Current: ${values[values.length - 1]} MW`);
  lines.push(`  Min: ${Math.min(...values)} MW`);
  lines.push(`  Max: ${Math.max(...values)} MW`);
  lines.push(`  Average: ${Math.round(values.reduce((a, b) => a + b, 0) / values.length)} MW`);

  lines.push("");
  lines.push("Recent readings:");
  for (const r of rows.slice(-8)) {
    lines.push(`  ${r.EffectiveTime ?? "?"}: ${r.Value ?? "?"} MW`);
  }

  return lines.join("\n");
}

async function naturalLanguageQuery(query: string): Promise<string> {
  const q = query.toLowerCase();
  const region = q.includes("northern") || q.includes(" ni ")
    ? "NI"
    : q.includes("all island") || q.includes("all-island")
    ? "ALL"
    : "ROI";

  if (q.includes("carbon") || q.includes("co2") || q.includes("emission")) {
    return getCarbonIntensity(region);
  }
  if (q.includes("wind")) {
    return getWind(region);
  }
  if (q.includes("demand") || q.includes("consumption")) {
    return getDemand(region);
  }
  if (q.includes("mix") || q.includes("generation")) {
    return getGenerationMix(region);
  }
  return getCurrentStatus(region);
}

// ─── MCP Tool Definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "query",
    description: "Natural language query for Irish electricity grid data. Ask about carbon intensity, wind generation, demand, or generation mix.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'e.g. "current grid status", "carbon intensity", "wind generation", "electricity demand"' },
      },
      required: ["query"],
    },
  },
  {
    name: "get_current_status",
    description: "Get current grid snapshot: demand, generation, wind, and carbon intensity.",
    inputSchema: {
      type: "object",
      properties: {
        region: { type: "string", enum: ["ROI", "NI", "ALL"], description: "ROI (default), NI, or ALL (all-island)" },
      },
      required: [],
    },
  },
  {
    name: "get_carbon_intensity",
    description: "Get carbon intensity of electricity generation (gCO2/kWh) over a time period.",
    inputSchema: {
      type: "object",
      properties: {
        region: { type: "string", enum: ["ROI", "NI", "ALL"], description: "ROI (default), NI, or ALL" },
        hours: { type: "number", description: "Hours of history, 1–48 (default 24)" },
      },
      required: [],
    },
  },
  {
    name: "get_wind",
    description: "Get wind generation data in MW over a time period.",
    inputSchema: {
      type: "object",
      properties: {
        region: { type: "string", enum: ["ROI", "NI", "ALL"], description: "ROI (default), NI, or ALL" },
        hours: { type: "number", description: "Hours of history, 1–48 (default 24)" },
      },
      required: [],
    },
  },
  {
    name: "get_demand",
    description: "Get electricity demand data in MW over a time period.",
    inputSchema: {
      type: "object",
      properties: {
        region: { type: "string", enum: ["ROI", "NI", "ALL"], description: "ROI (default), NI, or ALL" },
        hours: { type: "number", description: "Hours of history, 1–48 (default 24)" },
      },
      required: [],
    },
  },
  {
    name: "get_generation_mix",
    description: "Get current generation mix breakdown (wind vs non-wind).",
    inputSchema: {
      type: "object",
      properties: {
        region: { type: "string", enum: ["ROI", "NI", "ALL"], description: "ROI (default), NI, or ALL" },
      },
      required: [],
    },
  },
];

// ─── Tool Dispatch ────────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "query":
      return naturalLanguageQuery(String(args.query ?? "current status"));
    case "get_current_status":
      return getCurrentStatus(String(args.region ?? "ROI"));
    case "get_carbon_intensity":
      return getCarbonIntensity(String(args.region ?? "ROI"), Number(args.hours ?? 24));
    case "get_wind":
      return getWind(String(args.region ?? "ROI"), Number(args.hours ?? 24));
    case "get_demand":
      return getDemand(String(args.region ?? "ROI"), Number(args.hours ?? 24));
    case "get_generation_mix":
      return getGenerationMix(String(args.region ?? "ROI"));
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
      name: "EirGrid Carbon Intensity MCP",
      version: "1.0.0",
      description: "Live Irish electricity grid — carbon intensity, wind generation, demand",
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
        serverInfo: { name: "EirGrid Carbon Intensity MCP", version: "1.0.0" },
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
      return json({ status: "ok", service: "EirGrid Carbon Intensity MCP", version: "1.0.0" });
    }

    if (pathname === "/" || pathname === "") {
      return json({
        service: "EirGrid Carbon Intensity MCP",
        mcp_endpoint: "/mcp",
        tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
      });
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
