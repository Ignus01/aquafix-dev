import ExcelJS from "exceljs";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { parseGridParams } from "@/lib/grid/params";
import { applyGridFilters, applyGridSort } from "@/lib/grid/query";
import { GRID_REGISTRY } from "@/lib/grid/registry";
import { fieldOf, type GridField, type GridSpec } from "@/lib/grid/types";
import { createClient } from "@/lib/supabase/server";

// Export (Main.ACT_ExportToExcel): every row matching the grid's filters,
// in its sort order, as CSV (default) or XLSX (&format=xlsx). Same params as
// the grid's URL; pages through the view 1,000 rows at a time with the
// caller's session, so RLS applies.

const BATCH = 1000;
const MAX_ROWS = 200_000;

type Row = Record<string, unknown>;

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

function exportColumns(spec: GridSpec) {
  return spec.fields
    .filter((f) => f.exportField !== false)
    .map((f) => ({ field: f, column: (f.exportField as string | undefined) ?? fieldOf(f) }));
}

function cellValue(f: GridField, v: unknown, timeZone: string): string | number | null {
  if (v === null || v === undefined) return f.key === "changed_by" ? "System" : null;
  const option = f.options?.find((o) => o.value === String(v));
  if (option) return option.label;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (f.filter === "datetime" && typeof v === "string") return zonedStamp(v, timeZone);
  if (typeof v === "number") return v;
  return String(v);
}

function csvCell(value: string | number | null) {
  const s = value === null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request, ctx: RouteContext<"/admin/export/[grid]">) {
  const { grid } = await ctx.params;
  const entry = GRID_REGISTRY[grid];
  if (!entry || !entry.spec.view) notFound();
  await requireRole(entry.roles);
  const { spec } = entry;

  const url = new URL(request.url);
  const params = parseGridParams(url.searchParams, spec);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const supabase = await createClient();
  const { data: tz } = await supabase.rpc("app_time_zone");
  const timeZone = (tz as string | null) ?? "Africa/Johannesburg";
  const cols = exportColumns(spec);

  async function* batches() {
    for (let start = 0; start < MAX_ROWS; start += BATCH) {
      let q = supabase.from(spec.view!).select(spec.select!);
      q = applyGridSort(applyGridFilters(q, spec, params, timeZone), spec, params);
      const { data, error } = await q.range(start, start + BATCH - 1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Row[];
      yield rows.map((r) => cols.map((c) => cellValue(c.field, r[c.column], timeZone)));
      if (rows.length < BATCH) return;
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${spec.id}-${stamp}.${format}`;
  const headers = {
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
  };

  if (format === "xlsx") {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet(spec.id);
    sheet.addRow(cols.map((c) => c.field.label)).font = { bold: true };
    try {
      for await (const rows of batches()) sheet.addRows(rows);
    } catch (e) {
      return new Response(`Export failed: ${(e as Error).message}`, { status: 500 });
    }
    const buffer = await book.xlsx.writeBuffer();
    return new Response(buffer as ArrayBuffer, {
      headers: { ...headers, "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    });
  }

  // CSV streams as it pages, so a big export starts downloading at once.
  const encoder = new TextEncoder();
  const iterator = batches();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("﻿" + cols.map((c) => csvCell(c.field.label)).join(",") + "\r\n"));
    },
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        if (value.length) controller.enqueue(encoder.encode(value.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"));
      } catch (e) {
        controller.error(e);
      }
    },
  });
  return new Response(stream, { headers: { ...headers, "content-type": "text/csv; charset=utf-8" } });
}
