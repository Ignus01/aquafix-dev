"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { secondaryButtonClass } from "../../../ui";
import { deleteActivity } from "../../actions";

export function DeleteActivityButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function remove() {
    if (!confirm(`Delete inspection ${label}? Its values and photos are deleted too.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteActivity(id);
      if (res.error) setError(res.error);
      else router.push("/admin/inspections?tab=activities");
    });
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-[13px] text-danger">{error}</span>}
      <button type="button" disabled={isPending} onClick={remove} className={`${secondaryButtonClass} !text-danger`}>
        {isPending ? "Deleting…" : "Delete"}
      </button>
    </span>
  );
}
