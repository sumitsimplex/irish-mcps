#!/usr/bin/env node
// Downloads the NTA static GTFS schedule, extracts routes.txt + agency.txt,
// and writes src/routes.generated.json — a map keyed by route_id mapping
// to { short_name, agency_id, agency_name }.
//
// The realtime GTFS-R feed only references route_ids (e.g. "5576_119660").
// We need the static feed to recover the friendly route number ("46A") and
// the operating agency.
//
// Usage: npm run update-routes
// Override URL: GTFS_URL=https://... npm run update-routes

import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const GTFS_URL =
  process.env.GTFS_URL ?? "https://www.transportforireland.ie/transitData/Data/GTFS_Realtime.zip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "..", "src", "routes.generated.json");

function parseCsv(text) {
  // GTFS CSV: comma-separated, quoted fields may contain commas.
  // No embedded newlines per spec; quotes escaped by doubling.
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') inQuotes = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function main() {
  const work = join(tmpdir(), `nta-gtfs-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const zipPath = join(work, "gtfs.zip");

  console.log(`Fetching ${GTFS_URL}…`);
  const res = await fetch(GTFS_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  writeFileSync(zipPath, buf);
  console.log(`  ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  console.log("Extracting routes.txt + agency.txt…");
  execSync(`unzip -o -q "${zipPath}" routes.txt agency.txt -d "${work}"`, { stdio: "inherit" });

  const agencies = parseCsv(readFileSync(join(work, "agency.txt"), "utf8"));
  const routes = parseCsv(readFileSync(join(work, "routes.txt"), "utf8"));

  const agencyById = new Map();
  for (const a of agencies) {
    agencyById.set(a.agency_id, a.agency_name);
  }

  const map = {};
  let dublinBus = 0, busEireann = 0, other = 0;
  for (const r of routes) {
    const agencyName = agencyById.get(r.agency_id) ?? "";
    map[r.route_id] = {
      short_name: r.route_short_name || r.route_long_name || r.route_id,
      agency_id: r.agency_id,
      agency_name: agencyName,
    };
    const a = agencyName.toLowerCase();
    if (a.includes("dublin bus") || a === "go-ahead ireland") {
      // Dublin Bus and Go-Ahead Ireland both serve the Dublin Bus network branding;
      // categorise by exact name in worker, not here.
    }
    if (a.includes("dublin bus")) dublinBus++;
    else if (a.includes("bus éireann") || a.includes("bus eireann")) busEireann++;
    else other++;
  }

  rmSync(work, { recursive: true, force: true });

  const payload = {
    generated_at: new Date().toISOString(),
    source: GTFS_URL,
    route_count: routes.length,
    routes: map,
  };
  writeFileSync(OUT_PATH, JSON.stringify(payload));

  const sizeKb = (JSON.stringify(payload).length / 1024).toFixed(1);
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`  ${routes.length} routes (${dublinBus} Dublin Bus, ${busEireann} Bus Éireann, ${other} other) — ${sizeKb} KB`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
