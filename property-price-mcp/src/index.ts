/**
 * Property Price Register MCP — Cloudflare Worker
 * Implements MCP Streamable HTTP (JSON-RPC over POST)
 * Search all residential property sale prices in Ireland since 2010
 * Data source: CivicTech PPR API (priceregister.civictech.ie)
 */

const BASE = "https://priceregister.civictech.ie/api/v1/residential";

const COUNTIES = [
  "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway",
  "Kerry", "Kildare", "Kilkenny", "Laois", "Leitrim", "Limerick",
  "Longford", "Louth", "Mayo", "Meath", "Monaghan", "Offaly",
  "Roscommon", "Sligo", "Tipperary", "Waterford", "Westmeath",
  "Wexford", "Wicklow",
];

// --- API Helper ------------------------------------------------------------

async function apiGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)" },
  });
  if (!res.ok) throw new Error(`PPR API error: ${res.status}`);
  return res.json();
}

// --- Helpers ---------------------------------------------------------------

function findCounty(query: string): string {
  const q = query.toLowerCase();
  for (const c of COUNTIES) {
    if (q.includes(c.toLowerCase())) return c;
  }
  return "";
}

function formatPrice(price: number): string {
  const rounded = Math.round(price);
  const str = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "\u20ac" + str;
}

// --- Tool Implementations --------------------------------------------------

function parsePrice(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  return 0;
}

async function searchSales(
  county = "",
  minPrice = 0,
  maxPrice = 0,
  sort = "date-desc",
  limit = 20,
): Promise<string> {
  // Fetch more records when filtering, since API has no server-side filters
  const needsFilter = !!county || minPrice > 0 || maxPrice > 0;
  const fetchLimit = needsFilter ? 500 : Math.min(limit, 50);

  const data = await apiGet("sales", { limit: String(fetchLimit), sort });
  let results: any[] = data.data || [];
  const total = data.metadata?.total_rows ?? "?";

  // Client-side filtering
  if (county) {
    const countyLower = county.toLowerCase();
    results = results.filter((r: any) => (r.county || "").toLowerCase().includes(countyLower));
  }
  if (minPrice > 0) {
    results = results.filter((r: any) => parsePrice(r.price_in_euros) >= minPrice);
  }
  if (maxPrice > 0) {
    results = results.filter((r: any) => parsePrice(r.price_in_euros) <= maxPrice);
  }

  // Trim to requested limit
  results = results.slice(0, Math.min(limit, 20));

  if (!results.length) {
    return county
      ? `No recent sales found in ${county}. The register has ${total} total records — try a broader search.`
      : "No sales found matching your criteria.";
  }

  const lines: string[] = [`Property Sales (${results.length} shown, ${total} total in register):`, ""];

  for (const r of results) {
    const price = formatPrice(parsePrice(r.price_in_euros));
    const date = r.date_of_sale || "?";
    const address = r.address || "?";
    const countyName = r.county || "?";
    const eircode = r.eircode || "";
    const desc = r.description_of_property || "";
    const vat = r.vat_exclusive ? " (VAT excl)" : "";
    const notFull = r.not_full_market_price ? " *not full market price*" : "";

    lines.push(`  ${price}${vat}${notFull}`);
    lines.push(`    ${address}, ${countyName}${eircode ? " " + eircode : ""}`);
    lines.push(`    Date: ${date} | ${desc}`);
    lines.push("");
  }

  return lines.join("\n");
}

async function getRecentSales(county = "", limit = 20): Promise<string> {
  return searchSales(county, 0, 0, "date-desc", limit);
}

async function getMostExpensive(county = "", limit = 10): Promise<string> {
  return searchSales(county, 0, 0, "price-desc", Math.min(limit, 20));
}

async function naturalLanguageQuery(query: string): Promise<string> {
  const q = query.toLowerCase();
  const county = findCounty(query);

  // Price extraction: "300k", "500 thousand"
  let minPrice = 0;
  let maxPrice = 0;

  const priceMatchK = q.match(/(\d[\d,]*)\s*(?:k|thousand)/);
  if (priceMatchK) {
    const val = parseInt(priceMatchK[1].replace(/,/g, ""), 10) * 1000;
    if (/under|below|less|max/.test(q)) {
      maxPrice = val;
    } else if (/over|above|more|min/.test(q)) {
      minPrice = val;
    }
  }

  // Fallback: plain euro amount
  if (!priceMatchK) {
    const euroMatch = q.match(/\u20ac?([\d,]+)/);
    if (euroMatch) {
      const val = parseInt(euroMatch[1].replace(/,/g, ""), 10);
      if (val > 1000) {
        if (/under|below|less/.test(q)) {
          maxPrice = val;
        } else if (/over|above|more/.test(q)) {
          minPrice = val;
        }
      }
    }
  }

  // Route: most expensive
  if (["expensive", "highest", "top", "most"].some(kw => q.includes(kw))) {
    return getMostExpensive(county);
  }

  // Route: cheapest
  if (["cheap", "lowest", "bottom", "least"].some(kw => q.includes(kw))) {
    return searchSales(county, 0, 0, "price-asc");
  }

  // Route: price filter
  if (minPrice || maxPrice) {
    return searchSales(county, minPrice, maxPrice);
  }

  // Default: recent sales
  return getRecentSales(county);
}

// --- MCP Tool Definitions --------------------------------------------------

const TOOLS = [
  {
    name: "query",
    description: "Natural language query for Irish property sales. Ask about recent sales, prices in a county, most expensive, etc.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'e.g. "recent sales in Dublin", "most expensive in Cork", "houses under 300k in Galway"' },
      },
      required: ["query"],
    },
  },
  {
    name: "get_recent_sales",
    description: "Get the most recent property sales, optionally filtered by county.",
    inputSchema: {
      type: "object",
      properties: {
        county: { type: "string", description: "County name e.g. Dublin, Cork, Galway (optional)" },
        limit: { type: "number", description: "Max results 1-50 (default 20)" },
      },
      required: [],
    },
  },
  {
    name: "get_most_expensive",
    description: "Get the most expensive property sales, optionally filtered by county.",
    inputSchema: {
      type: "object",
      properties: {
        county: { type: "string", description: "County name (optional)" },
        limit: { type: "number", description: "Max results 1-50 (default 10)" },
      },
      required: [],
    },
  },
  {
    name: "search_sales",
    description: "Search property sales with filters for county, price range, and sorting.",
    inputSchema: {
      type: "object",
      properties: {
        county: { type: "string", description: "County name (optional)" },
        min_price: { type: "number", description: "Minimum price in euros (optional)" },
        max_price: { type: "number", description: "Maximum price in euros (optional)" },
        sort: { type: "string", enum: ["date-desc", "date-asc", "price-desc", "price-asc"], description: "Sort order (default date-desc)" },
        limit: { type: "number", description: "Max results 1-50 (default 20)" },
      },
      required: [],
    },
  },
];

// --- Tool Dispatch ---------------------------------------------------------

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "query":
      return naturalLanguageQuery(String(args.query ?? "recent sales"));
    case "get_recent_sales":
      return getRecentSales(String(args.county ?? ""), Number(args.limit ?? 20));
    case "get_most_expensive":
      return getMostExpensive(String(args.county ?? ""), Number(args.limit ?? 10));
    case "search_sales":
      return searchSales(
        String(args.county ?? ""),
        Number(args.min_price ?? 0),
        Number(args.max_price ?? 0),
        String(args.sort ?? "date-desc"),
        Number(args.limit ?? 20),
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- MCP JSON-RPC Handler --------------------------------------------------

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
      name: "Property Price Register MCP",
      version: "1.0.0",
      description: "Irish residential property sale prices since 2010",
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
        serverInfo: { name: "Property Price Register MCP", version: "1.0.0" },
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

// --- Worker Entry Point ----------------------------------------------------

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/mcp" || pathname === "/mcp/") return handleMCP(request);

    if (pathname === "/health") {
      return json({ status: "ok", service: "Property Price Register MCP", version: "1.0.0" });
    }

    if (pathname === "/" || pathname === "") {
      return json({
        service: "Property Price Register MCP",
        mcp_endpoint: "/mcp",
        tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
      });
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
