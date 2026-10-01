import { notFound } from "next/navigation";
import { DOC_CONFIG, docNumber, isDocKind, type Field } from "@/lib/stock-manager/docs";
import { getAppTimeZone } from "../../../../admin/inspections/actions";
import { getDocument, getOptions } from "../../../../admin/stock-manager/actions";
import { shortDate, shortDateTime } from "../../../format";
import { Header } from "../../../ui";

export const metadata = { title: "Stock · AquaFix" };

// Read-only view of a captured document and its lines.
export default async function StockDocPage(props: PageProps<"/m/stock/[kind]/[reference]">) {
  const { kind, reference } = await props.params;
  const ref = Number(reference);
  if (!isDocKind(kind) || !Number.isInteger(ref)) notFound();
  const cfg = DOC_CONFIG[kind];

  const [doc, options, timeZone] = await Promise.all([getDocument(kind, ref), getOptions(), getAppTimeZone()]);
  if (!doc) notFound();

  function show(f: Field, raw: unknown): string {
    if (raw === null || raw === undefined || raw === "") return "—";
    if (f.type === "select") return options[f.options!].find((o) => o.value === raw)?.label ?? String(raw);
    if (f.type === "date") return shortDate(String(raw), timeZone);
    if (f.type === "datetime") return shortDateTime(String(raw), timeZone);
    if (f.type === "bool") return raw ? "Yes" : "No";
    return String(raw);
  }
  const typeLabel = (f: Field, v: unknown) =>
    f.key === "transfer_type" ? (options.transferTypes.find((o) => o.value === v)?.label ?? String(v)) : show(f, v);

  return (
    <>
      <Header title={docNumber(kind, doc.header.reference)} backHref={`/m/stock/${kind}`} />
      <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2 bg-white px-4 py-4 text-[19px]">
        {cfg.header
          .filter((f) => !f.showWhen || f.showWhen(Object.fromEntries(Object.entries(doc.header).map(([k, v]) => [k, String(v ?? "")]))))
          .map((f) => (
            <div key={f.key} className="contents">
              <dt className="font-semibold">{f.label}</dt>
              <dd className="break-words whitespace-pre-line">{typeLabel(f, doc.header[f.key])}</dd>
            </div>
          ))}
      </dl>
      {cfg.line && (
        <>
          <h2 className="px-4 pt-4 pb-1 text-[16px] font-semibold tracking-wide text-[#5b6480] uppercase">
            {cfg.line.plural} ({doc.lines.length})
          </h2>
          <ul className="bg-white">
            {doc.lines.length === 0 && <li className="px-4 py-4 text-[17px] text-[#5b6480]">No lines.</li>}
            {doc.lines.map((l) => (
              <li key={l.id} className="border-b border-[#dfe2e8] px-4 py-3">
                {cfg.line!.fields.map((f) => (
                  <div key={f.key} className="flex justify-between gap-3 text-[18px]">
                    <span className="text-[#5b6480]">{f.label}</span>
                    <span className="text-right">{show(f, l[f.key])}</span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
