import Link from "next/link";
import { getCurrentUserRoles } from "@/lib/auth";
import { isInspectionWriter } from "@/lib/inspections/permissions";
import { listLocationStatus } from "../admin/incidents/actions";
import { listMyOpenInstructions } from "../admin/inspections/actions";
import {
  BoxIcon,
  BuildingShieldIcon,
  ClipboardCheckIcon,
  SearchIcon,
  WarningIcon,
  WrenchIcon,
} from "./icons";
import { Header } from "./ui";

export const metadata = { title: "AquaFix Field" };

function Tile({
  href,
  label,
  badge,
  children,
}: {
  href: string;
  label: string;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="relative flex flex-col items-center gap-1 py-4 text-[#0b1426] active:opacity-60">
      <span className="relative">
        {children}
        {badge !== undefined && badge > 0 && (
          <span className="absolute -top-2 -right-4 flex h-[26px] min-w-[26px] items-center justify-center rounded-full bg-[#3a3cd6] px-1.5 text-[15px] font-semibold text-white">
            {badge}
          </span>
        )}
      </span>
      <span className="text-[22px] font-semibold">{label}</span>
    </Link>
  );
}

export default async function FieldHome() {
  const roles = await getCurrentUserRoles();
  const writer = isInspectionWriter(roles);
  const [instructions, locations] = await Promise.all([
    writer ? listMyOpenInstructions() : Promise.resolve([]),
    listLocationStatus().catch(() => []),
  ]);
  const off = locations.filter((l) => !l.is_operational).length;

  return (
    <>
      <Header title="Home" brand />
      <main className="grid grid-cols-2 gap-y-2 bg-white px-4 pt-4">
        {writer && (
          <Tile href="/m/inspections" label="Inspections">
            <SearchIcon className="h-[88px] w-[88px] text-[#0b1426]" />
          </Tile>
        )}
        <Tile href="/m/incidents" label="Incidents">
          <WarningIcon className="h-[88px] w-[88px]" />
        </Tile>
        {writer && (
          <Tile href="/m/instructions" label="Instructions" badge={instructions.length}>
            <ClipboardCheckIcon className="h-[88px] w-[88px]" />
          </Tile>
        )}
        <Tile href="/m/services" label="Services">
          <WrenchIcon className="h-[88px] w-[88px]" />
        </Tile>
        <Tile href="/m/location-status" label="Location Status" badge={off}>
          <BuildingShieldIcon className="h-[88px] w-[88px]" />
        </Tile>
        <Tile href="/m/stock" label="Stock">
          <BoxIcon className="h-[88px] w-[88px]" />
        </Tile>
      </main>
    </>
  );
}
