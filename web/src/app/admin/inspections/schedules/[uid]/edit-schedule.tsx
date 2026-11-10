"use client";

import { useRouter } from "next/navigation";
import type { AccountOption, AssetOption, ScheduledInstructionRow } from "@/lib/inspections/types";
import { ScheduleForm } from "../../schedule-editor";

// Save, Cancel or Close goes back to where the user came from (usually the
// grid, filters intact); a direct link falls back to the grid.
export function EditSchedule(props: {
  schedule: ScheduledInstructionRow | null;
  assets: AssetOption[];
  accounts: AccountOption[];
  readOnly: boolean;
}) {
  const router = useRouter();
  return (
    <ScheduleForm
      {...props}
      onDone={() => {
        if (window.history.length > 1) router.back();
        else router.push("/admin/inspections?tab=schedules");
      }}
    />
  );
}
