"use client";

import { DownloadIcon } from "../../../../icons";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex h-[38px] items-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
    >
      <DownloadIcon className="h-4 w-4" />
      Download PDF
    </button>
  );
}
