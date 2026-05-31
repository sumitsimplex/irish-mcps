import type { DbClient } from "../db/client";
import { activeServiceIds, assertIsoDate, gtfsTimeToSeconds, one, requireString, type ToolResult } from "./helpers";

type StopTimeRow = {
  trip_id: string;
  stop_sequence: number;
  stop_id: string;
  departure_time: string | null;
  arrival_time: string | null;
  stops: { stop_name: string } | Array<{ stop_name: string }> | null;
};

export async function getTimetable(db: DbClient, args: Record<string, unknown>): Promise<ToolResult> {
  const routeId = requireString(args, "route_id");
  const date = requireString(args, "date");
  assertIsoDate(date);
  const directionId = args.direction_id == null ? null : Number(args.direction_id);

  const { data: route, error: routeError } = await db
    .from("routes")
    .select("route_id, route_short_name, route_long_name")
    .eq("route_id", routeId)
    .maybeSingle();
  if (routeError) throw new Error(routeError.message);
  if (!route) return { error: "Route not found", route_id: routeId };

  const serviceIds = await activeServiceIds(db, date);
  if (!serviceIds.length) {
    return { error: "No services on this date", date, suggestion: "Check calendar_dates for exceptions" };
  }

  let tripsQuery = db
    .from("trips")
    .select("trip_id, trip_headsign, direction_id")
    .eq("route_id", routeId)
    .in("service_id", serviceIds)
    .limit(200);
  if (directionId === 0 || directionId === 1) tripsQuery = tripsQuery.eq("direction_id", directionId);

  const { data: trips, error: tripsError } = await tripsQuery;
  if (tripsError) throw new Error(tripsError.message);
  if (!trips?.length) {
    return { ...route, date, direction_id: directionId, trips: [] };
  }

  const tripIds = trips.map((trip: { trip_id: string }) => trip.trip_id);
  const { data: stopTimes, error: stopTimesError } = await db
    .from("stop_times")
    .select("trip_id, stop_sequence, stop_id, departure_time, arrival_time, stops(stop_name)")
    .in("trip_id", tripIds)
    .order("trip_id")
    .order("stop_sequence", { ascending: true });
  if (stopTimesError) throw new Error(stopTimesError.message);

  const byTrip = new Map<string, StopTimeRow[]>();
  for (const row of (stopTimes ?? []) as unknown as StopTimeRow[]) {
    const rows = byTrip.get(row.trip_id) ?? [];
    rows.push(row);
    byTrip.set(row.trip_id, rows);
  }

  const resultTrips = trips
    .map((trip: { trip_id: string; trip_headsign: string | null }) => {
      const rows = byTrip.get(trip.trip_id) ?? [];
      return {
        trip_id: trip.trip_id,
        headsign: trip.trip_headsign,
        first_departure_seconds: gtfsTimeToSeconds(rows[0]?.departure_time),
        stops: rows.map(row => ({
          stop_id: row.stop_id,
          stop_name: one(row.stops)?.stop_name ?? "",
          departure_time: row.departure_time,
        })),
      };
    })
    .sort((a, b) => a.first_departure_seconds - b.first_departure_seconds)
    .map(({ first_departure_seconds: _firstDepartureSeconds, ...trip }) => trip);

  return {
    route_short_name: route.route_short_name,
    route_long_name: route.route_long_name,
    date,
    direction_id: directionId,
    trips: resultTrips,
  };
}
