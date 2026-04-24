/**
 * HSE Service Finder MCP — Cloudflare Worker
 * Implements MCP Streamable HTTP (JSON-RPC over POST)
 *
 * Data: curated reference dataset of HSE public acute hospitals, emergency
 * departments and local injury units across Ireland. Sourced from public HSE
 * listings at https://www.hse.ie/eng/services/list/.
 */

type Facility = {
  name: string;
  slug: string;
  type: "acute-hospital" | "injury-unit" | "maternity" | "paediatric";
  county: string;
  region: string;
  address: string;
  phone: string;
  has_ed: boolean;
  trauma_level?: "major-trauma" | "trauma-unit" | "injury-unit";
  url: string;
};

const FACILITIES: Facility[] = [
  // ─── Dublin / East ────────────────────────────────────────────────
  { name: "Beaumont Hospital", slug: "beaumont", type: "acute-hospital", county: "Dublin", region: "RCSI Hospital Group", address: "Beaumont Road, Dublin 9", phone: "+353 1 809 3000", has_ed: true, trauma_level: "trauma-unit", url: "https://www.beaumont.ie" },
  { name: "Connolly Hospital Blanchardstown", slug: "connolly", type: "acute-hospital", county: "Dublin", region: "RCSI Hospital Group", address: "Mill Road, Blanchardstown, Dublin 15", phone: "+353 1 646 5000", has_ed: true, trauma_level: "trauma-unit", url: "https://www.connollyhospital.ie" },
  { name: "Mater Misericordiae University Hospital", slug: "mater", type: "acute-hospital", county: "Dublin", region: "Ireland East Hospital Group", address: "Eccles Street, Dublin 7", phone: "+353 1 803 2000", has_ed: true, trauma_level: "major-trauma", url: "https://www.mater.ie" },
  { name: "St James's Hospital", slug: "st-james", type: "acute-hospital", county: "Dublin", region: "Dublin Midlands Hospital Group", address: "James's Street, Dublin 8", phone: "+353 1 410 3000", has_ed: true, trauma_level: "trauma-unit", url: "https://www.stjames.ie" },
  { name: "St Vincent's University Hospital", slug: "st-vincents", type: "acute-hospital", county: "Dublin", region: "Ireland East Hospital Group", address: "Elm Park, Dublin 4", phone: "+353 1 221 4000", has_ed: true, trauma_level: "trauma-unit", url: "https://www.stvincents.ie" },
  { name: "Tallaght University Hospital", slug: "tallaght", type: "acute-hospital", county: "Dublin", region: "Dublin Midlands Hospital Group", address: "Tallaght, Dublin 24", phone: "+353 1 414 2000", has_ed: true, trauma_level: "trauma-unit", url: "https://www.tuh.ie" },
  { name: "Children's Health Ireland at Crumlin", slug: "chi-crumlin", type: "paediatric", county: "Dublin", region: "Children's Health Ireland", address: "Cooley Road, Crumlin, Dublin 12", phone: "+353 1 409 6100", has_ed: true, url: "https://www.childrenshealthireland.ie" },
  { name: "Children's Health Ireland at Temple Street", slug: "chi-temple-street", type: "paediatric", county: "Dublin", region: "Children's Health Ireland", address: "Temple Street, Dublin 1", phone: "+353 1 878 4200", has_ed: true, url: "https://www.childrenshealthireland.ie" },
  { name: "Children's Health Ireland at Tallaght", slug: "chi-tallaght", type: "paediatric", county: "Dublin", region: "Children's Health Ireland", address: "Tallaght, Dublin 24", phone: "+353 1 414 2000", has_ed: true, url: "https://www.childrenshealthireland.ie" },
  { name: "Rotunda Hospital", slug: "rotunda", type: "maternity", county: "Dublin", region: "Ireland East Hospital Group", address: "Parnell Square, Dublin 1", phone: "+353 1 817 1700", has_ed: false, url: "https://www.rotunda.ie" },
  { name: "National Maternity Hospital", slug: "nmh-holles-street", type: "maternity", county: "Dublin", region: "Ireland East Hospital Group", address: "Holles Street, Dublin 2", phone: "+353 1 637 3100", has_ed: false, url: "https://www.nmh.ie" },
  { name: "Coombe Women & Infants University Hospital", slug: "coombe", type: "maternity", county: "Dublin", region: "Dublin Midlands Hospital Group", address: "Dolphin's Barn, Dublin 8", phone: "+353 1 408 5200", has_ed: false, url: "https://www.coombe.ie" },

  // ─── Leinster ─────────────────────────────────────────────────────
  { name: "Naas General Hospital", slug: "naas", type: "acute-hospital", county: "Kildare", region: "Dublin Midlands Hospital Group", address: "Craddockstown Road, Naas, Co Kildare", phone: "+353 45 849 500", has_ed: true, trauma_level: "trauma-unit", url: "https://www.hse.ie" },
  { name: "Our Lady's Hospital Navan", slug: "navan", type: "injury-unit", county: "Meath", region: "RCSI Hospital Group", address: "Navan, Co Meath", phone: "+353 46 907 8000", has_ed: false, trauma_level: "injury-unit", url: "https://www.hse.ie" },
  { name: "Our Lady of Lourdes Hospital Drogheda", slug: "drogheda", type: "acute-hospital", county: "Louth", region: "RCSI Hospital Group", address: "Drogheda, Co Louth", phone: "+353 41 983 7601", has_ed: true, trauma_level: "trauma-unit", url: "https://www.hse.ie" },
  { name: "Louth County Hospital", slug: "dundalk", type: "injury-unit", county: "Louth", region: "RCSI Hospital Group", address: "Dublin Road, Dundalk, Co Louth", phone: "+353 42 933 4701", has_ed: false, trauma_level: "injury-unit", url: "https://www.hse.ie" },
  { name: "Midland Regional Hospital Mullingar", slug: "mullingar", type: "acute-hospital", county: "Westmeath", region: "Dublin Midlands Hospital Group", address: "Mullingar, Co Westmeath", phone: "+353 44 934 0221", has_ed: true, trauma_level: "trauma-unit", url: "https://www.hse.ie" },
  { name: "Midland Regional Hospital Portlaoise", slug: "portlaoise", type: "acute-hospital", county: "Laois", region: "Dublin Midlands Hospital Group", address: "Dublin Road, Portlaoise, Co Laois", phone: "+353 57 862 1364", has_ed: true, trauma_level: "trauma-unit", url: "https://www.hse.ie" },
  { name: "Midland Regional Hospital Tullamore", slug: "tullamore", type: "acute-hospital", county: "Offaly", region: "Dublin Midlands Hospital Group", address: "Arden Road, Tullamore, Co Offaly", phone: "+353 57 932 1501", has_ed: true, trauma_level: "trauma-unit", url: "https://www.hse.ie" },
  { name: "St Luke's General Hospital Kilkenny", slug: "kilkenny", type: "acute-hospital", county: "Kilkenny", region: "Ireland East Hospital Group", address: "Freshford Road, Kilkenny", phone: "+353 56 778 5000", has_ed: true, trauma_level: "trauma-unit", url: "https://www.hse.ie" },
  { name: "Wexford General Hospital", slug: "wexford", type: "acute-hospital", county: "Wexford", region: "Ireland East Hospital Group", address: "Newtown Road, Wexford", phone: "+353 53 915 3000", has_ed: true, trauma_level: "trauma-unit", url: "https://www.hse.ie" },

  // ─── South ────────────────────────────────────────────────────────
  { name: "University Hospital Waterford", slug: "waterford", type: "acute-hospital", county: "Waterford", region: "South/South West Hospital Group", address: "Dunmore Road, Waterford", phone: "+353 51 848 000", has_ed: true, trauma_level: "trauma-unit", url: "https://www.hse.ie" },
  { name: "Tipperary University Hospital", slug: "clonmel", type: "acute-hospital", county: "Tipperary", region: "South/South West Hospital Group", address: "Western Road, Clonmel, Co Tipperary", phone: "+353 52 617 7000", has_ed: true, trauma_level: "trauma-unit", url: "https://www.hse.ie" },
  { name: "Cork University Hospital", slug: "cuh", type: "acute-hospital", county: "Cork", region: "South/South West Hospital Group", address: "Wilton, Cork", phone: "+353 21 492 2000", has_ed: true, trauma_level: "major-trauma", url: "https://www.hse.ie" },
  { name: "Mercy University Hospital", slug: "mercy-cork", type: "acute-hospital", county: "Cork", region: "South/South West Hospital Group", address: "Grenville Place, Cork", phone: "+353 21 427 1971", has_ed: true, trauma_level: "trauma-unit", url: "https://www.muh.ie" },
  { name: "Bantry General Hospital", slug: "bantry", type: "acute-hospital", county: "Cork", region: "South/South West Hospital Group", address: "Bantry, Co Cork", phone: "+353 27 52900", has_ed: true, trauma_level: "trauma-unit", url: "https://www.hse.ie" },
  { name: "Mallow General Hospital", slug: "mallow", type: "injury-unit", county: "Cork", region: "South/South West Hospital Group", address: "Mallow, Co Cork", phone: "+353 22 58000", has_ed: false, trauma_level: "injury-unit", url: "https://www.hse.ie" },
  { name: "University Hospital Kerry", slug: "tralee", type: "acute-hospital", county: "Kerry", region: "South/South West Hospital Group", address: "Ratass, Tralee, Co Kerry", phone: "+353 66 718 4000", has_ed: true, trauma_level: "trauma-unit", url: "https://www.hse.ie" },

  // ─── West / Mid-West ──────────────────────────────────────────────
  { name: "University Hospital Limerick", slug: "uhl", type: "acute-hospital", county: "Limerick", region: "UL Hospitals Group", address: "Dooradoyle, Limerick", phone: "+353 61 301 111", has_ed: true, trauma_level: "trauma-unit", url: "https://www.hse.ie" },
  { name: "St John's Hospital Limerick", slug: "st-johns-limerick", type: "injury-unit", county: "Limerick", region: "UL Hospitals Group", address: "St John's Square, Limerick", phone: "+353 61 415 822", has_ed: false, trauma_level: "injury-unit", url: "https://www.hse.ie" },
  { name: "Ennis Hospital", slug: "ennis", type: "injury-unit", county: "Clare", region: "UL Hospitals Group", address: "Gort Road, Ennis, Co Clare", phone: "+353 65 686 3100", has_ed: false, trauma_level: "injury-unit", url: "https://www.hse.ie" },
  { name: "Nenagh Hospital", slug: "nenagh", type: "injury-unit", county: "Tipperary", region: "UL Hospitals Group", address: "Tyone, Nenagh, Co Tipperary", phone: "+353 67 31491", has_ed: false, trauma_level: "injury-unit", url: "https://www.hse.ie" },
  { name: "Galway University Hospital", slug: "guh", type: "acute-hospital", county: "Galway", region: "Saolta University Health Care Group", address: "Newcastle Road, Galway", phone: "+353 91 524 222", has_ed: true, trauma_level: "trauma-unit", url: "https://www.saolta.ie" },
  { name: "Portiuncula University Hospital", slug: "portiuncula", type: "acute-hospital", county: "Galway", region: "Saolta University Health Care Group", address: "Ballinasloe, Co Galway", phone: "+353 90 964 8200", has_ed: true, trauma_level: "trauma-unit", url: "https://www.saolta.ie" },
  { name: "Mayo University Hospital", slug: "mayo", type: "acute-hospital", county: "Mayo", region: "Saolta University Health Care Group", address: "Castlebar, Co Mayo", phone: "+353 94 902 1733", has_ed: true, trauma_level: "trauma-unit", url: "https://www.saolta.ie" },
  { name: "Roscommon University Hospital", slug: "roscommon", type: "injury-unit", county: "Roscommon", region: "Saolta University Health Care Group", address: "Roscommon Town, Co Roscommon", phone: "+353 90 662 6200", has_ed: false, trauma_level: "injury-unit", url: "https://www.saolta.ie" },

  // ─── North-West ───────────────────────────────────────────────────
  { name: "Sligo University Hospital", slug: "sligo", type: "acute-hospital", county: "Sligo", region: "Saolta University Health Care Group", address: "The Mall, Sligo", phone: "+353 71 917 1111", has_ed: true, trauma_level: "trauma-unit", url: "https://www.saolta.ie" },
  { name: "Letterkenny University Hospital", slug: "letterkenny", type: "acute-hospital", county: "Donegal", region: "Saolta University Health Care Group", address: "Kilmacrennan Road, Letterkenny, Co Donegal", phone: "+353 74 912 5888", has_ed: true, trauma_level: "trauma-unit", url: "https://www.saolta.ie" },
  { name: "Cavan General Hospital", slug: "cavan", type: "acute-hospital", county: "Cavan", region: "RCSI Hospital Group", address: "Lisdarn, Cavan", phone: "+353 49 437 6000", has_ed: true, trauma_level: "trauma-unit", url: "https://www.hse.ie" },
  { name: "Monaghan Hospital", slug: "monaghan", type: "injury-unit", county: "Monaghan", region: "RCSI Hospital Group", address: "Old Armagh Road, Monaghan", phone: "+353 47 81811", has_ed: false, trauma_level: "injury-unit", url: "https://www.hse.ie" },
];

const COUNTIES = Array.from(new Set(FACILITIES.map(f => f.county))).sort();

// ─── Helpers ──────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function formatFacility(f: Facility): string[] {
  const lines = [
    `  ${f.name}`,
    `    Type: ${f.type} | County: ${f.county}`,
    `    Address: ${f.address}`,
    `    Phone: ${f.phone}`,
  ];
  if (f.has_ed) lines.push(`    Emergency Department: 24/7`);
  if (f.trauma_level) lines.push(`    Trauma level: ${f.trauma_level}`);
  lines.push(`    Hospital group: ${f.region}`);
  lines.push(`    More info: ${f.url}`);
  return lines;
}

// ─── Tool Implementations ─────────────────────────────────────────────

async function listHospitals(county: string = "", edOnly: boolean = false, type: string = ""): Promise<string> {
  let results = FACILITIES.slice();
  if (county) {
    const c = norm(county);
    results = results.filter(f => norm(f.county) === c);
  }
  if (edOnly) results = results.filter(f => f.has_ed);
  if (type) {
    const t = norm(type);
    results = results.filter(f => norm(f.type).includes(t));
  }

  if (!results.length) return "No HSE facilities matched your criteria.";

  const title = `HSE facilities${county ? ` in Co ${county}` : ""}${edOnly ? " with 24/7 Emergency Departments" : ""} (${results.length}):`;
  const lines: string[] = [title, ""];
  for (const f of results) {
    for (const l of formatFacility(f)) lines.push(l);
    lines.push("");
  }
  return lines.join("\n");
}

async function searchHospitals(query: string, limit: number = 20): Promise<string> {
  const q = norm(query);
  if (!q) return "Please provide a search term.";
  const scored = FACILITIES
    .map(f => ({ f, hit: (norm(f.name).includes(q) ? 2 : 0) + (norm(f.county).includes(q) ? 1 : 0) + (norm(f.address).includes(q) ? 1 : 0) }))
    .filter(x => x.hit > 0)
    .sort((a, b) => b.hit - a.hit)
    .slice(0, Math.max(1, Math.min(limit, 50)));

  if (!scored.length) return `No HSE facility found matching "${query}".`;

  const lines: string[] = [`HSE facilities matching "${query}" (${scored.length}):`, ""];
  for (const { f } of scored) {
    for (const l of formatFacility(f)) lines.push(l);
    lines.push("");
  }
  return lines.join("\n");
}

async function listCounties(): Promise<string> {
  const lines: string[] = [`Counties with HSE acute/injury-unit facilities (${COUNTIES.length}):`, ""];
  for (const c of COUNTIES) {
    const count = FACILITIES.filter(f => f.county === c).length;
    const ed = FACILITIES.filter(f => f.county === c && f.has_ed).length;
    lines.push(`  ${c} — ${count} facility${count === 1 ? "" : "ies"}${ed ? ` (${ed} with 24/7 ED)` : ""}`);
  }
  return lines.join("\n");
}

async function findService(category: string, county: string = ""): Promise<string> {
  // HSE publishes a public service finder at hse.ie/eng/services/list/.
  // For GPs / pharmacies / community services we return the canonical HSE
  // search URL so users can refine in-browser. Tool returns a helpful
  // pointer rather than scraping the HSE website.
  const cat = (category || "").trim();
  const params = new URLSearchParams();
  if (cat) params.set("keyword", cat);
  if (county) params.set("county", county);
  const url = `https://www.hse.ie/eng/services/list/?${params.toString()}`;

  const lines: string[] = [
    `HSE Service Finder — ${cat || "all services"}${county ? ` in Co ${county}` : ""}`,
    "",
    "Live community service listings (GPs, pharmacies, mental-health teams, addiction services,",
    "primary-care centres, dental, disability, family resource centres) are maintained by the HSE",
    "and searchable at:",
    "",
    `  ${url}`,
    "",
    "This MCP can list HSE acute hospitals, emergency departments, injury units,",
    "maternity hospitals and paediatric hospitals directly — use list_hospitals or",
    "search_hospitals for those.",
  ];
  return lines.join("\n");
}

async function naturalLanguageQuery(query: string): Promise<string> {
  const q = norm(query);

  if (/\b(a\s*e|a&e|ae|emergency|ed|casualty|accident)\b/.test(q)) {
    return listHospitals("", true);
  }
  if (/\b(injury\s*unit|local\s*injury|minor\s*injury)\b/.test(q)) {
    return listHospitals("", false, "injury-unit");
  }
  if (/\b(maternity|birth|pregnan)\b/.test(q)) {
    return listHospitals("", false, "maternity");
  }
  if (/\b(child|paediatric|pediatric|kids)\b/.test(q)) {
    return listHospitals("", false, "paediatric");
  }
  if (/\b(gp|doctor|pharmac|mental|addiction|dental|community|primary\s*care)\b/.test(q)) {
    const catMatch = q.match(/gp|doctor|pharmac\w*|mental|addiction|dental|primary\s*care/);
    return findService(catMatch ? catMatch[0] : "");
  }
  if (/\b(count(y|ies)|location|region|area)\b/.test(q)) {
    return listCounties();
  }

  for (const county of COUNTIES) {
    if (q.includes(norm(county))) return listHospitals(county);
  }

  return searchHospitals(query);
}

// ─── MCP Tool Definitions ─────────────────────────────────────────────

const TOOLS = [
  {
    name: "query",
    description: "Natural-language query for HSE services. Ask about hospitals, emergency departments, injury units, maternity, paediatric, GPs, pharmacies etc.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'e.g. "nearest A&E in Cork", "injury units in Clare", "maternity hospitals Dublin"' },
      },
      required: ["query"],
    },
  },
  {
    name: "list_hospitals",
    description: "List HSE public acute hospitals, injury units, maternity and paediatric facilities. Optionally filter by county, type or 24/7 Emergency Department availability.",
    inputSchema: {
      type: "object",
      properties: {
        county: { type: "string", description: "Irish county, e.g. Dublin, Cork, Galway" },
        ed_only: { type: "boolean", description: "Only include facilities with a 24/7 Emergency Department" },
        type: { type: "string", description: "Filter by facility type: acute-hospital, injury-unit, maternity, paediatric" },
      },
      required: [],
    },
  },
  {
    name: "search_hospitals",
    description: "Free-text search across HSE facility names, addresses and counties.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term — hospital name, town or county" },
        limit: { type: "number", description: "Max results 1–50 (default 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_counties",
    description: "List all Irish counties that have at least one HSE acute hospital or injury unit, with facility counts.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "find_service",
    description: "Look up a non-hospital HSE service (GP practice, pharmacy, mental-health team, dentist, primary-care centre) and return the HSE Service Finder deep link.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Service category e.g. GP, pharmacy, mental health, dentist, primary care" },
        county: { type: "string", description: "Optional county filter" },
      },
      required: ["category"],
    },
  },
];

// ─── Tool Dispatch ────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "query":
      return naturalLanguageQuery(String(args.query ?? ""));
    case "list_hospitals":
      return listHospitals(
        String(args.county ?? ""),
        Boolean(args.ed_only ?? false),
        String(args.type ?? ""),
      );
    case "search_hospitals":
      return searchHospitals(String(args.query ?? ""), Number(args.limit ?? 20));
    case "list_counties":
      return listCounties();
    case "find_service":
      return findService(String(args.category ?? ""), String(args.county ?? ""));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP JSON-RPC Handler ─────────────────────────────────────────────

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
      name: "HSE Service Finder MCP",
      version: "1.0.0",
      description: "Locate HSE hospitals, emergency departments, injury units and health services across Ireland",
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
        serverInfo: { name: "HSE Service Finder MCP", version: "1.0.0" },
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

// ─── Worker Entry Point ───────────────────────────────────────────────

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/mcp" || pathname === "/mcp/") return handleMCP(request);

    if (pathname === "/health") {
      return json({ status: "ok", service: "HSE Service Finder MCP", version: "1.0.0" });
    }

    if (pathname === "/" || pathname === "") {
      return json({
        service: "HSE Service Finder MCP",
        mcp_endpoint: "/mcp",
        tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
      });
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
