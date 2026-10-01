import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { isDocKind } from "@/lib/stock-manager/docs";
import { STOCK_DOC_RIGHTS } from "@/lib/stock-manager/permissions";
import { getAppTimeZone } from "../../../../admin/inspections/actions";
import { getOptions } from "../../../../admin/stock-manager/actions";
import { Header } from "../../../ui";
import { DocForm } from "./doc-form";

export const metadata = { title: "New stock document · AquaFix" };

export default async function NewStockDocPage(props: PageProps<"/m/stock/[kind]/new">) {
  const { kind } = await props.params;
  if (!isDocKind(kind) || kind === "purchase-orders" || kind === "intakes") notFound();
  await requireRole(STOCK_DOC_RIGHTS[kind].create);

  const [options, timeZone] = await Promise.all([getOptions(), getAppTimeZone()]);
  const titles = {
    loads: "Add New Load",
    transfers: "New Transfer Main",
    "work-orders": "New Work Order",
    "stock-takes": "New Stock Take",
  } as const;

  return (
    <>
      <Header title={titles[kind as keyof typeof titles]} />
      <DocForm kind={kind} options={options} timeZone={timeZone} />
    </>
  );
}
