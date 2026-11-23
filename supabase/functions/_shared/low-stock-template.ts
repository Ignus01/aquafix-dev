// The daily low-stock email (MWTS spec R6): everything below its minimum,
// grouped by storage area, e.g. "Ryan's kit: DPD1 1 (min 2)".

import { escapeHtml } from "./incident-template.ts";

export type LowStockLine = {
  storage_area: string;
  item: string;
  qty: number | string;
  min_qty: number | string;
  reorder_qty: number | string | null;
};

export type LowStockPayload = { day: string; lines: LowStockLine[] };

// "20 Nov 2026" from "2026-11-20".
function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] ?? "";
  return `${String(d).padStart(2, "0")} ${month} ${y}`;
}

const num = (v: number | string | null) => (v === null || v === undefined || v === "" ? "" : String(v));

export function renderLowStockEmail(toName: string, payload: LowStockPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const lines = payload.lines ?? [];
  const day = formatDay(payload.day);
  const subject = `Low stock: ${lines.length} item${lines.length === 1 ? "" : "s"} (${day})`;

  const rows = lines
    .map((l) => {
      const reorder = num(l.reorder_qty);
      return `<tr>
<td style='padding:8px 12px; font-size:13px; color:#222222; border-top:1px solid #e3eaed;'>${escapeHtml(l.storage_area)}</td>
<td style='padding:8px 12px; font-size:13px; color:#222222; border-top:1px solid #e3eaed; font-weight:bold;'>${escapeHtml(l.item)}</td>
<td style='padding:8px 12px; font-size:13px; color:#B03A2E; border-top:1px solid #e3eaed; text-align:right; font-weight:bold;'>${escapeHtml(num(l.qty))}</td>
<td style='padding:8px 12px; font-size:13px; color:#444444; border-top:1px solid #e3eaed; text-align:right;'>${escapeHtml(num(l.min_qty))}</td>
<td style='padding:8px 12px; font-size:13px; color:#444444; border-top:1px solid #e3eaed; text-align:right;'>${reorder ? escapeHtml(reorder) : "&mdash;"}</td>
</tr>`;
    })
    .join("\n");

  const head = (label: string, right = false) =>
    `<th style='padding:8px 12px; font-size:12px; color:#777777; text-align:${right ? "right" : "left"}; font-weight:bold;'>${label}</th>`;

  const html = `<!DOCTYPE html><html>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1.0'>
</head>
<body style='margin:0; padding:0; background-color:#eef2f4; font-family:Arial, Helvetica, sans-serif;'>
<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background-color:#eef2f4; padding:24px 12px;'>
<tr>
<td align='center'>
<table role='presentation' width='600' cellpadding='0' cellspacing='0' style='max-width:600px; width:100%; background-color:#ffffff; border-radius:6px; overflow:hidden;'>
<tr>
<td style='background-color:#1B4F72; padding:22px 28px;'>
<span style='color:#ffffff; font-size:20px; font-weight:bold; letter-spacing:0.5px;'>AquaFix</span>
<span style='color:#9CC5D8; font-size:13px; display:block; margin-top:4px;'>Low stock &middot; ${escapeHtml(day)}</span>
</td>
</tr>
<tr>
<td style='padding:26px 28px 14px 28px;'>
<p style='margin:0 0 6px 0; font-size:15px; color:#222222;'>Hi ${escapeHtml(toName)},</p>
<p style='margin:0; font-size:15px; color:#444444; line-height:1.55;'>These items are below their minimum level this morning.</p>
</td>
</tr>
<tr>
<td style='padding:0 28px 24px 28px;'>
<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse; background-color:#f7fafb;'>
<tr>${head("Storage area")}${head("Item")}${head("On hand", true)}${head("Min", true)}${head("Reorder", true)}</tr>
${rows}
</table>
</td>
</tr>
<tr>
<td style='padding:16px 28px; background-color:#f7fafb; border-top:1px solid #e3eaed;'>
<p style='margin:0; font-size:12px; color:#8a9aa3; line-height:1.5;'>You receive this because you are on the stock alert list in AquaFix Settings.<br>Automated message &mdash; please do not reply.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;

  const text = [
    `Hi ${toName},`,
    "",
    `These items are below their minimum level this morning (${day}):`,
    "",
    ...lines.map((l) => {
      const reorder = num(l.reorder_qty);
      return `${l.storage_area}: ${l.item} ${num(l.qty)} (min ${num(l.min_qty)}${reorder ? `, reorder ${reorder}` : ""})`;
    }),
    "",
    "You receive this because you are on the stock alert list in AquaFix Settings.",
    "Automated message — please do not reply.",
  ].join("\n");

  return { subject, html, text };
}
