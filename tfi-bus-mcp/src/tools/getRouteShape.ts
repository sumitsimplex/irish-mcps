import type { DbClient } from "../db/client";
import { requireString, type ToolResult } from "./helpers";

export async function getRouteShape(db: DbClient, args: Record<string, unknown>): Promise<ToolResult> {
  const routeId = requireString(args, "route_id");
  const directionId = args.direction_id == null ? null : Number(args.direction_id);

  const { data: route, error: routeError } = await db.from("routes").select("route_id").eq("route_id", routeId).maybeSingle();
  if (routeError) throw new Error(routeError.message);
  if (!route) return { error: "Route not found", route_id: routeId };

  let tripQuery = db
    .from("trips")
    .select("shape_id")
    .eq("route_id", routeId)
    .not("shape_id", "is", null)
    .limit(1);
  if (directionId === 0 || directionId === 1) tripQuery = tripQuery.eq("direction_id", directionId);

  const { data: trip, error: tripError } = await tripQuery.maybeSingle();
  if (tripError) throw new Error(tripError.message);
  if (!trip?.shape_id) return { type: "LineString", coordinates: [] };

  const { data: points, error: pointsError } = await db
    .from("shapes")
    .select("shape_pt_lat, shape_pt_lon")
    .eq("shape_id", trip.shape_id)
    .order("shape_pt_sequence", { ascending: true });
  if (pointsError) throw new Error(pointsError.message);

  return {
    type: "LineString",
    coordinates: (points ?? []).map((point: { shape_pt_lon: number; shape_pt_lat: number }) => [
      point.shape_pt_lon,
      point.shape_pt_lat,
    ]),
  };
}
