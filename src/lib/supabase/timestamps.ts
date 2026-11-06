import { z } from "zod";

/** PostgreSQL keeps microseconds; Date.toISOString alone truncates them and can move a window boundary. */
export function supabaseUtcTimestamp(input: string): string {
  const value = z.iso.datetime({ offset: true }).parse(input);
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1];
  const utc = new Date(value).toISOString();
  const extra = (fraction ?? "").slice(3).replace(/0+$/, "");
  return utc.replace(/Z$/, `${extra}Z`);
}
