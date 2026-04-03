/**
 * Oireachtas Debates MCP — Cloudflare Worker
 * Implements MCP Streamable HTTP (JSON-RPC over POST)
 * Data source: Oireachtas Open Data API (api.oireachtas.ie)
 */

const BASE = "https://api.oireachtas.ie/v1";

// ─── Oireachtas API ──────────────────────────────────────────────────────────

async function apiGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)" },
  });
  if (!res.ok) throw new Error(`Oireachtas API error: ${res.status}`);
  return res.json();
}

// ─── Tool Implementations ─────────────────────────────────────────────────────

async function searchLegislation(query: string = "", billStatus: string = "", limit: number = 10): Promise<string> {
  const params: Record<string, string> = { limit: String(Math.min(limit, 50)) };
  if (query) params.bill_no = query;
  if (billStatus) params.bill_status = billStatus;
  const data = await apiGet("legislation", params);
  const results: any[] = data.results || [];
  const total = data.head?.counts?.billCount ?? "?";

  if (!results.length) return "No legislation found matching your criteria.";

  const lines: string[] = [`Legislation (${results.length} of ${total} total):`, ""];
  for (const r of results) {
    const bill = r.bill || {};
    const title = bill.shortTitleEn || "Untitled";
    const billNo = bill.billNo || "?";
    const year = bill.billYear || "?";
    const status = bill.status || "?";
    const source = bill.source || "?";
    const billType = bill.billType || "?";
    const origin = bill.originHouse || {};
    const originName = typeof origin === "object" ? (origin.showAs || "?") : String(origin);

    lines.push(`  ${title} (Bill No. ${billNo}/${year})`);
    lines.push(`    Status: ${status} | Type: ${billType} | Source: ${source}`);
    lines.push(`    Origin: ${originName}`);

    const sponsors: any[] = bill.sponsors || [];
    if (sponsors.length) {
      const sponsorNames: string[] = [];
      for (const s of sponsors.slice(0, 3)) {
        const sp = s.sponsor || {};
        const by = sp.by || {};
        const name = typeof by === "object" ? (by.showAs || "") : String(by);
        if (name) sponsorNames.push(name);
      }
      if (sponsorNames.length) {
        lines.push(`    Sponsors: ${sponsorNames.join(", ")}`);
      }
    }

    const stage = bill.mostRecentStage || {};
    if (stage) {
      const event = stage.event || {};
      const stageUri = typeof event === "object" ? (event.showAs || "") : "";
      if (stageUri) lines.push(`    Latest stage: ${stageUri}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function searchMembers(name: string = "", limit: number = 20): Promise<string> {
  const params: Record<string, string> = { limit: String(Math.min(limit, 50)) };
  const data = await apiGet("members", params);
  let results: any[] = data.results || [];
  const total = data.head?.counts?.memberCount ?? "?";

  if (!results.length) return "No members found.";

  if (name) {
    const nameLower = name.toLowerCase();
    results = results.filter((r: any) =>
      (r.member?.fullName || "").toLowerCase().includes(nameLower)
    );
    if (!results.length) return `No members found matching "${name}".`;
  }

  const lines: string[] = [`Oireachtas Members (${results.length} shown, ${total} total):`, ""];
  for (const r of results) {
    const member = r.member || {};
    const fullName = member.fullName || "?";
    const memberships: any[] = member.memberships || [];

    const currentInfo: string[] = [];
    for (const ms of memberships) {
      const membership = ms.membership || {};
      const house = membership.house || {};
      const houseName = typeof house === "object" ? (house.showAs || "") : String(house);
      const represents: any[] = membership.represents || [];
      const repNames: string[] = [];
      for (const rep of represents) {
        const rObj = rep.represent || {};
        const rName = typeof rObj === "object" ? (rObj.showAs || "") : String(rObj);
        if (rName) repNames.push(rName);
      }
      const parties: any[] = membership.parties || [];
      const partyNames: string[] = [];
      for (const p of parties) {
        const pObj = p.party || {};
        const pName = typeof pObj === "object" ? (pObj.showAs || "") : String(pObj);
        if (pName) partyNames.push(pName);
      }
      const dateRange = membership.dateRange || {};
      const end = typeof dateRange === "object" ? dateRange.end : null;
      if (!end) {
        const infoParts: string[] = [];
        if (houseName) infoParts.push(houseName);
        if (repNames.length) infoParts.push(`(${repNames.join(", ")})`);
        if (partyNames.length) infoParts.push(`- ${partyNames[partyNames.length - 1]}`);
        currentInfo.push(infoParts.join(" "));
      }
    }

    lines.push(`  ${fullName}`);
    for (const info of currentInfo) {
      lines.push(`    ${info}`);
    }
    if (!currentInfo.length) {
      lines.push("    (historical member)");
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function searchDebates(dateStart: string = "", dateEnd: string = "", limit: number = 10): Promise<string> {
  const params: Record<string, string> = { limit: String(Math.min(limit, 50)) };
  if (dateStart) params.date_start = dateStart;
  if (dateEnd) params.date_end = dateEnd;
  const data = await apiGet("debates", params);
  const results: any[] = data.results || [];

  if (!results.length) return "No debates found for the given criteria.";

  const lines: string[] = [`Oireachtas Debates (${results.length} results):`, ""];
  for (const r of results) {
    const debate = r.debateRecord || r;
    const date = debate.date || debate.contextDate || "?";
    const house = debate.house || {};
    const houseName = typeof house === "object" ? (house.showAs || String(house)) : String(house);
    const chamber = debate.chamber || {};
    const chamberName = typeof chamber === "object" ? (chamber.showAs || "") : String(chamber);
    const sections: any[] = debate.debateSections || [];
    const counts = debate.counts || {};

    lines.push(`  ${date} — ${houseName}${chamberName ? " (" + chamberName + ")" : ""}`);
    if (counts) {
      lines.push(`    Speeches: ${counts.speechCount ?? "?"} | Contributors: ${counts.speakerCount ?? "?"}`);
    }

    if (sections.length) {
      const sectionTitles: string[] = [];
      for (const s of sections.slice(0, 5)) {
        const sec = s.debateSection || s;
        const title = sec.showAs || sec.title || "";
        if (title) sectionTitles.push(title);
      }
      if (sectionTitles.length) {
        lines.push(`    Topics: ${sectionTitles.join("; ")}`);
      }
    }

    const formats = debate.formats || {};
    if (formats) {
      const pdf = formats.pdf || {};
      if (pdf && typeof pdf === "object") {
        const pdfUri = pdf.uri || "";
        if (pdfUri) lines.push(`    PDF: ${pdfUri}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function naturalLanguageQuery(query: string): Promise<string> {
  const q = query.toLowerCase();

  if (["member", "td", "senator", "deputy", "minister"].some(kw => q.includes(kw))) {
    let name = query;
    for (const word of ["member", "TD", "Senator", "Deputy", "Minister", "who is", "find", "search", "?", "the"]) {
      name = name.replace(new RegExp(word, "gi"), "").trim();
    }
    return searchMembers(name || "");
  }

  if (["debate", "speech", "dáil", "dail", "seanad", "sitting", "session"].some(kw => q.includes(kw))) {
    return searchDebates();
  }

  if (["bill", "legislation", "act", "law", "passed", "enacted"].some(kw => q.includes(kw))) {
    return searchLegislation();
  }

  // Default: recent legislation
  return searchLegislation("", "", 10);
}

// ─── MCP Tool Definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "query",
    description: "Natural language query for Oireachtas data. Ask about legislation, members, or debates.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'e.g. "recent bills", "who is the TD for Dublin Bay South", "Dáil debates this week"' },
      },
      required: ["query"],
    },
  },
  {
    name: "search_legislation",
    description: "Search bills and acts in the Oireachtas. Filter by bill number or status.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Bill number or search term" },
        bill_status: { type: "string", description: "Filter by status e.g. Current, Enacted, Rejected, Withdrawn, Lapsed" },
        limit: { type: "number", description: "Max results 1–50 (default 10)" },
      },
      required: [],
    },
  },
  {
    name: "search_members",
    description: "Search Oireachtas members (TDs and Senators) by name.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Member name to search for" },
        limit: { type: "number", description: "Max results 1–50 (default 20)" },
      },
      required: [],
    },
  },
  {
    name: "search_debates",
    description: "Search Dáil and Seanad debate records by date range.",
    inputSchema: {
      type: "object",
      properties: {
        date_start: { type: "string", description: "Start date YYYY-MM-DD" },
        date_end: { type: "string", description: "End date YYYY-MM-DD" },
        limit: { type: "number", description: "Max results 1–50 (default 10)" },
      },
      required: [],
    },
  },
];

// ─── Tool Dispatch ────────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "query":
      return naturalLanguageQuery(String(args.query ?? "recent legislation"));
    case "search_legislation":
      return searchLegislation(
        String(args.query ?? ""),
        String(args.bill_status ?? ""),
        Number(args.limit ?? 10),
      );
    case "search_members":
      return searchMembers(String(args.name ?? ""), Number(args.limit ?? 20));
    case "search_debates":
      return searchDebates(
        String(args.date_start ?? ""),
        String(args.date_end ?? ""),
        Number(args.limit ?? 10),
      );
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
      name: "Oireachtas Debates MCP",
      version: "1.0.0",
      description: "Dáil and Seanad debates, bills, acts and member records",
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
        serverInfo: { name: "Oireachtas Debates MCP", version: "1.0.0" },
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
      return json({ status: "ok", service: "Oireachtas Debates MCP", version: "1.0.0" });
    }

    if (pathname === "/" || pathname === "") {
      return json({
        service: "Oireachtas Debates MCP",
        mcp_endpoint: "/mcp",
        tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
      });
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
