import Link from "next/link";
import { getCurrentUserRoles } from "@/lib/auth";
import { canDoc } from "@/lib/stock-manager/permissions";
import type { DocKind } from "@/lib/stock-manager/docs";
import { BoxIcon, CalculatorIcon, ClipboardCheckIcon, ClipboardListIcon, FilePlusIcon, TruckIcon } from "../icons";
import { Header } from "../ui";

export const metadata = { title: "Stock · AquaFix" };

const TILES: { kind: DocKind; label: string; icon: React.ReactNode; href?: string }[] = [
  // MWTS spec R3: purchase orders to collect (assigned to me, or to nobody).
  { kind: "intakes", label: "Collect", icon: <BoxIcon className="h-[64px] w-[64px]" />, href: "/m/stock/collect" },
  // What is in my kit (and any other kit or store).
  { kind: "work-orders", label: "On hand", icon: <ClipboardCheckIcon className="h-[64px] w-[64px]" />, href: "/m/stock/on-hand" },
  { kind: "loads", label: "Intakes", icon: <FilePlusIcon className="h-[64px] w-[64px]" /> },
  { kind: "transfers", label: "Transfers", icon: <TruckIcon className="h-[64px] w-[64px]" /> },
  { kind: "work-orders", label: "Work Order", icon: <ClipboardListIcon className="h-[64px] w-[64px]" /> },
  { kind: "stock-takes", label: "Stock Take", icon: <CalculatorIcon className="h-[64px] w-[64px]" /> },
];

export default async function StockHome() {
  const roles = await getCurrentUserRoles();
  const tiles = TILES.filter((t) => canDoc(roles, t.kind, t.href === "/m/stock/collect" ? "create" : "read"));
  return (
    <>
      <Header title="Stock - Home" brand />
      <main className="grid grid-cols-2 gap-3 px-4 pt-4">
        {tiles.map((t) => (
          <Link
            key={t.href ?? t.kind}
            href={t.href ?? `/m/stock/${t.kind}`}
            className="flex flex-col items-center gap-2 rounded-[18px] bg-white px-2 py-5 text-[#0b1426] shadow-sm ring-1 ring-[#e6e8f0] transition active:scale-[0.97] active:bg-[#eef0fb]"
          >
            {t.icon}
            <span className="text-[19px] font-semibold">{t.label}</span>
          </Link>
        ))}
        {tiles.length === 0 && <p className="col-span-2 py-8 text-center text-[18px] text-[#5b6480]">No stock functions available for your role.</p>}
      </main>
    </>
  );
}
