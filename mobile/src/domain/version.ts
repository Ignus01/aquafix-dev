// mobile_app_config.min_app_version: `major.minor.patch`, compared
// numerically. A missing row (or an unreadable value) means 0.0.0.

export function parseVersion(v: string | null | undefined): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec((v ?? "").trim());
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

// True when this build is older than the minimum: keep uploading, block new captures.
export function isBelowMinimum(appVersion: string, minVersion: string | null | undefined): boolean {
  return compareVersions(appVersion, minVersion ?? "0.0.0") < 0;
}
