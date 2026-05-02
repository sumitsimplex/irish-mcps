/**
 * Eircode MCP — Cloudflare Worker
 * Implements MCP Streamable HTTP (JSON-RPC over POST)
 *
 * Tools:
 *   geocode_area       — Geocode an Irish place name via OSM Nominatim
 *   lookup_routing_key — Look up an Eircode routing key (e.g. D04, H91) in the bundled table
 *   resolve_location   — Smart resolver: accepts full Eircode, routing key, town name, or county
 *
 * Note: Full Eircode → door-level address lookup requires a paid licence from Eircode.ie.
 * This worker returns area-level location data only.
 */

const NOMINATIM_UA = "IrishMCP-Eircode/1.0 (+https://irishmcp.ie)";

// ─── Routing Key Table ────────────────────────────────────────────────────────

const ROUTING_KEYS: Record<string, { area: string; county: string; region: string; lat: number; lng: number }> = {
  // Dublin City Postal Districts
  "D01": { area: "Dublin 1 (City Centre North)", county: "Dublin", region: "Leinster", lat: 53.3478, lng: -6.2597 },
  "D02": { area: "Dublin 2 (City Centre South)", county: "Dublin", region: "Leinster", lat: 53.3394, lng: -6.2548 },
  "D03": { area: "Dublin 3 (Clontarf/Fairview)", county: "Dublin", region: "Leinster", lat: 53.3636, lng: -6.2291 },
  "D04": { area: "Dublin 4 (Ballsbridge/Donnybrook)", county: "Dublin", region: "Leinster", lat: 53.3285, lng: -6.2267 },
  "D05": { area: "Dublin 5 (Artane/Raheny)", county: "Dublin", region: "Leinster", lat: 53.3812, lng: -6.1967 },
  "D06": { area: "Dublin 6 (Ranelagh/Rathmines)", county: "Dublin", region: "Leinster", lat: 53.3214, lng: -6.2638 },
  "D06W": { area: "Dublin 6W (Templeogue/Terenure)", county: "Dublin", region: "Leinster", lat: 53.3081, lng: -6.2861 },
  "D07": { area: "Dublin 7 (Phibsborough/Cabra)", county: "Dublin", region: "Leinster", lat: 53.3564, lng: -6.2764 },
  "D08": { area: "Dublin 8 (Portobello/Kilmainham)", county: "Dublin", region: "Leinster", lat: 53.3336, lng: -6.2905 },
  "D09": { area: "Dublin 9 (Drumcondra/Glasnevin)", county: "Dublin", region: "Leinster", lat: 53.3756, lng: -6.2612 },
  "D10": { area: "Dublin 10 (Ballyfermot/Cherry Orchard)", county: "Dublin", region: "Leinster", lat: 53.3417, lng: -6.3639 },
  "D11": { area: "Dublin 11 (Finglas/Whitehall)", county: "Dublin", region: "Leinster", lat: 53.3881, lng: -6.2897 },
  "D12": { area: "Dublin 12 (Walkinstown/Crumlin)", county: "Dublin", region: "Leinster", lat: 53.3192, lng: -6.3122 },
  "D13": { area: "Dublin 13 (Baldoyle/Sutton)", county: "Dublin", region: "Leinster", lat: 53.3897, lng: -6.1506 },
  "D14": { area: "Dublin 14 (Dundrum/Churchtown)", county: "Dublin", region: "Leinster", lat: 53.2994, lng: -6.2547 },
  "D15": { area: "Dublin 15 (Blanchardstown/Castleknock)", county: "Dublin", region: "Leinster", lat: 53.3883, lng: -6.3811 },
  "D16": { area: "Dublin 16 (Rathfarnham/Knocklyon)", county: "Dublin", region: "Leinster", lat: 53.2847, lng: -6.2961 },
  "D17": { area: "Dublin 17 (Darndale/Coolock)", county: "Dublin", region: "Leinster", lat: 53.4014, lng: -6.2044 },
  "D18": { area: "Dublin 18 (Sandyford/Stillorgan)", county: "Dublin", region: "Leinster", lat: 53.2811, lng: -6.2147 },
  "D20": { area: "Dublin 20 (Palmerstown/Chapelizod)", county: "Dublin", region: "Leinster", lat: 53.3461, lng: -6.3769 },
  "D22": { area: "Dublin 22 (Clondalkin/Lucan)", county: "Dublin", region: "Leinster", lat: 53.3297, lng: -6.3944 },
  "D24": { area: "Dublin 24 (Tallaght/Firhouse)", county: "Dublin", region: "Leinster", lat: 53.2861, lng: -6.3522 },
  // Fingal (North County Dublin)
  "K32": { area: "Balbriggan", county: "Fingal", region: "Leinster", lat: 53.6097, lng: -6.1814 },
  "K36": { area: "Skerries/Rush", county: "Fingal", region: "Leinster", lat: 53.5836, lng: -6.1086 },
  "K56": { area: "Swords", county: "Fingal", region: "Leinster", lat: 53.4597, lng: -6.2178 },
  "K67": { area: "Malahide/Portmarnock", county: "Fingal", region: "Leinster", lat: 53.4508, lng: -6.1545 },
  "K78": { area: "Howth/Sutton", county: "Fingal", region: "Leinster", lat: 53.3900, lng: -6.0714 },
  // Dún Laoghaire-Rathdown
  "A94": { area: "Blackrock/Stillorgan", county: "Dún Laoghaire-Rathdown", region: "Leinster", lat: 53.3025, lng: -6.1847 },
  "A96": { area: "Foxrock/Carrickmines", county: "Dún Laoghaire-Rathdown", region: "Leinster", lat: 53.2739, lng: -6.1872 },
  // Wicklow
  "A63": { area: "Bray", county: "Wicklow", region: "Leinster", lat: 53.2006, lng: -6.1122 },
  "A67": { area: "Greystones", county: "Wicklow", region: "Leinster", lat: 53.1428, lng: -6.0644 },
  "A81": { area: "Arklow", county: "Wicklow", region: "Leinster", lat: 52.7969, lng: -6.1633 },
  "A98": { area: "Wicklow Town / Shankill", county: "Wicklow", region: "Leinster", lat: 52.9800, lng: -6.0428 },
  // Kildare
  "W12": { area: "Naas", county: "Kildare", region: "Leinster", lat: 53.2197, lng: -6.6642 },
  "W23": { area: "Kildare Town", county: "Kildare", region: "Leinster", lat: 53.1572, lng: -6.9097 },
  "W34": { area: "Newbridge/Curragh", county: "Kildare", region: "Leinster", lat: 53.1844, lng: -6.7914 },
  "W91": { area: "Celbridge/Leixlip", county: "Kildare", region: "Leinster", lat: 53.3386, lng: -6.5408 },
  // Meath
  "A41": { area: "Trim", county: "Meath", region: "Leinster", lat: 53.5556, lng: -6.7892 },
  "A42": { area: "Dunshaughlin/Dunboyne", county: "Meath", region: "Leinster", lat: 53.5136, lng: -6.5422 },
  "A82": { area: "Ashbourne", county: "Meath", region: "Leinster", lat: 53.5128, lng: -6.3989 },
  "A85": { area: "Laytown/Bettystown", county: "Meath", region: "Leinster", lat: 53.6922, lng: -6.2444 },
  "A86": { area: "Drogheda (south)/Meath border", county: "Meath", region: "Leinster", lat: 53.7186, lng: -6.3561 },
  "C15": { area: "Navan", county: "Meath", region: "Leinster", lat: 53.6519, lng: -6.6853 },
  // Louth
  "A75": { area: "Dundalk", county: "Louth", region: "Leinster", lat: 54.0011, lng: -6.4022 },
  "A91": { area: "Drogheda", county: "Louth", region: "Leinster", lat: 53.7186, lng: -6.3561 },
  "A92": { area: "Ardee/Louth", county: "Louth", region: "Leinster", lat: 53.8578, lng: -6.5408 },
  // Longford
  "N39": { area: "Longford Town", county: "Longford", region: "Leinster", lat: 53.7269, lng: -7.7986 },
  // Leitrim
  "N41": { area: "Carrick-on-Shannon", county: "Leitrim", region: "Connacht", lat: 53.9428, lng: -8.0917 },
  // Westmeath
  "N37": { area: "Athlone", county: "Westmeath", region: "Leinster", lat: 53.4239, lng: -7.9403 },
  "N91": { area: "Mullingar", county: "Westmeath", region: "Leinster", lat: 53.5256, lng: -7.3364 },
  // Offaly
  "R35": { area: "Tullamore", county: "Offaly", region: "Leinster", lat: 53.2744, lng: -7.4939 },
  "R42": { area: "Birr", county: "Offaly", region: "Leinster", lat: 53.0967, lng: -7.9139 },
  // Laois
  "R14": { area: "Portarlington", county: "Laois", region: "Leinster", lat: 53.1614, lng: -7.1889 },
  "R32": { area: "Portlaoise", county: "Laois", region: "Leinster", lat: 53.0347, lng: -7.3003 },
  // Carlow
  "R21": { area: "Carlow Town", county: "Carlow", region: "Leinster", lat: 52.8406, lng: -6.9261 },
  // Kilkenny
  "R95": { area: "Kilkenny City", county: "Kilkenny", region: "Leinster", lat: 52.6543, lng: -7.2530 },
  // Wexford
  "Y21": { area: "Wexford Town", county: "Wexford", region: "Leinster", lat: 52.3358, lng: -6.4597 },
  "Y25": { area: "Enniscorthy", county: "Wexford", region: "Leinster", lat: 52.5019, lng: -6.5617 },
  "Y34": { area: "New Ross", county: "Wexford", region: "Leinster", lat: 52.3944, lng: -6.9436 },
  "Y35": { area: "Gorey", county: "Wexford", region: "Leinster", lat: 52.6742, lng: -6.2947 },
  // Waterford
  "X35": { area: "Waterford City", county: "Waterford", region: "Munster", lat: 52.2597, lng: -7.1101 },
  "X42": { area: "Dungarvan", county: "Waterford", region: "Munster", lat: 52.0933, lng: -7.6219 },
  "X91": { area: "Waterford City (east)", county: "Waterford", region: "Munster", lat: 52.2561, lng: -7.0994 },
  // Tipperary
  "E25": { area: "Tipperary Town", county: "Tipperary", region: "Munster", lat: 52.4733, lng: -8.1553 },
  "E32": { area: "Cashel", county: "Tipperary", region: "Munster", lat: 52.5222, lng: -7.8894 },
  "E34": { area: "Nenagh", county: "Tipperary", region: "Munster", lat: 52.8617, lng: -8.1944 },
  "E41": { area: "Clonmel", county: "Tipperary", region: "Munster", lat: 52.3547, lng: -7.7028 },
  "E45": { area: "Thurles", county: "Tipperary", region: "Munster", lat: 52.6828, lng: -7.8033 },
  "E53": { area: "Roscrea", county: "Tipperary", region: "Munster", lat: 52.9556, lng: -7.7983 },
  "E91": { area: "Templemore", county: "Tipperary", region: "Munster", lat: 52.7939, lng: -7.8336 },
  // Cork
  "T12": { area: "Cork City", county: "Cork", region: "Munster", lat: 51.8985, lng: -8.4756 },
  "T23": { area: "Midleton/East Cork", county: "Cork", region: "Munster", lat: 51.9139, lng: -8.1706 },
  "T34": { area: "Cobh/South Cork", county: "Cork", region: "Munster", lat: 51.8503, lng: -8.2972 },
  "P12": { area: "Macroom/West Cork", county: "Cork", region: "Munster", lat: 51.9042, lng: -8.9622 },
  "P14": { area: "Clonakilty", county: "Cork", region: "Munster", lat: 51.6236, lng: -8.8897 },
  "P17": { area: "Bandon", county: "Cork", region: "Munster", lat: 51.7472, lng: -8.7428 },
  "P24": { area: "Skibbereen", county: "Cork", region: "Munster", lat: 51.5536, lng: -9.2619 },
  "P25": { area: "Bantry", county: "Cork", region: "Munster", lat: 51.6842, lng: -9.4558 },
  "P31": { area: "Mallow", county: "Cork", region: "Munster", lat: 52.1356, lng: -8.6467 },
  "P43": { area: "Fermoy", county: "Cork", region: "Munster", lat: 52.1378, lng: -8.2728 },
  "P51": { area: "Charleville", county: "Cork", region: "Munster", lat: 52.3561, lng: -8.6908 },
  "P61": { area: "Youghal", county: "Cork", region: "Munster", lat: 51.9511, lng: -7.8586 },
  "P72": { area: "Kinsale", county: "Cork", region: "Munster", lat: 51.7064, lng: -8.5214 },
  "P81": { area: "Carrigaline/Douglas", county: "Cork", region: "Munster", lat: 51.8236, lng: -8.3944 },
  "P85": { area: "Passage West/Monkstown", county: "Cork", region: "Munster", lat: 51.8703, lng: -8.3394 },
  // Limerick
  "V94": { area: "Limerick City", county: "Limerick", region: "Munster", lat: 52.6638, lng: -8.6267 },
  "V35": { area: "Rathkeale/West Limerick", county: "Limerick", region: "Munster", lat: 52.5217, lng: -8.9461 },
  "V42": { area: "Newcastle West", county: "Limerick", region: "Munster", lat: 52.4489, lng: -9.0569 },
  // Clare
  "V14": { area: "Shannon", county: "Clare", region: "Munster", lat: 52.7017, lng: -8.8775 },
  "V95": { area: "Ennis", county: "Clare", region: "Munster", lat: 52.8439, lng: -8.9833 },
  // Kerry
  "V31": { area: "Listowel", county: "Kerry", region: "Munster", lat: 52.4461, lng: -9.4833 },
  "V92": { area: "Killarney", county: "Kerry", region: "Munster", lat: 52.0597, lng: -9.5044 },
  "V93": { area: "Tralee", county: "Kerry", region: "Munster", lat: 52.2703, lng: -9.7033 },
  // Galway
  "H23": { area: "Ballinasloe", county: "Galway", region: "Connacht", lat: 53.3308, lng: -8.2222 },
  "H54": { area: "Tuam", county: "Galway", region: "Connacht", lat: 53.5136, lng: -8.8539 },
  "H91": { area: "Galway City", county: "Galway", region: "Connacht", lat: 53.2719, lng: -9.0489 },
  // Mayo
  "F12": { area: "Castlebar", county: "Mayo", region: "Connacht", lat: 53.8569, lng: -9.2994 },
  "F23": { area: "Westport", county: "Mayo", region: "Connacht", lat: 53.8011, lng: -9.5189 },
  "F26": { area: "Ballina", county: "Mayo", region: "Connacht", lat: 54.1147, lng: -9.1608 },
  "F28": { area: "Ballinrobe", county: "Mayo", region: "Connacht", lat: 53.6292, lng: -9.2197 },
  "F31": { area: "Claremorris", county: "Mayo", region: "Connacht", lat: 53.7189, lng: -8.9808 },
  // Roscommon
  "F42": { area: "Roscommon Town", county: "Roscommon", region: "Connacht", lat: 53.6336, lng: -8.1897 },
  "F45": { area: "Boyle", county: "Roscommon", region: "Connacht", lat: 53.9742, lng: -8.2975 },
  // Sligo
  "F91": { area: "Sligo Town", county: "Sligo", region: "Connacht", lat: 54.2728, lng: -8.4761 },
  // Cavan
  "H12": { area: "Cavan Town", county: "Cavan", region: "Ulster", lat: 53.9908, lng: -7.3603 },
  // Monaghan
  "H18": { area: "Monaghan Town", county: "Monaghan", region: "Ulster", lat: 54.2497, lng: -6.9683 },
  // Donegal
  "F92": { area: "Letterkenny", county: "Donegal", region: "Ulster", lat: 54.9558, lng: -7.7333 },
  "F93": { area: "Donegal Town", county: "Donegal", region: "Ulster", lat: 54.6536, lng: -8.1097 },
  "F94": { area: "Bundoran/South Donegal", county: "Donegal", region: "Ulster", lat: 54.4778, lng: -8.2875 },
};

// ─── Letter-prefix → county hints (for helpful not-found messages) ────────────
const PREFIX_HINTS: Record<string, string> = {
  A: "Wicklow, Meath, or Louth",
  C: "Meath (Navan area)",
  D: "Dublin City postal districts",
  E: "Tipperary",
  F: "Mayo, Roscommon, Sligo, Cavan, or Donegal",
  H: "Galway, Cavan, or Monaghan",
  K: "Fingal (North County Dublin)",
  N: "Longford, Leitrim, or Westmeath",
  P: "Cork (west/south)",
  R: "Offaly, Laois, Carlow, or Kilkenny",
  T: "Cork City/East Cork",
  V: "Limerick, Clare, or Kerry",
  W: "Kildare",
  X: "Waterford",
  Y: "Wexford",
};

// ─── Tool Implementations ─────────────────────────────────────────────────────

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  importance: number;
}

async function geocodeArea(area: string): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(area + ", Ireland")}&format=json&limit=3&countrycodes=ie`;
  const res = await fetch(url, {
    headers: { "User-Agent": NOMINATIM_UA },
  });
  if (!res.ok) throw new Error(`Nominatim API error: ${res.status}`);
  const results = await res.json() as NominatimResult[];
  if (!results.length) {
    return `No results found for "${area}" in Ireland. Try a different spelling or a nearby town name.`;
  }
  const lines = [`Found ${results.length} result(s) for "${area}":`, ""];
  for (const r of results) {
    lines.push(`  Name: ${r.display_name}`);
    lines.push(`  Lat: ${r.lat}, Lon: ${r.lon}`);
    lines.push(`  Type: ${r.type} | Importance: ${r.importance.toFixed(4)}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function lookupRoutingKey(rawKey: string): string {
  const key = rawKey.trim().toUpperCase();
  const entry = ROUTING_KEYS[key];
  if (entry) {
    return JSON.stringify({
      routing_key: key,
      area: entry.area,
      county: entry.county,
      region: entry.region,
      lat: entry.lat,
      lng: entry.lng,
    });
  }
  // Build a helpful not-found message
  const prefix = key.slice(0, 1).toUpperCase();
  const hint = PREFIX_HINTS[prefix];
  const hintText = hint
    ? ` The letter prefix "${prefix}" typically covers ${hint}.`
    : "";
  return JSON.stringify({
    error: `Routing key "${key}" not found in the bundled table.${hintText} Only major town-level routing keys are included; more specific keys exist for rural sub-areas. Try resolve_location with the full area name for a geocoded result.`,
  });
}

/**
 * Detect whether `input` looks like a full 7-character Eircode (e.g. "A65 F4E2").
 * Format: [A-Z][0-9]{1,2}[W]? + space + [A-Z0-9]{4}
 */
function looksLikeFullEircode(input: string): boolean {
  return /^[A-Z]\d{1,2}W?\s+[A-Z0-9]{4}$/i.test(input.trim());
}

/**
 * Detect whether `input` looks like a bare routing key (3–4 alphanumeric chars).
 * Examples: D04, H91, D06W, K32
 */
function looksLikeRoutingKey(input: string): boolean {
  return /^[A-Z]\d{2}W?$/i.test(input.trim());
}

async function resolveLocation(location: string): Promise<string> {
  const trimmed = location.trim();

  // Case 1: full Eircode — extract the routing key (first 3 chars, or 4 if ends in W)
  if (looksLikeFullEircode(trimmed)) {
    const raw = trimmed.replace(/\s+.*$/, ""); // strip unique identifier part
    // routing key is up to the first space — could be 3 chars (X99) or 4 chars (D06W)
    const rk = raw.toUpperCase();
    const entry = ROUTING_KEYS[rk];
    if (entry) {
      return JSON.stringify({
        location_type: "full_eircode",
        resolved_name: entry.area,
        county: entry.county,
        region: entry.region,
        lat: entry.lat,
        lng: entry.lng,
        routing_key: rk,
        note: "Full Eircode → door-level address requires a paid licence from Eircode.ie. Area-level data shown.",
      });
    }
    // Routing key not in table — still return what we know
    return JSON.stringify({
      location_type: "full_eircode",
      routing_key: rk,
      note: `Routing key "${rk}" is not in the bundled area table. Full Eircode → door-level address requires a paid licence from Eircode.ie.`,
    });
  }

  // Case 2: routing key (e.g. D04, H91, D06W)
  if (looksLikeRoutingKey(trimmed)) {
    const rk = trimmed.toUpperCase();
    const entry = ROUTING_KEYS[rk];
    if (entry) {
      return JSON.stringify({
        location_type: "routing_key",
        resolved_name: entry.area,
        county: entry.county,
        region: entry.region,
        lat: entry.lat,
        lng: entry.lng,
        routing_key: rk,
      });
    }
    const prefix = rk.slice(0, 1);
    const hint = PREFIX_HINTS[prefix];
    return JSON.stringify({
      location_type: "routing_key",
      routing_key: rk,
      error: `Routing key "${rk}" not found.${hint ? ` Prefix "${prefix}" typically covers ${hint}.` : ""}`,
    });
  }

  // Case 3: place name, county, or Dublin district — geocode via Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmed + ", Ireland")}&format=json&limit=1&countrycodes=ie`;
    const res = await fetch(url, { headers: { "User-Agent": NOMINATIM_UA } });
    if (!res.ok) throw new Error(`Nominatim error: ${res.status}`);
    const results = await res.json() as NominatimResult[];
    if (!results.length) {
      return JSON.stringify({
        location_type: "place_name",
        error: `No geocode result found for "${trimmed}" in Ireland. Try a more specific name or provide a routing key.`,
      });
    }
    const r = results[0];
    return JSON.stringify({
      location_type: "place_name",
      resolved_name: r.display_name,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      osm_type: r.type,
    });
  } catch (e) {
    throw new Error(`Geocoding failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── MCP Tool Definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "geocode_area",
    description:
      "Geocode an Irish town, county, Dublin district, or area description using OpenStreetMap Nominatim. Returns up to 3 matching locations with coordinates. Note: returns area-level data only — full Eircode → door address requires a paid Eircode.ie licence.",
    inputSchema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          description: 'Area to geocode, e.g. "Galway", "Cork City", "Dublin 4", "Killarney", "County Wicklow"',
        },
      },
      required: ["area"],
    },
  },
  {
    name: "lookup_routing_key",
    description:
      "Look up an Eircode routing key (first 3–4 characters of an Eircode, e.g. D04, H91, T12, D06W) in the bundled area table. Returns the area name, county, province/region, and approximate centre coordinates. Note: returns area-level data only — full Eircode → door address requires a paid Eircode.ie licence.",
    inputSchema: {
      type: "object",
      properties: {
        routing_key: {
          type: "string",
          description: 'Eircode routing key, e.g. "D04", "H91", "T12", "D06W", "V94"',
        },
      },
      required: ["routing_key"],
    },
  },
  {
    name: "resolve_location",
    description:
      "Smart location resolver for Ireland. Accepts ANYTHING: a full Eircode (A65 F4E2), a routing key (D04), a town name (Galway), a county (Cork), or a Dublin district (Dublin 4). Automatically detects the input type and routes to the appropriate lookup. Note: returns area-level data only — full Eircode → door address requires a paid Eircode.ie licence.",
    inputSchema: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description:
            'Any Irish location: full Eircode (e.g. "A65 F4E2"), routing key (e.g. "D04"), town name (e.g. "Galway"), county (e.g. "Cork"), or Dublin district (e.g. "Dublin 4")',
        },
      },
      required: ["location"],
    },
  },
];

// ─── Tool Dispatch ────────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "geocode_area":
      return geocodeArea(String(args.area ?? ""));
    case "lookup_routing_key":
      return lookupRoutingKey(String(args.routing_key ?? ""));
    case "resolve_location":
      return resolveLocation(String(args.location ?? ""));
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
      name: "Eircode MCP",
      version: "1.0.0",
      description: "Eircode routing key lookup and Irish geocoding via MCP",
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
        serverInfo: { name: "Eircode MCP", version: "1.0.0" },
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
      return json({ status: "ok", service: "Eircode MCP", version: "1.0.0" });
    }

    if (pathname === "/" || pathname === "") {
      return json({
        service: "Eircode MCP",
        mcp_endpoint: "/mcp",
        tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
      });
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
