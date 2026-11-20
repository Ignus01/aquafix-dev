"use client";

import { useEffect } from "react";

// The site (location) the technician last opened, so a new stock usage
// starts at it (MWTS spec R4). Kept in this browser only.
const KEY = "aquafix.lastSiteId";

export function getLastSite(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setLastSite(locationId: string | null | undefined) {
  if (!locationId) return;
  try {
    window.localStorage.setItem(KEY, locationId);
  } catch {
    // Storage blocked: the form just starts empty.
  }
}

// Drop into a page about one site to remember it.
export function RememberSite({ locationId }: { locationId: string }) {
  useEffect(() => setLastSite(locationId), [locationId]);
  return null;
}
