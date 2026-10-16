"use client";

import { useState, useTransition } from "react";
import { getImportFileUrl } from "./actions";

// Downloads an import's original certificate through a short-lived signed URL.
export function ImportFileLink({ importId, fileName }: { importId: string; fileName: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function download() {
    setError(null);
    startTransition(async () => {
      const res = await getImportFileUrl(importId);
      if (res.error || !res.url) setError(res.error ?? "Couldn't prepare the download.");
      else window.location.assign(res.url);
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={download}
        className="text-left font-semibold break-all text-primary hover:text-primary-hover disabled:opacity-60"
      >
        {fileName}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
