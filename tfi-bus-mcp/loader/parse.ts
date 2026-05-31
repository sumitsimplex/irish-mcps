import { parse } from "csv-parse";
import unzipper from "unzipper";

export type GtfsFile =
  | "agency.txt"
  | "routes.txt"
  | "stops.txt"
  | "trips.txt"
  | "calendar.txt"
  | "calendar_dates.txt"
  | "stop_times.txt"
  | "shapes.txt";

export async function parseGtfsFile(
  zipPath: string,
  fileName: GtfsFile,
  onRow: (row: Record<string, string>) => Promise<void>,
): Promise<number> {
  const directory = await unzipper.Open.file(zipPath);
  const file = directory.files.find(entry => entry.path === fileName);
  if (!file) throw new Error(`${fileName} not found in GTFS zip`);

  let count = 0;
  const parser = file.stream().pipe(parse({ columns: true, bom: true, relax_quotes: true, skip_empty_lines: true, trim: true }));

  for await (const row of parser) {
    await onRow(row as Record<string, string>);
    count += 1;
  }

  return count;
}
