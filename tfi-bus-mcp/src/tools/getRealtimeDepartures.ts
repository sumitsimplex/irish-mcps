import type { DbClient, Env } from "../db/client";
import { epochToIso, fetchTripUpdates } from "../gtfs/realtime";
import { clamp, one, requireString, type ToolResult } from "./helpers";

export async function getRealtimeDepartures(db: DbClient, env: Env, args: Record<string, unknown>): Promise<ToolResult> {
  const stopId = requireString(args, "stop_id");
  const limit = clamp(Number(args.limit ?? 10), 1, 50);

  if (!env.NTA_API_KEY) {
    return { error: "NTA_API_KEY not configured", docs: "https://developer.nationaltransport.ie" };
  }

  const feed = await fetchTripUpdates(env.NTA_API_KEY);
  if ("error" in feed) {
    return { error: "Realtime data unavailable", reason: feed.error, status: feed.status };
  }

  const matches = (feed.entity ?? []).flatMap(entity => {
    const update = entity.trip_update;
    const tripId = update?.trip?.trip_id;
    if (!update || !tripId) return [];
    return (update.stop_time_update ?? [])
      .filter(stopTime => stopTime.stop_id === stopId)
      .map(stopTime => {
        const realtimeEpoch = stopTime.departure?.time ?? stopTime.arrival?.time;
        const delaySeconds = stopTime.departure?.delay ?? stopTime.arrival?.delay ?? 0;
        const scheduledEpoch = realtimeEpoch == null ? undefined : Number(realtimeEpoch) - delaySeconds;
        return {
          trip_id: tripId,
          route_id: update.trip?.route_id ?? null,
          headsign: null as string | null,
          vehicle_id: update.vehicle?.label ?? update.vehicle?.id,
          scheduled_departure: epochToIso(scheduledEpoch),
          expected_departure: epochToIso(realtimeEpoch),
          delay_seconds: delaySeconds,
        };
      });
  });

  if (!matches.length) return [];

  const tripIds = Array.from(new Set(matches.map(match => match.trip_id)));
  const { data: trips, error } = await db
    .from("trips")
    .select("trip_id, trip_headsign, routes(route_short_name)")
    .in("trip_id", tripIds);
  if (error) throw new Error(error.message);

  const staticByTrip = new Map(
    ((trips ?? []) as Array<{ trip_id: string; trip_headsign: string | null; routes: { route_short_name: string | null } | Array<{ route_short_name: string | null }> | null }>).map(trip => [
      trip.trip_id,
      trip,
    ]),
  );

  return matches
    .map(match => {
      const trip = staticByTrip.get(match.trip_id);
      return {
        route_short_name: one(trip?.routes)?.route_short_name ?? match.route_id,
        headsign: trip?.trip_headsign ?? match.headsign,
        scheduled_departure: match.scheduled_departure,
        expected_departure: match.expected_departure,
        delay_seconds: match.delay_seconds,
        vehicle_id: match.vehicle_id,
      };
    })
    .sort((a, b) => String(a.expected_departure ?? "").localeCompare(String(b.expected_departure ?? "")))
    .slice(0, limit);
}
