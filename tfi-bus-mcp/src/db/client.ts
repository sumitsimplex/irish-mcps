import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  NTA_API_KEY?: string;
}

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      search_stops_rpc: {
        Args: { p_query?: string | null; p_lat?: number | null; p_lon?: number | null; p_radius_m?: number | null; p_limit?: number };
        Returns: Array<{ stop_id: string; stop_name: string; stop_lat: number; stop_lon: number; distance_m: number | null }>;
      };
      get_routes_at_stop_rpc: {
        Args: { p_stop_id: string };
        Returns: Array<{ route_id: string; route_short_name: string | null; route_long_name: string | null; agency_name: string; headsigns: string[] }>;
      };
      active_service_ids_rpc: {
        Args: { p_date: string };
        Returns: Array<{ service_id: string }>;
      };
      list_operators_rpc: {
        Args: Record<string, never>;
        Returns: Array<{ agency_id: string; agency_name: string; agency_url: string | null; route_count: number }>;
      };
    };
  };
}

export type DbClient = SupabaseClient<any>;

export function createDb(env: Env): DbClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { "X-Client-Info": "irishmcp-tfi-bus-worker" } },
  });
}
