export const NTA_BASE = "https://api.nationaltransport.ie/gtfsr/v2";

export interface GtfsTrip {
  trip_id?: string;
  route_id?: string;
  direction_id?: number;
}

export interface GtfsStopTimeUpdate {
  stop_sequence?: number;
  stop_id?: string;
  arrival?: { delay?: number; time?: string | number };
  departure?: { delay?: number; time?: string | number };
}

export interface GtfsTripUpdate {
  trip?: GtfsTrip;
  vehicle?: { id?: string; label?: string };
  stop_time_update?: GtfsStopTimeUpdate[];
}

export interface GtfsEntity {
  id: string;
  trip_update?: GtfsTripUpdate;
}

export interface GtfsFeed {
  header?: { timestamp?: string | number };
  entity?: GtfsEntity[];
}

export async function fetchTripUpdates(apiKey: string): Promise<GtfsFeed | { error: string; status: number }> {
  const res = await fetch(`${NTA_BASE}/TripUpdates?format=json`, {
    headers: {
      "x-api-key": apiKey,
      "User-Agent": "IrishMCP/1.0 (+https://irishmcp.ie)",
      "Cache-Control": "no-cache",
    },
  });

  if (!res.ok) return { error: "Realtime feed unavailable", status: res.status };
  return res.json() as Promise<GtfsFeed>;
}

export function epochToIso(value: string | number | undefined): string | null {
  if (value == null) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}
