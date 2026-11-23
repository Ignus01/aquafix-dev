import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { docNumber } from "@/lib/stock-manager/docs";
import { STOCK_DOC_RIGHTS } from "@/lib/stock-manager/permissions";
import { getCurrentUserId, getOptions, listCollectable } from "../../../../admin/stock-manager/actions";
import { Header } from "../../../ui";
import { CollectForm } from "./collect-form";

export const metadata = { title: "Collect · AquaFix" };

export default async function CollectOrderPage(props: PageProps<"/m/stock/collect/[reference]">) {
  await requireRole(STOCK_DOC_RIGHTS.intakes.create);
  const { reference } = await props.params;
  const ref = Number(reference);
  if (!Number.isInteger(ref)) notFound();
  const [orders, options, userId] = await Promise.all([listCollectable(), getOptions(), getCurrentUserId()]);
  const order = orders.find((o) => o.reference === ref);
  if (!order) notFound();

  return (
    <>
      <Header title={docNumber("purchase-orders", order.reference)} backHref="/m/stock/collect" />
      <CollectForm
        order={order}
        items={options.items.map((o) => ({ value: o.value, label: o.label }))}
        areas={options.storageAreas.filter((o) => !o.inactive || o.value === order.deliver_to_area_id)}
        myKit={options.storageAreas.find((a) => !a.inactive && a.technicianUserId && a.technicianUserId === userId)?.value ?? null}
      />
    </>
  );
}
