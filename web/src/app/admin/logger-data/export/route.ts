import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseReadingFilter, readingsQuery, toReadingRows } from "@/lib/logger-data/readings";

// CSV of the readings matching the grid's filters and sort, all pages.
// Times are in the app time zone.

const MAX_ROWS = 200_000;
const BATCH = 1000;

function csvCell(value: string | number | null) {
  const s = value === null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// `YYYY-MM-DD HH:mm:ss` in the zone, which spreadsheets read as a date.
function zonedStamp(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export async function GET(request: Request) {
  await requireRole(["system_admin"]);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filter = parseReadingFilter(params);

  const supabase = await createClient();
  const { data: tz } = await supabase.rpc("app_time_zone");
  const timeZone = (tz as string | null) ?? "Africa/Johannesburg";

  const lines = [
    ["Asset", "Asset code", "Location", "Logger type", "Logger code", "Reading time", "Value", "Unit", "Pulled at"].join(","),
  ];
  for (let start = 0; start < MAX_ROWS; start += BATCH) {
    const { data, error } = await readingsQuery(supabase, filter, timeZone).range(start, start + BATCH - 1);
    if (error) return new Response(`Export failed: ${error.message}`, { status: 500 });
    for (const r of toReadingRows(data)) {
      lines.push(
        [
          r.asset_name,
          r.asset_code,
          r.location_name,
          r.logger_type,
          r.logger_code,
          zonedStamp(r.reading_at, timeZone),
          r.value,
          r.unit,
          zonedStamp(r.pulled_at, timeZone),
        ]
          .map(csvCell)
          .join(","),
      );
    }
    if (!data || data.length < BATCH) break;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="logger-data-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
