// Which sidebar sections the user left open or folded, keyed by section label.
// Written by the sidebar in the browser, read by the admin layout so the
// server renders the sidebar the way the user left it.
export const NAV_COOKIE = "aquafix-nav";

export type NavGroupState = Record<string, boolean>;

export function parseNavGroups(raw: string | undefined): NavGroupState {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(decodeURIComponent(raw));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
    );
  } catch {
    return {};
  }
}
