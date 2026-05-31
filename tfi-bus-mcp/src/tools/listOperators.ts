import type { DbClient } from "../db/client";
import type { ToolResult } from "./helpers";

export async function listOperators(db: DbClient): Promise<ToolResult> {
  const { data, error } = await db.rpc("list_operators_rpc", {});
  if (error) throw new Error(error.message);
  return data ?? [];
}
