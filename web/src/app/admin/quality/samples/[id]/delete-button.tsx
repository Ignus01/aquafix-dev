"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { secondaryButtonClass } from "../../../ui";
import { deleteSample } from "../../actions";

export function DeleteSampleButton({ id, labNo }: { id: string; labNo: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function remove() {
    if (!confirm(`Delete sample ${labNo} and its results? This can't be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteSample(id);
      if (res.error) setError(res.error);
      else router.push("/admin/quality");
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
