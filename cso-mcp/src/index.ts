/**
 * CSO Statistics MCP — Cloudflare Worker
 * Access Central Statistics Office datasets — census, economic indicators, population
 * Data source: CSO PxStat API (ws.cso.ie)
 * Implements MCP Streamable HTTP (JSON-RPC over POST)
 */

const BASE = "https://ws.cso.ie/public/api.restful";

// ─── Popular Datasets ─────────────────────────────────────────────────────────

const POPULAR_DATASETS: Record<string, { code: string; name: string }> = {
  population: { code: "PEA01", name: "Population Estimates" },
  census: { code: "F1001", name: "Census 2022 — Population by Area" },
  cpi: { code: "CPM01", name: "Consumer Price Index" },
  unemployment: { code: "QLF18", name: "Unemployment Rate" },
  gdp: { code: "NQQ36", name: "GDP at Current Market Prices" },
  "house prices": { code: "HPM09", name: "Residential Property Price Index" },
  housing: { code: "HPM09", name: "Residential Property Price Index" },
  births: { code: "VSA02", name: "Births by County" },
  deaths: { code: "VSA07", name: "Deaths by County" },
  tourism: { code: "TMA11", name: "Overseas Trips to Ireland" },
  crime: { code: "CJA09", name: "Recorded Crime Incidents" },
  earnings: { code: "EHQ02", name: "Average Weekly Earnings" },
  rent: { code: "RIQ02", name: "RTB Average Monthly Rent" },
  migration: { code: "PEA18", name: "Population and Migration Estimates" },
  "motor vehicles": { code: "TEA11", name: "New Motor Vehicles Licensed" },
};

// ─── CSO API ──────────────────────────────────────────────────────────────────

async function apiGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}/${path}`, {
    headers: { "User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)" },
  });
  if (!res.ok) throw new Error(`CSO API error: ${res.status}`);
  return res.json();
}

// ─── Tool Implementations ─────────────────────────────────────────────────────

async function getDataset(tableCode: string): Promise<string> {
  const data = (await apiGet(
    `PxStat.Data.Cube_API.ReadDataset/${tableCode}/JSON-stat/2.0/en`
  )) as Record<string, unknown>;

  const label = (data.label as string) || tableCode;
  const dimensions = (data.dimension as Record<string, unknown>) || {};
  const dimIds = (data.id as string[]) || [];
  const sizes = (data.size as number[]) || [];
  const values = (data.value as (number | null)[]) || [];
  const updated = (data.updated as string) || "";

  const lines: string[] = [`Dataset: ${label}`, `Table Code: ${tableCode}`];
  if (updated) lines.push(`Last Updated: ${updated}`);
  lines.push("");

  // Describe dimensions
  lines.push("Dimensions:");
  for (const dimId of dimIds) {
    const dim = (dimensions[dimId] as Record<string, unknown>) || {};
    const dimLabel = (dim.label as string) || dimId;
    const categories = (dim.category as Record<string, unknown>) || {};
    const catLabels = (categories.label as Record<string, string>) || {};
    const catCount = Object.keys(catLabels).length;
    lines.push(`  ${dimLabel}: ${catCount} categories`);
    // Show first few categories
    const shown = Object.values(catLabels).slice(0, 8);
    if (shown.length) {
      let preview = shown.map(String).join(", ");
      if (catCount > 8) preview += ` ... (+${catCount - 8} more)`;
      lines.push(`    [${preview}]`);
    }
  }
  lines.push("");

  // Show total data points
  lines.push(`Total data points: ${values.length}`);

  // Show most recent values (last dimension is usually time)
  if (dimIds.length && values.length) {
    const timeDimId = dimIds[dimIds.length - 1];
    const timeDim = (dimensions[timeDimId] as Record<string, unknown>) || {};
    const timeCats = (timeDim.category as Record<string, unknown>) || {};
    const timeLabels = Object.values(
      (timeCats.label as Record<string, string>) || {}
    );

    if (timeLabels.length && dimIds.length >= 2) {
      const firstDimId = dimIds[0];
      const firstDim =
        (dimensions[firstDimId] as Record<string, unknown>) || {};
      const firstCats = (firstDim.category as Record<string, unknown>) || {};
      const firstLabels = Object.values(
        (firstCats.label as Record<string, string>) || {}
      );

      lines.push("");
      lines.push("Recent values:");

      const nTimes = timeLabels.length;
      for (
        let tIdx = Math.max(0, nTimes - 5);
        tIdx < nTimes;
        tIdx++
      ) {
        const timeLabel = timeLabels[tIdx];
        const val = tIdx < values.length ? values[tIdx] : null;
        const statLabel = firstLabels.length ? firstLabels[0] : "";
        if (val !== null && val !== undefined) {
          lines.push(`  ${timeLabel}: ${val} (${statLabel})`);
        }
      }
    }
  }

  return lines.join("\n");
}

async function listPopularDatasets(): Promise<string> {
  const lines: string[] = ["Popular CSO Datasets:", ""];
  for (const [topic, info] of Object.entries(POPULAR_DATASETS)) {
    lines.push(`  ${info.code} — ${info.name} (search: "${topic}")`);
  }
  lines.push("");
  lines.push("Use get_dataset with the table code to fetch data.");
  lines.push("Browse all datasets at https://data.cso.ie");
  return lines.join("\n");
}

async function searchDatasets(topic: string): Promise<string> {
  const topicLower = topic.toLowerCase();
  const matches: { code: string; name: string }[] = [];

  for (const [kw, info] of Object.entries(POPULAR_DATASETS)) {
    if (kw.includes(topicLower) || topicLower.includes(kw)) {
      matches.push(info);
    }
  }

  if (!matches.length) {
    const lines = [`No datasets found for "${topic}". Popular topics:`, ""];
    for (const kw of Object.keys(POPULAR_DATASETS)) {
      lines.push(`  - ${kw}`);
    }
    lines.push("");
    lines.push("Or provide a table code directly (e.g. CPM01, PEA01)");
    return lines.join("\n");
  }

  if (matches.length === 1) {
    return getDataset(matches[0].code);
  }

  const lines = [`Datasets matching "${topic}":`, ""];
  for (const m of matches) {
    lines.push(`  ${m.code} — ${m.name}`);
  }
  lines.push("");
  lines.push("Use get_dataset with the table code to fetch data.");
  return lines.join("\n");
}

async function naturalLanguageQuery(query: string): Promise<string> {
  const q = query.toLowerCase();

  if (
    ["list", "popular", "available", "what dataset", "browse"].some((kw) =>
      q.includes(kw)
    )
  ) {
    return listPopularDatasets();
  }

  // Check if query contains a table code pattern (uppercase letters + digits)
  const codeMatch = query.match(/\b([A-Z]{2,4}\d{2,3})\b/);
  if (codeMatch) {
    return getDataset(codeMatch[1]);
  }

  return searchDatasets(query);
}

// ─── MCP Tool Definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "query",
    description:
      "Natural language query for CSO statistics. Ask about population, GDP, CPI, unemployment, housing, crime, etc.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'e.g. "population of Ireland", "CPI data", "unemployment rate", "house prices"',
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_dataset",
    description:
      "Fetch a specific CSO dataset by its table code (e.g. CPM01, PEA01, F1001).",
    inputSchema: {
      type: "object",
      properties: {
        table_code: {
          type: "string",
          description: "CSO table code e.g. CPM01, PEA01, NQQ36, HPM09",
        },
      },
      required: ["table_code"],
    },
  },
  {
    name: "search_datasets",
    description: "Search for CSO datasets by topic keyword.",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "Topic to search for e.g. population, housing, crime, earnings",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "list_popular_datasets",
    description:
      "List popular and commonly requested CSO datasets with their table codes.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

// ─── Tool Dispatch ────────────────────────────────────────────────────────────

async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "query":
      return naturalLanguageQuery(
        String(args.query ?? "popular datasets")
      );
    case "get_dataset":
      return getDataset(String(args.table_code));
    case "search_datasets":
      return searchDatasets(String(args.topic));
    case "list_popular_datasets":
      return listPopularDatasets();
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
  if (req.method === "OPTIONS")
    return new Response(null, { headers: CORS });

  if (req.method === "GET") {
    return json({
      name: "CSO Statistics MCP",
      version: "1.0.0",
      description:
        "Central Statistics Office datasets — census, economy, population, housing",
      tools: TOOLS.map((t) => t.name),
    });
  }

  if (req.method !== "POST")
    return new Response("Method Not Allowed", {
      status: 405,
      headers: CORS,
    });

  let body: {
    jsonrpc?: string;
    method?: string;
    params?: unknown;
    id?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json(
      { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null },
      400
    );
  }

  const id = body.id ?? null;
  const ok = (result: unknown) => json({ jsonrpc: "2.0", result, id });
  const err = (code: number, msg: string) =>
    json({ jsonrpc: "2.0", error: { code, message: msg }, id });

  switch (body.method) {
    case "initialize":
      return ok({
        protocolVersion: "2024-11-05",
        serverInfo: { name: "CSO Statistics MCP", version: "1.0.0" },
        capabilities: { tools: {} },
      });

    case "notifications/initialized":
      return new Response(null, { status: 204, headers: CORS });

    case "ping":
      return ok({});

    case "tools/list":
      return ok({ tools: TOOLS });

    case "tools/call": {
      const p = body.params as
        | { name?: string; arguments?: Record<string, unknown> }
        | undefined;
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

    if (pathname === "/mcp" || pathname === "/mcp/")
      return handleMCP(request);

    if (pathname === "/health") {
      return json({
        status: "ok",
        service: "CSO Statistics MCP",
        version: "1.0.0",
      });
    }

    if (pathname === "/" || pathname === "") {
      return json({
        service: "CSO Statistics MCP",
        mcp_endpoint: "/mcp",
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
        })),
      });
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
