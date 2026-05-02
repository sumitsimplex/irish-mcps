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

// API has no server-side filters — paginate via after_cursor to gather records
// for client-side filtering. Cap total scan to keep latency bounded.
const PAGE_SIZE = 1000;
const MAX_PAGES_FILTERED = 10; // up to 10,000 records scanned when filtering

async function fetchPaged(
  sort: string,
  matcher: ((r: any) => boolean) | null,
  needed: number,
  maxPages: number,
): Promise<{ matches: any[]; scanned: number; total: number; truncated: boolean }> {
  const matches: any[] = [];
  let scanned = 0;
  let total = 0;
  let cursor = "";
  let truncated = false;

  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = { limit: String(PAGE_SIZE), sort };
    if (cursor) params.after = cursor;
    const data = await apiGet("sales", params);
    const rows: any[] = data.data || [];
    total = data.metadata?.total_rows ?? total;
    scanned += rows.length;

    for (const r of rows) {
      if (!matcher || matcher(r)) matches.push(r);
      if (matches.length >= needed && !matcher) break;
    }

    if (!matcher && matches.length >= needed) break;
    cursor = data.metadata?.after_cursor || "";
    if (!cursor || rows.length < PAGE_SIZE) break;
    if (page === maxPages - 1) truncated = true;
  }

  return { matches, scanned, total, truncated };
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

// --- Daft.ie Asking Price Lookup ------------------------------------------
//
// Daft's public JSON gateway exposes a `terms` filter, but it appears to
// ignore free-text input and always returns featured listings. We instead
// scrape the slug-based search page (e.g. /property-for-sale/sandyford-dublin)
// and parse the embedded __NEXT_DATA__ JSON.
//
// Coverage is best for currently-listed or sale-agreed properties; delisted
// listings won't appear (Daft's sold archive lives on a separate route we
// don't touch).

interface DaftListing {
  id: number | string;
  title?: string;
  displayAddress?: string;
  abbreviatedPrice?: string;
  price?: string;
  seoFriendlyPath?: string;
  saleType?: string[];
  state?: string;
}

interface DaftSearchResult {
  listings: DaftListing[];
  matchedLocation: string | null; // null = slug fell back to ireland-wide featured
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

// Build progressively-shorter slug candidates by dropping tokens from the
// front (e.g. "12 main st sandyford dublin" → "main-st-sandyford-dublin"
// → "st-sandyford-dublin" → "sandyford-dublin" → "dublin"). Daft only
// recognises area/town/county slugs, not full addresses.
function slugCandidates(address: string): string[] {
  const tokens = address
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const slug = slugify(tokens.slice(i).join(" "));
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      candidates.push(slug);
    }
  }
  return candidates;
}

async function fetchDaftSearchPage(slug: string): Promise<DaftSearchResult> {
  const url = `https://www.daft.ie/property-for-sale/${slug}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 IrishMCP/1.0 (+https://irishmcp.ie)", "Accept": "text/html" },
    });
  } catch (e) {
    throw new Error(`Daft request failed: ${e instanceof Error ? e.message : "network error"}`);
  }
  if (!res.ok) throw new Error(`Daft returned ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return { listings: [], matchedLocation: null };

  let data: any;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return { listings: [], matchedLocation: null };
  }

  const pageProps = data?.props?.pageProps ?? {};
  const breadcrumbs: { displayValue: string }[] = pageProps.breadcrumbs ?? [];
  // 2 crumbs = "Home" + "Search Residential Property for Sale" only → slug didn't match.
  // 3+ crumbs = real location (e.g. "Sandyford Property for Sale").
  const matchedLocation =
    breadcrumbs.length >= 3 ? breadcrumbs[breadcrumbs.length - 1].displayValue : null;

  const rawListings: { listing?: DaftListing }[] = pageProps.listings ?? [];
  const listings = rawListings
    .map((l) => l.listing)
    .filter((l): l is DaftListing => !!l);

  return { listings, matchedLocation };
}

// Tries each slug candidate until one matches a real Daft location, then
// returns its listings. If none match, returns the last (Ireland-wide) result
// so callers can still attempt token-based filtering.
async function searchDaft(address: string, _pageSize = 5): Promise<DaftSearchResult> {
  const candidates = slugCandidates(address);
  if (candidates.length === 0) return { listings: [], matchedLocation: null };

  let lastResult: DaftSearchResult = { listings: [], matchedLocation: null };
  for (const slug of candidates) {
    const result = await fetchDaftSearchPage(slug);
    lastResult = result;
    if (result.matchedLocation) return result;
  }
  return lastResult;
}

// Extract a numeric euro value from a Daft price string.
// Examples: "€450,000", "AMV €450,000", "Sale Agreed", "POA", "€1.25m".
function parseDaftPrice(priceStr: string | undefined): number | null {
  if (!priceStr) return null;
  const s = priceStr.toLowerCase();
  if (/poa|application|on request/.test(s) && !/€|eur/.test(s)) return null;

  // Match "€X[,Xxx]+" or "€X.Xm"/"€Xk"
  const mMillion = priceStr.match(/€\s*([\d.]+)\s*m\b/i);
  if (mMillion) return Math.round(parseFloat(mMillion[1]) * 1_000_000);
  const mThousand = priceStr.match(/€\s*([\d.]+)\s*k\b/i);
  if (mThousand) return Math.round(parseFloat(mThousand[1]) * 1_000);
  const mPlain = priceStr.match(/€\s*([\d,]+)/);
  if (mPlain) {
    const n = parseInt(mPlain[1].replace(/,/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function daftStatus(listing: DaftListing): string {
  if (listing.saleType?.length) {
    if (listing.saleType.includes("Sale Agreed")) return "Sale Agreed";
    if (listing.saleType.includes("Sold")) return "Sold";
  }
  if (listing.state && /agreed/i.test(listing.state)) return "Sale Agreed";
  return "For Sale";
}

function daftUrl(listing: DaftListing): string {
  return listing.seoFriendlyPath
    ? `https://www.daft.ie${listing.seoFriendlyPath}`
    : `https://www.daft.ie/`;
}

// Score listings by token overlap with the query address. Returns sorted
// listings (best first) with their similarity score (0–1).
function rankByAddressOverlap(
  query: string,
  listings: DaftListing[],
): { listing: DaftListing; score: number }[] {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 1);
  const qTokens = new Set(norm(query));
  if (qTokens.size === 0) return listings.map((l) => ({ listing: l, score: 0 }));

  const scored = listings.map((l) => {
    const lTokens = new Set(norm(l.title || l.displayAddress || ""));
    let overlap = 0;
    for (const t of qTokens) if (lTokens.has(t)) overlap++;
    return { listing: l, score: overlap / qTokens.size };
  });
  return scored.sort((a, b) => b.score - a.score);
}

async function getAskingPrice(address: string): Promise<string> {
  const trimmed = address.trim();
  if (!trimmed) return "Please provide an address or area to look up.";

  let result: DaftSearchResult;
  try {
    result = await searchDaft(trimmed);
  } catch (e) {
    return `Could not reach Daft.ie right now (${e instanceof Error ? e.message : "unknown error"}). Try again shortly.`;
  }

  if (result.listings.length === 0) {
    return `No Daft.ie listings found matching "${trimmed}". Asking price is only available for currently-listed or recently sale-agreed properties.`;
  }

  // If the slug fell back to ireland-wide featured, only surface results that
  // actually share tokens with the query — otherwise we'd show unrelated featured listings.
  const ranked = rankByAddressOverlap(trimmed, result.listings);
  const filtered = result.matchedLocation
    ? ranked.slice(0, 5)
    : ranked.filter((r) => r.score >= 0.4).slice(0, 5);

  if (filtered.length === 0) {
    return `No Daft.ie listings found matching "${trimmed}". The address may not match a known Daft location, or the listing has been delisted post-sale.`;
  }

  const header = result.matchedLocation
    ? `Daft.ie listings near ${result.matchedLocation} matching "${trimmed}":`
    : `Daft.ie listings matching "${trimmed}":`;
  const lines: string[] = [header, ""];
  for (const { listing: l, score } of filtered) {
    const priceStr = l.abbreviatedPrice || l.price || "—";
    const numeric = parseDaftPrice(priceStr);
    const formatted = numeric ? formatPrice(numeric) : priceStr;
    const matchTag = score < 0.5 ? ` (match ~${Math.round(score * 100)}%)` : "";
    lines.push(`  ${formatted} — ${daftStatus(l)}${matchTag}`);
    lines.push(`    ${l.title || l.displayAddress || "Address unavailable"}`);
    lines.push(`    ${daftUrl(l)}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function compareAskingVsSold(address: string): Promise<string> {
  const trimmed = address.trim();
  if (!trimmed) return "Please provide an address to compare asking vs sold.";

  // 1. Find a sold record on PPR — search address as both county hint and location.
  const county = findCounty(trimmed);
  const location = extractLocation(trimmed, county) || trimmed;

  const matcher = (r: any) => {
    const addr = (r.address || "").toLowerCase();
    const cty = (r.county || "").toLowerCase();
    if (county && !cty.includes(county.toLowerCase())) return false;
    return addr.includes(location.toLowerCase());
  };

  let sold: any = null;
  try {
    const { matches } = await fetchPaged("date-desc", matcher, 1, MAX_PAGES_FILTERED);
    sold = matches[0] ?? null;
  } catch (e) {
    return `Could not reach the Property Price Register (${e instanceof Error ? e.message : "error"}).`;
  }

  // 2. Find an asking-price listing on Daft.
  let result: DaftSearchResult = { listings: [], matchedLocation: null };
  let daftError = "";
  try {
    result = await searchDaft(trimmed);
  } catch (e) {
    daftError = e instanceof Error ? e.message : "Daft lookup failed";
  }
  const ranked = rankByAddressOverlap(trimmed, result.listings);
  // Require ≥40% token overlap when slug fell back to ireland-wide featured.
  const minScore = result.matchedLocation ? 0.0 : 0.4;
  const best = ranked.length && ranked[0].score >= minScore ? ranked[0] : null;
  const askingNumeric = best ? parseDaftPrice(best.listing.abbreviatedPrice || best.listing.price) : null;
  const soldNumeric = sold ? parsePrice(sold.price_in_euros) : null;

  const lines: string[] = [`Asking vs Sold — "${trimmed}":`, ""];

  // Sold side
  if (sold && soldNumeric) {
    lines.push(`  Sold:    ${formatPrice(soldNumeric)} on ${sold.date_of_sale}`);
    lines.push(`           ${sold.address}, ${sold.county}${sold.eircode ? " " + sold.eircode : ""}`);
  } else {
    lines.push(`  Sold:    no PPR match found for this address`);
  }

  // Asking side
  if (best && askingNumeric) {
    lines.push(`  Asking:  ${formatPrice(askingNumeric)} (${daftStatus(best.listing)}, match ~${Math.round(best.score * 100)}%)`);
    lines.push(`           ${best.listing.title || best.listing.displayAddress || "—"}`);
    lines.push(`           ${daftUrl(best.listing)}`);
  } else if (daftError) {
    lines.push(`  Asking:  Daft lookup failed (${daftError})`);
  } else if (best && !askingNumeric) {
    lines.push(`  Asking:  ${best.listing.abbreviatedPrice || best.listing.price || "POA"} (no numeric price published)`);
    lines.push(`           ${daftUrl(best.listing)}`);
  } else {
    lines.push(`  Asking:  no Daft.ie listing found (often delisted post-sale)`);
  }

  // % diff
  if (askingNumeric && soldNumeric) {
    const diff = soldNumeric - askingNumeric;
    const pct = (diff / askingNumeric) * 100;
    const sign = diff >= 0 ? "+" : "";
    const direction = diff > 0 ? "above asking" : diff < 0 ? "below asking" : "at asking";
    lines.push("");
    lines.push(`  Δ:       ${sign}${formatPrice(Math.abs(diff)).replace("€", diff < 0 ? "-€" : "€")} (${sign}${pct.toFixed(1)}% ${direction})`);
  }

  return lines.join("\n");
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
  location = "",
): Promise<string> {
  const cappedLimit = Math.min(Math.max(limit, 1), 50);
  const needsFilter = !!county || !!location || minPrice > 0 || maxPrice > 0;

  const countyLower = county.toLowerCase();
  const locationLower = location.toLowerCase();

  const matcher = needsFilter
    ? (r: any) => {
        const addr = (r.address || "").toLowerCase();
        const cty = (r.county || "").toLowerCase();
        const eir = (r.eircode || "").toLowerCase();
        if (county && !cty.includes(countyLower)) return false;
        if (location && !addr.includes(locationLower) && !cty.includes(locationLower) && !eir.includes(locationLower)) return false;
        const p = parsePrice(r.price_in_euros);
        if (minPrice > 0 && p < minPrice) return false;
        if (maxPrice > 0 && p > maxPrice) return false;
        return true;
      }
    : null;

  const { matches, scanned, total, truncated } = await fetchPaged(
    sort,
    matcher,
    cappedLimit,
    needsFilter ? MAX_PAGES_FILTERED : 1,
  );

  const results = matches.slice(0, cappedLimit);

  if (!results.length) {
    const where = location || county;
    if (where) {
      const truncNote = truncated
        ? ` (scanned the ${scanned.toLocaleString()} most recent of ${total.toLocaleString()} total records — older sales may exist; try narrowing with a county)`
        : ` (scanned ${scanned.toLocaleString()} of ${total.toLocaleString()} records)`;
      return `No matching sales found for "${where}"${truncNote}.`;
    }
    return "No sales found matching your criteria.";
  }

  const scope = needsFilter
    ? truncated
      ? `${results.length} shown, ${matches.length}+ matches in ${scanned.toLocaleString()} most recent of ${total.toLocaleString()} total`
      : `${results.length} shown, ${matches.length} matches in ${scanned.toLocaleString()} scanned of ${total.toLocaleString()} total`
    : `${results.length} shown, ${total.toLocaleString()} total in register`;
  const lines: string[] = [`Property Sales (${scope}):`, ""];

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

async function getRecentSales(county = "", limit = 20, location = ""): Promise<string> {
  return searchSales(county, 0, 0, "date-desc", limit, location);
}

async function getMostExpensive(county = "", limit = 10, location = ""): Promise<string> {
  return searchSales(county, 0, 0, "price-desc", Math.min(limit, 20), location);
}

const NL_STOPWORDS = new Set([
  "a", "an", "and", "the", "in", "at", "on", "near", "around", "of", "for",
  "to", "from", "by", "with", "or", "any", "all", "some",
  "show", "find", "get", "give", "list", "me", "what", "are", "is",
  "recent", "latest", "newest", "oldest",
  "sale", "sales", "sold", "house", "houses", "home", "homes",
  "property", "properties", "apt", "apartment", "apartments", "flat", "flats",
  "expensive", "cheap", "cheapest", "highest", "lowest", "top", "bottom",
  "most", "least", "more", "less", "than", "over", "above", "under", "below",
  "max", "maximum", "min", "minimum", "between",
  "price", "prices", "euro", "euros", "k", "thousand", "million", "m",
  "co", "county",
]);

function extractLocation(query: string, county: string): string {
  // Strip price tokens, euro symbols, numbers, then remove stopwords + the matched county.
  const cleaned = query
    .toLowerCase()
    .replace(/€/g, " ")
    .replace(/\b\d[\d,]*\s*(?:k|thousand|million|m|euro|euros)?\b/g, " ")
    .replace(/[^a-z\s'-]/g, " ");
  const countyLower = county.toLowerCase();
  const tokens = cleaned
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t && !NL_STOPWORDS.has(t) && t !== countyLower);
  return tokens.join(" ").trim();
}

async function naturalLanguageQuery(query: string): Promise<string> {
  const q = query.toLowerCase();
  const county = findCounty(query);
  const location = extractLocation(query, county);

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
    return getMostExpensive(county, 10, location);
  }

  // Route: cheapest
  if (["cheap", "lowest", "bottom", "least"].some(kw => q.includes(kw))) {
    return searchSales(county, 0, 0, "price-asc", 20, location);
  }

  // Route: price filter
  if (minPrice || maxPrice) {
    return searchSales(county, minPrice, maxPrice, "date-desc", 20, location);
  }

  // Route: asking vs sold comparison
  if (/(vs|versus|compared|compare|against)\s+(asking|listed|listing)/.test(q) || /(asking).*(sold|sale)/.test(q) || /(sold).*(asking|listed)/.test(q)) {
    return compareAskingVsSold(location || query);
  }

  // Route: asking price lookup
  if (/asking\s*price|listed\s*price|listing\s*price|on\s*daft/.test(q)) {
    return getAskingPrice(location || query);
  }

  // Default: recent sales
  return getRecentSales(county, 20, location);
}

// --- MCP Tool Definitions --------------------------------------------------

const TOOLS = [
  {
    name: "query",
    description: "Natural language query for Irish property sales. Ask about recent sales, prices in a county, most expensive, asking prices on Daft.ie, or asking-vs-sold comparisons.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'e.g. "recent sales in Dublin", "most expensive in Cork", "houses under 300k in Galway", "asking price for 12 Main St Cork", "asking vs sold for 12 Main St Cork"' },
      },
      required: ["query"],
    },
  },
  {
    name: "get_recent_sales",
    description: "Get the most recent property sales, optionally filtered by county and/or town/area.",
    inputSchema: {
      type: "object",
      properties: {
        county: { type: "string", description: "County name e.g. Dublin, Cork, Galway (optional)" },
        location: { type: "string", description: "Town, area, street, or eircode prefix to match in the address (optional)" },
        limit: { type: "number", description: "Max results 1-50 (default 20)" },
      },
      required: [],
    },
  },
  {
    name: "get_most_expensive",
    description: "Get the most expensive property sales, optionally filtered by county and/or town/area.",
    inputSchema: {
      type: "object",
      properties: {
        county: { type: "string", description: "County name (optional)" },
        location: { type: "string", description: "Town, area, street, or eircode prefix to match in the address (optional)" },
        limit: { type: "number", description: "Max results 1-50 (default 10)" },
      },
      required: [],
    },
  },
  {
    name: "get_asking_price",
    description: "Look up asking/listed prices on Daft.ie for a given address or area. Best for currently-listed or sale-agreed properties — recently delisted ones may not appear.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Address, road, area, or eircode to search on Daft.ie" },
      },
      required: ["address"],
    },
  },
  {
    name: "compare_asking_vs_sold",
    description: "Compare a property's Daft.ie asking price with its Property Price Register sold price, including the % difference. Best when address matches a recently sale-agreed listing.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Address (street + town/area, optionally with county or eircode)" },
      },
      required: ["address"],
    },
  },
  {
    name: "search_sales",
    description: "Search property sales with filters for county, town/area, price range, and sorting. Town/area filter searches the address field (e.g. 'Monasterevin', 'Sandyford', 'D04').",
    inputSchema: {
      type: "object",
      properties: {
        county: { type: "string", description: "County name (optional)" },
        location: { type: "string", description: "Town, area, street, or eircode prefix to match in the address (optional)" },
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
      return getRecentSales(
        String(args.county ?? ""),
        Number(args.limit ?? 20),
        String(args.location ?? ""),
      );
    case "get_most_expensive":
      return getMostExpensive(
        String(args.county ?? ""),
        Number(args.limit ?? 10),
        String(args.location ?? ""),
      );
    case "get_asking_price":
      return getAskingPrice(String(args.address ?? ""));
    case "compare_asking_vs_sold":
      return compareAskingVsSold(String(args.address ?? ""));
    case "search_sales":
      return searchSales(
        String(args.county ?? ""),
        Number(args.min_price ?? 0),
        Number(args.max_price ?? 0),
        String(args.sort ?? "date-desc"),
        Number(args.limit ?? 20),
        String(args.location ?? ""),
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
