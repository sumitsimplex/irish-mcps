import type { DbClient } from "../db/client";

export type ToolResult = Record<string, unknown> | unknown[];

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required string argument: ${key}`);
  }
  return value.trim();
}

export function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value == null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid number argument: ${key}`);
  return n;
}

export function gtfsTimeToSeconds(time: string | null | undefined): number {
  if (!time) return Number.POSITIVE_INFINITY;
  const parts = time.split(":").map(part => Number(part));
  const h = parts[0];
  const m = parts[1];
  const s = parts[2] ?? 0;
  if (![h, m, s].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  return h * 3600 + m * 60 + s;
}

export function hmToGtfsSeconds(time: string | null | undefined): number {
  if (!time) return 0;
  const parts = time.split(":").map(part => Number(part));
  const h = parts[0];
  const m = parts[1] ?? 0;
  if (![h, m].every(Number.isFinite)) return 0;
  return h * 3600 + m * 60;
}

export async function activeServiceIds(db: DbClient, date: string): Promise<string[]> {
  const { data, error } = await db.rpc("active_service_ids_rpc", { p_date: date });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ service_id: string }>).map(row => row.service_id);
}

export function weekdayColumn(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][d.getUTCDay()];
}

export function assertIsoDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("date must be in YYYY-MM-DD format");
  }
}

export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
