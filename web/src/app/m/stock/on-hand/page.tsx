import { requireRole } from "@/lib/auth";
import { STOCK_READERS } from "@/lib/stock-manager/permissions";
import { getCurrentUserId, getOptions, listOnHand } from "../../../admin/stock-manager/actions";
import { Header } from "../../ui";
import { OnHandList } from "./on-hand-list";

export const metadata = { title: "Stock on hand · AquaFix" };

// What is in each kit and store: my kit first.
export default async function OnHandPage(props: PageProps<"/m/stock/on-hand">) {
  await requireRole(STOCK_READERS);
  const [options, onHand, userId, search] = await Promise.all([getOptions(), listOnHand(), getCurrentUserId(), props.searchParams]);
  const myKit = options.storageAreas.find((a) => a.technicianUserId && a.technicianUserId === userId)?.value ?? null;
  const requested = typeof search.area === "string" ? search.area : null;
  return (
    <>
      <Header title="Stock on hand" backHref="/m/stock" />
      <OnHandList
        areas={options.storageAreas.filter((a) => !a.inactive)}
        items={options.items}
        onHand={onHand}
        initialArea={requested ?? myKit ?? ""}
        myKit={myKit}
      />
    </>
  );
}
