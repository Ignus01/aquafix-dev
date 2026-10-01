import Link from "next/link";
import { getCurrentUserRoles } from "@/lib/auth";
import { canDoc } from "@/lib/stock-manager/permissions";
import type { DocKind } from "@/lib/stock-manager/docs";
import { CalculatorIcon, ClipboardListIcon, FilePlusIcon, TruckIcon } from "../icons";
import { Header } from "../ui";

export const metadata = { title: "Stock · AquaFix" };

const TILES: { kind: DocKind; label: string; icon: React.ReactNode }[] = [
  { kind: "loads", label: "Intakes", icon: <FilePlusIcon className="h-[88px] w-[88px]" /> },
  { kind: "transfers", label: "Transfers", icon: <TruckIcon className="h-[88px] w-[88px]" /> },
  { kind: "work-orders", label: "Work Order", icon: <ClipboardListIcon className="h-[88px] w-[88px]" /> },
  { kind: "stock-takes", label: "Stock Take", icon: <CalculatorIcon className="h-[88px] w-[88px]" /> },
];

export default async function StockHome() {
  const roles = await getCurrentUserRoles();
  const tiles = TILES.filter((t) => canDoc(roles, t.kind, "read"));
  return (
    <>
      <Header title="Stock - Home" brand />
      <main className="grid grid-cols-2 gap-y-2 bg-white px-4 pt-4">
        {tiles.map((t) => (
          <Link
            key={t.kind}
            href={`/m/stock/${t.kind}`}
            className="flex flex-col items-center gap-1 py-4 text-[#0b1426] active:opacity-60"
          >
            {t.icon}
            <span className="text-[22px] font-semibold">{t.label}</span>
          </Link>
        ))}
        {tiles.length === 0 && <p className="col-span-2 py-8 text-center text-[18px] text-[#5b6480]">No stock functions available for your role.</p>}
      </main>
    </>
  );
}
