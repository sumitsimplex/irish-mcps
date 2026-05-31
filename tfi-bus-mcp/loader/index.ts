import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { downloadGtfsZip } from "./download";
import { parseGtfsFile, type GtfsFile } from "./parse";
import { createLoaderClient, upsertBatch, type TableName } from "./upsert";

const BATCH_SIZE = 1000;

type LoadSpec = {
  file: GtfsFile;
  table: TableName;
  map: (row: Record<string, string>) => Record<string, unknown>;
  logEvery?: number;
};

function text(value: string | undefined): string | null {
  return value && value.length ? value : null;
}

function int(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function float(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function bool(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function gtfsDate(value: string | undefined): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

const LOAD_ORDER: LoadSpec[] = [
  {
    file: "agency.txt",
    table: "agencies",
    map: row => ({
      agency_id: row.agency_id,
      agency_name: row.agency_name,
      agency_url: text(row.agency_url),
      agency_timezone: text(row.agency_timezone),
    }),
  },
  {
    file: "routes.txt",
    table: "routes",
    map: row => ({
      route_id: row.route_id,
      agency_id: text(row.agency_id),
      route_short_name: text(row.route_short_name),
      route_long_name: text(row.route_long_name),
      route_type: int(row.route_type),
    }),
  },
  {
    file: "stops.txt",
    table: "stops",
    map: row => ({
      stop_id: row.stop_id,
      stop_name: row.stop_name,
      stop_lat: float(row.stop_lat),
      stop_lon: float(row.stop_lon),
    }),
  },
  {
    file: "trips.txt",
    table: "trips",
    map: row => ({
      trip_id: row.trip_id,
      route_id: row.route_id,
      service_id: row.service_id,
      trip_headsign: text(row.trip_headsign),
      direction_id: int(row.direction_id),
      shape_id: text(row.shape_id),
    }),
  },
  {
    file: "calendar.txt",
    table: "calendar",
    map: row => ({
      service_id: row.service_id,
      monday: bool(row.monday),
      tuesday: bool(row.tuesday),
      wednesday: bool(row.wednesday),
      thursday: bool(row.thursday),
      friday: bool(row.friday),
      saturday: bool(row.saturday),
      sunday: bool(row.sunday),
      start_date: gtfsDate(row.start_date),
      end_date: gtfsDate(row.end_date),
    }),
  },
  {
    file: "calendar_dates.txt",
    table: "calendar_dates",
    map: row => ({
      service_id: row.service_id,
      date: gtfsDate(row.date),
      exception_type: int(row.exception_type),
    }),
  },
  {
    file: "stop_times.txt",
    table: "stop_times",
    logEvery: 100000,
    map: row => ({
      trip_id: row.trip_id,
      stop_sequence: int(row.stop_sequence),
      stop_id: row.stop_id,
      arrival_time: text(row.arrival_time),
      departure_time: text(row.departure_time),
    }),
  },
  {
    file: "shapes.txt",
    table: "shapes",
    map: row => ({
      shape_id: row.shape_id,
      shape_pt_sequence: int(row.shape_pt_sequence),
      shape_pt_lat: float(row.shape_pt_lat),
      shape_pt_lon: float(row.shape_pt_lon),
    }),
  },
];

async function loadTable(supabase: ReturnType<typeof createLoaderClient>, zipPath: string, spec: LoadSpec): Promise<number> {
  let batch: Record<string, unknown>[] = [];
  let count = 0;

  await parseGtfsFile(zipPath, spec.file, async row => {
    batch.push(spec.map(row));
    count += 1;

    if (batch.length >= BATCH_SIZE) {
      await upsertBatch(supabase, spec.table, batch);
      batch = [];
    }

    if (spec.logEvery && count % spec.logEvery === 0) {
      console.log(`${spec.table}: ${count.toLocaleString()} rows loaded`);
    }
  });

  await upsertBatch(supabase, spec.table, batch);
  console.log(`${spec.table}: ${count.toLocaleString()} rows loaded`);
  return count;
}

async function main(): Promise<void> {
  const started = Date.now();
  const supabase = createLoaderClient();
  const workDir = join(tmpdir(), `tfi-gtfs-${Date.now()}`);
  await mkdir(workDir, { recursive: true });
  const zipPath = join(workDir, "GTFS_All.zip");

  try {
    console.log("Downloading and hashing GTFS_All.zip...");
    const zipHash = await downloadGtfsZip(zipPath);
    console.log(`GTFS zip SHA-256: ${zipHash}`);

    const { data: latest, error: metadataError } = await supabase
      .from("gtfs_metadata")
      .select("zip_hash")
      .order("loaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (metadataError) throw new Error(metadataError.message);

    if (latest?.zip_hash === zipHash) {
      console.log("GTFS data unchanged, skipping reload");
      return;
    }

    const rowCounts: Record<string, number> = {};
    for (const spec of LOAD_ORDER) {
      rowCounts[spec.table] = await loadTable(supabase, zipPath, spec);
    }

    const { error: insertError } = await supabase.from("gtfs_metadata").insert({
      zip_hash: zipHash,
      loaded_at: new Date().toISOString(),
      row_counts: rowCounts,
    });
    if (insertError) throw new Error(insertError.message);

    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`GTFS load complete in ${seconds}s`);
    console.log(JSON.stringify(rowCounts, null, 2));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
