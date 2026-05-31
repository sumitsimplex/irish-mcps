import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type TableName =
  | "agencies"
  | "routes"
  | "stops"
  | "trips"
  | "calendar"
  | "calendar_dates"
  | "stop_times"
  | "shapes";

const CONFLICT_TARGETS: Record<TableName, string> = {
  agencies: "agency_id",
  routes: "route_id",
  stops: "stop_id",
  trips: "trip_id",
  calendar: "service_id",
  calendar_dates: "service_id,date",
  stop_times: "trip_id,stop_sequence",
  shapes: "shape_id,shape_pt_sequence",
};

export function createLoaderClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

export async function upsertBatch(
  supabase: SupabaseClient,
  table: TableName,
  batch: Record<string, unknown>[],
): Promise<void> {
  if (!batch.length) return;
  const { error } = await supabase.from(table).upsert(batch, {
    onConflict: CONFLICT_TARGETS[table],
    ignoreDuplicates: false,
  });
  if (error) throw new Error(`${table} upsert failed: ${error.message}`);
}
