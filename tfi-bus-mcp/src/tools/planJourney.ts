import type { DbClient } from "../db/client";
import { activeServiceIds, assertIsoDate, gtfsTimeToSeconds, hmToGtfsSeconds, one, requireString, type ToolResult } from "./helpers";

type OriginRow = {
  trip_id: string;
  stop_sequence: number;
  departure_time: string;
  trips: {
    trip_id: string;
    route_id: string;
    trip_headsign: string | null;
    routes: {
      route_short_name: string | null;
      route_long_name: string | null;
      agencies: { agency_name: string } | Array<{ agency_name: string }> | null;
    } | Array<{
      route_short_name: string | null;
      route_long_name: string | null;
      agencies: { agency_name: string } | Array<{ agency_name: string }> | null;
    }> | null;
  } | Array<{
    trip_id: string;
    route_id: string;
    trip_headsign: string | null;
    routes: {
      route_short_name: string | null;
      route_long_name: string | null;
      agencies: { agency_name: string } | Array<{ agency_name: string }> | null;
    } | Array<{
      route_short_name: string | null;
      route_long_name: string | null;
      agencies: { agency_name: string } | Array<{ agency_name: string }> | null;
    }> | null;
  }> | null;
};

type StopTimeWithStop = {
  trip_id: string;
  stop_sequence: number;
  stop_id: string;
  arrival_time: string | null;
  departure_time: string | null;
  stops: { stop_name: string } | Array<{ stop_name: string }> | null;
};

export async function planJourney(db: DbClient, args: Record<string, unknown>): Promise<ToolResult> {
  const originStopId = requireString(args, "origin_stop_id");
  const destinationStopId = requireString(args, "destination_stop_id");
  const date = requireString(args, "date");
  assertIsoDate(date);
  const departAfter = typeof args.depart_after === "string" ? args.depart_after : "00:00";
  const departAfterSeconds = hmToGtfsSeconds(departAfter);

  const { data: stops, error: stopsError } = await db
    .from("stops")
    .select("stop_id")
    .in("stop_id", [originStopId, destinationStopId]);
  if (stopsError) throw new Error(stopsError.message);
  const found = new Set((stops ?? []).map((stop: { stop_id: string }) => stop.stop_id));
  if (!found.has(originStopId)) return { error: "Stop not found", stop_id: originStopId };
  if (!found.has(destinationStopId)) return { error: "Stop not found", stop_id: destinationStopId };

  const serviceIds = await activeServiceIds(db, date);
  if (!serviceIds.length) {
    return { error: "No services on this date", date, suggestion: "Check calendar_dates for exceptions" };
  }

  const { data: originRows, error: originError } = await db
    .from("stop_times")
    .select("trip_id, stop_sequence, departure_time, trips!inner(trip_id, route_id, trip_headsign, service_id, routes(route_short_name, route_long_name, agencies(agency_name)))")
    .eq("stop_id", originStopId)
    .in("trips.service_id", serviceIds)
    .not("departure_time", "is", null)
    .limit(1000);
  if (originError) throw new Error(originError.message);

  const candidates = ((originRows ?? []) as unknown as OriginRow[])
    .filter(row => gtfsTimeToSeconds(row.departure_time) >= departAfterSeconds)
    .sort((a, b) => gtfsTimeToSeconds(a.departure_time) - gtfsTimeToSeconds(b.departure_time))
    .slice(0, 250);

  if (!candidates.length) {
    return { journeys: [], message: "No direct services found between these stops on this date." };
  }

  const tripIds = candidates.map(row => row.trip_id);
  const { data: destinationRows, error: destinationError } = await db
    .from("stop_times")
    .select("trip_id, stop_sequence, arrival_time")
    .eq("stop_id", destinationStopId)
    .in("trip_id", tripIds);
  if (destinationError) throw new Error(destinationError.message);

  const destinationByTrip = new Map<string, { stop_sequence: number; arrival_time: string | null }>();
  for (const row of destinationRows ?? []) {
    destinationByTrip.set(row.trip_id, row);
  }

  const direct = candidates
    .map(origin => ({ origin, destination: destinationByTrip.get(origin.trip_id) }))
    .filter((pair): pair is { origin: OriginRow; destination: { stop_sequence: number; arrival_time: string | null } } =>
      Boolean(pair.destination && pair.destination.stop_sequence > pair.origin.stop_sequence),
    )
    .slice(0, 50);

  if (!direct.length) {
    return { journeys: [], message: "No direct services found between these stops on this date." };
  }

  const directTripIds = direct.map(pair => pair.origin.trip_id);
  const { data: allStopTimes, error: allStopTimesError } = await db
    .from("stop_times")
    .select("trip_id, stop_sequence, stop_id, arrival_time, departure_time, stops(stop_name)")
    .in("trip_id", directTripIds)
    .order("trip_id")
    .order("stop_sequence");
  if (allStopTimesError) throw new Error(allStopTimesError.message);

  const byTrip = new Map<string, StopTimeWithStop[]>();
  for (const row of (allStopTimes ?? []) as unknown as StopTimeWithStop[]) {
    const rows = byTrip.get(row.trip_id) ?? [];
    rows.push(row);
    byTrip.set(row.trip_id, rows);
  }

  const journeys = direct
    .map(({ origin, destination }) => {
      const rows = byTrip.get(origin.trip_id) ?? [];
      const intermediate = rows.filter(row => row.stop_sequence >= origin.stop_sequence && row.stop_sequence <= destination.stop_sequence);
      const trip = one(origin.trips);
      const route = one(trip?.routes);
      const agency = one(route?.agencies);
      const departsAt = origin.departure_time;
      const arrivesAt = destination.arrival_time ?? intermediate.at(-1)?.arrival_time ?? "";
      return {
        trip_id: origin.trip_id,
        route_short_name: route?.route_short_name ?? null,
        route_long_name: route?.route_long_name ?? null,
        agency_name: agency?.agency_name ?? null,
        headsign: trip?.trip_headsign ?? null,
        departs_at: departsAt,
        arrives_at: arrivesAt,
        duration_minutes: Math.max(0, Math.round((gtfsTimeToSeconds(arrivesAt) - gtfsTimeToSeconds(departsAt)) / 60)),
        intermediate_stops: intermediate.map(row => ({
          stop_id: row.stop_id,
          stop_name: one(row.stops)?.stop_name ?? "",
          departure_time: row.departure_time,
        })),
      };
    })
    .sort((a, b) => gtfsTimeToSeconds(a.arrives_at) - gtfsTimeToSeconds(b.arrives_at))
    .slice(0, 5);

  return journeys.length
    ? { journeys }
    : { journeys: [], message: "No direct services found between these stops on this date." };
}
