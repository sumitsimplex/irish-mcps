import type { DbClient } from "../db/client";
import { requireString, type ToolResult } from "./helpers";

export async function getRoutesAtStop(db: DbClient, args: Record<string, unknown>): Promise<ToolResult> {
  const stopId = requireString(args, "stop_id");

  const { data: stop, error: stopError } = await db.from("stops").select("stop_id").eq("stop_id", stopId).maybeSingle();
  if (stopError) throw new Error(stopError.message);
  if (!stop) return { error: "Stop not found", stop_id: stopId };

  const { data, error } = await db.rpc("get_routes_at_stop_rpc", { p_stop_id: stopId });
  if (error) throw new Error(error.message);
  return data ?? [];
}
