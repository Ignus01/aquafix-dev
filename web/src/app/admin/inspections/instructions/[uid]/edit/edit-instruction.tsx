"use client";

import { useRouter } from "next/navigation";
import type { AccountOption, AssetOption, InstructionDetail } from "@/lib/inspections/types";
import { InstructionForm } from "../../../instruction-editor";

// Save or Cancel goes back to where the user came from (usually the grid,
// with its filters still in the URL); a direct link falls back to the grid.
export function EditInstruction(props: {
  instruction: InstructionDetail | null;
  assets: AssetOption[];
  accounts: AccountOption[];
  today: string;
}) {
  const router = useRouter();
  return (
    <InstructionForm
      {...props}
      onDone={() => {
        if (window.history.length > 1) router.back();
        else router.push("/admin/inspections?tab=instructions");
      }}
    />
  );
}
