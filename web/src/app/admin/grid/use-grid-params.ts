"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import { gridSearchParams, parseGridParams } from "@/lib/grid/params";
import type { GridParams, GridSpec } from "@/lib/grid/types";

// Reads and writes a grid's state in the URL. Server mode asks the server
// for the new page (router.replace inside a transition, so the old rows stay
// on screen, dimmed, until the new ones arrive). Client mode only rewrites
// the URL (history.replaceState, which Next keeps in sync with
// useSearchParams), so the page isn't re-rendered on the server.
export function useGridParams(spec: GridSpec, mode: "server" | "client", prefix = "", serverParams?: GridParams) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const urlParams = useMemo(() => parseGridParams(searchParams, spec, prefix), [searchParams, spec, prefix]);
  // Server mode shows the params the rows were fetched with.
  const params = mode === "server" && serverParams ? serverParams : urlParams;

  const navigate = useCallback(
    (next: GridParams) => {
      const qs = gridSearchParams(new URLSearchParams(window.location.search), next, spec, prefix).toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (mode === "client") {
        window.history.replaceState(null, "", url);
      } else {
        startTransition(() => router.replace(url, { scroll: false }));
      }
    },
    [mode, pathname, prefix, router, spec],
  );

  return { params, navigate, isPending, searchParams };
}
