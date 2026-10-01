import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { DOC_CONFIG, docNumber, isDocKind } from "@/lib/stock-manager/docs";
import { STOCK_DOC_RIGHTS, canDoc } from "@/lib/stock-manager/permissions";
import { ChevronLeftIcon } from "../../../icons";
import { PageHeader } from "../../../page-header";
import { getAppTimeZone } from "../../../services/actions";
import { getDocument, getOptions } from "../../actions";
import { DocEditor } from "../../doc-editor";
import { DocumentsPanel, IntakePoLinesPanel, LoadIntakesPanel } from "../../panels";

// One stock document: header, panels specific to the type and its lines.
// `/new` starts a document (an intake also needs `?load=<load number>`).
export default async function StockDocumentPage(props: PageProps<"/admin/stock-manager/[kind]/[reference]">) {
  const { kind, reference } = await props.params;
  if (!isDocKind(kind)) notFound();
  const roles = await requireRole(STOCK_DOC_RIGHTS[kind].read);
  const cfg = DOC_CONFIG[kind];

  const isNew = reference === "new";
  const ref = Number(reference);
  if (!isNew && !Number.isInteger(ref)) notFound();
  if (isNew && !canDoc(roles, kind, "create")) notFound();

  const [options, timeZone] = await Promise.all([getOptions(), getAppTimeZone()]);
  const doc = isNew ? null : await getDocument(kind, ref);
  if (!isNew && !doc) notFound();

  const search = await props.searchParams;
  const loadParam = Number(Array.isArray(search.load) ? search.load[0] : search.load);
  const loadReference = kind === "intakes" ? (doc?.loadReference ?? (Number.isInteger(loadParam) ? loadParam : undefined)) : undefined;
  if (isNew && kind === "intakes" && loadReference === undefined) notFound();

  const rights = {
    update: canDoc(roles, kind, "update"),
    delete: canDoc(roles, kind, "delete"),
    lineCreate: canDoc(roles, kind, "lineCreate"),
    lineDelete: canDoc(roles, kind, "lineDelete"),
  };

  const title = doc ? `${cfg.label} ${docNumber(kind, doc.header.reference)}` : `New ${cfg.label.toLowerCase()}`;
  const back =
    kind === "intakes" && loadReference !== undefined
      ? { href: `/admin/stock-manager/loads/${loadReference}`, label: `Back to load ${docNumber("loads", loadReference)}` }
      : { href: `/admin/stock-manager?tab=${kind}`, label: `Back to ${cfg.plural.toLowerCase()}` };

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb={`Operations / Stock Manager / ${cfg.plural}`} title={title} />
      <div className="px-4 pb-10 md:px-8">
        <Link href={back.href} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover">
          <ChevronLeftIcon className="h-4 w-4" />
          {back.label}
        </Link>

        <DocEditor
          kind={kind}
          doc={doc}
          options={options}
          timeZone={timeZone}
          rights={rights}
          loadReference={loadReference}
        >
          {doc && kind === "loads" && (
            <>
              <LoadIntakesPanel
                loadReference={doc.header.reference}
                intakes={doc.intakes ?? []}
                options={options}
                canCreate={canDoc(roles, "intakes", "create")}
              />
              <DocumentsPanel parent={{ kind: "loads", id: doc.header.id }} files={doc.files ?? []} timeZone={timeZone} canEdit={rights.update} />
            </>
          )}
          {doc && kind === "intakes" && (
            <>
              <IntakePoLinesPanel
                intakeId={doc.header.id}
                purchaseOrderReference={doc.purchaseOrderReference}
                poLines={doc.poLines ?? []}
                receivedLineIds={doc.lines.map((l) => l.purchase_order_item_id as string)}
                options={options}
                canAdd={rights.lineCreate}
              />
              <DocumentsPanel parent={{ kind: "intakes", id: doc.header.id }} files={doc.files ?? []} timeZone={timeZone} canEdit={rights.update} />
            </>
          )}
        </DocEditor>
      </div>
    </div>
  );
}
