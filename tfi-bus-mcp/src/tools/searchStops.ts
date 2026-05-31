import type { DbClient } from "../db/client";
import { clamp, optionalNumber, type ToolResult } from "./helpers";

export async function searchStops(db: DbClient, args: Record<string, unknown>): Promise<ToolResult> {
  const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : null;
  const lat = optionalNumber(args, "lat") ?? null;
  const lon = optionalNumber(args, "lon") ?? null;
  const radiusKm = optionalNumber(args, "radius_km");
  const radiusM = radiusKm == null ? null : clamp(radiusKm, 0.05, 50) * 1000;

  if (!query && (lat == null || lon == null || radiusM == null)) {
    throw new Error("Provide query or lat, lon and radius_km.");
  }

  const { data, error } = await db.rpc("search_stops_rpc", {
    p_query: query,
    p_lat: lat,
    p_lon: lon,
    p_radius_m: radiusM,
    p_limit: 20,
  });

  if (error) throw new Error(error.message);
  return data ?? [];
}
