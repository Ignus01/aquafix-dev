import ExcelJS from "exceljs";
import type { ParsedColumn, ParsedRow, ParsedSheet } from "./types";

// Reads a lab certificate (.xlsx) into lab_import.parsed. The layout is the
// My Water Treatment one (spec "The lab file"):
//   A1 lab name, A2 client, A3 "Batch no: 201013"
//   header row (found by "Lab no" in column A, normally row 5): Lab no,
//     Locality, Sample type, Sampled date, then one column per parameter
//   the row under it: each parameter's unit
//   then one row per sample, until the first empty Lab no.
// Values are kept as written: a negative value is "below detection", which
// commit_lab_import() works out per parameter.

export const NOT_A_WORKBOOK = "This file is empty or isn't an Excel workbook. Download it from the lab again.";
export const NOT_A_CERTIFICATE =
  "This doesn't look like a lab certificate: the Lab no, Locality and Sampled date headers weren't found in row 5.";
export const NO_SAMPLES = "This certificate has no samples.";

// How far down to look for the header row.
const HEADER_SEARCH_ROWS = 10;

// Trimmed, with runs of whitespace collapsed: "20 - pH " → "20 - pH".
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

type Cell = ExcelJS.CellValue;

// A cell's value with formulas, rich text and hyperlinks unwrapped.
function plain(v: Cell): string | number | boolean | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v !== "object") return v;
  if ("result" in v) return plain(v.result as Cell);
  if ("richText" in v) return v.richText.map((t) => t.text).join("");
  if ("text" in v) return String(v.text);
  return null;
}

const text = (v: Cell) => {
  const p = plain(v);
  if (p === null) return "";
  if (p instanceof Date) return p.toISOString().slice(0, 10);
  return clean(String(p));
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ymd = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? date.toISOString().slice(0, 10)
    : null;
};

// `YYYY-MM-DD` from a date cell, an Excel serial (45595 = 30 Oct 2024) or
// text like "30-Oct-2024" / "2024-10-30"; null if it isn't a date.
function toDay(v: Cell): string | null {
  const p = plain(v);
  if (p instanceof Date) return Number.isNaN(p.getTime()) ? null : p.toISOString().slice(0, 10);
  if (typeof p === "number") {
    if (p < 1 || p > 100000) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(p) * 86_400_000).toISOString().slice(0, 10);
  }
  if (typeof p !== "string") return null;
  const s = p.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-\s/]([a-z]{3})[a-z]*[-\s/](\d{4})$/i.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase());
    return month < 0 ? null : ymd(Number(m[3]), month + 1, Number(m[1]));
  }
  return null;
}

// A number, null for a blank cell, or "invalid" for text that isn't one.
function toNumber(v: Cell): number | null | "invalid" {
  const p = plain(v);
  if (p === null) return null;
  if (typeof p === "number") return Number.isFinite(p) ? p : "invalid";
  if (typeof p !== "string") return "invalid";
  const s = p.trim().replace(/\s+/g, "");
  if (s === "") return null;
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? Number(s) : "invalid";
}

export async function parseLabWorkbook(data: ArrayBuffer): Promise<ParsedSheet | { error: string }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data);
  } catch {
    return { error: NOT_A_WORKBOOK };
  }
  const sheet = workbook.getWorksheet("Certificate") ?? workbook.worksheets[0];
  if (!sheet) return { error: NOT_A_WORKBOOK };

  const cell = (row: number, col: number) => sheet.getRow(row).getCell(col).value;

  let headerRow = 0;
  for (let r = 1; r <= HEADER_SEARCH_ROWS; r++) {
    if (text(cell(r, 1)).toLowerCase() === "lab no") {
      headerRow = r;
      break;
    }
  }
  if (!headerRow) return { error: NOT_A_CERTIFICATE };

  // The fixed columns by name, every other non-blank header a parameter.
  const header = sheet.getRow(headerRow);
  const fixed: Record<string, number> = {};
  const params: { col: number; column: ParsedColumn }[] = [];
  const lastCol = Math.max(header.cellCount, sheet.columnCount);
  for (let c = 1; c <= lastCol; c++) {
    const name = text(header.getCell(c).value);
    if (!name) continue;
    const key = name.toLowerCase();
    if (["lab no", "locality", "sample type", "sampled date"].includes(key) && !(key in fixed)) {
      fixed[key] = c;
      continue;
    }
    params.push({ col: c, column: { header: name, unit: text(cell(headerRow + 1, c)) } });
  }
  if (!fixed["locality"] || !fixed["sampled date"]) return { error: NOT_A_CERTIFICATE };

  const seen = new Set<string>();
  for (const p of params) {
    const key = p.column.header.toLowerCase();
    if (seen.has(key)) return { error: `Two columns are both called "${p.column.header}".` };
    seen.add(key);
  }

  const labName = text(cell(1, 1));
  if (!labName || labName.toLowerCase() === "lab no") return { error: NOT_A_CERTIFICATE };
  const batch = text(cell(3, 1));

  const rows: ParsedRow[] = [];
  const warnings: string[] = [];
  for (let r = headerRow + 2; r <= sheet.rowCount; r++) {
    const labNo = text(cell(r, 1));
    if (!labNo) break;
    const sampledOn = toDay(cell(r, fixed["sampled date"]));
    if (!sampledOn) return { error: `Row ${r}: the sampled date is missing or not a date.` };
    const locality = text(cell(r, fixed["locality"]));
    if (!locality) return { error: `Row ${r}: the locality is missing.` };
    const values = params.map((p) => {
      const n = toNumber(cell(r, p.col));
      if (n === "invalid") {
        warnings.push(`Row ${r}, ${p.column.header}: "${text(cell(r, p.col))}" isn't a number, so it was left blank.`);
        return null;
      }
      return n;
    });
    rows.push({
      row: r,
      lab_no: labNo,
      locality,
      sample_type: fixed["sample type"] ? text(cell(r, fixed["sample type"])) || null : null,
      sampled_on: sampledOn,
      values,
    });
  }
  if (rows.length === 0) return { error: NO_SAMPLES };

  return {
    lab_name: labName,
    client_name: text(cell(2, 1)) || null,
    // "Batch no: 201013" → "201013".
    batch_no: (batch.includes(":") ? batch.slice(batch.indexOf(":") + 1).trim() : batch) || null,
    columns: params.map((p) => p.column),
    rows,
    warnings,
  };
}
