import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const GTFS_URL = "https://www.transportforireland.ie/transitData/Data/GTFS_All.zip";

export async function downloadGtfsZip(destination: string): Promise<string> {
  const response = await fetch(GTFS_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download GTFS_All.zip: HTTP ${response.status}`);
  }

  const hash = createHash("sha256");
  const hashStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      hash.update(chunk);
      controller.enqueue(chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body.pipeThrough(hashStream)),
    createWriteStream(destination),
  );

  return hash.digest("hex");
}
