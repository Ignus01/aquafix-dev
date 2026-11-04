import { describe, expect, it } from "vitest";
import { addDays, isoToZonedInput, sevenDayWindowStart, shortDate, startOfTodayIso, zonedInputToIso } from "./dates";
import { canDoc } from "./permissions";
import { classifyRpcFailure, isAlreadyUploaded } from "./upload-errors";
import { compareVersions, isBelowMinimum } from "./version";

describe("upload rule", () => {
  it("retries no network, timeouts, 5xx, 408, 429 and expired sessions", () => {
    for (const status of [0, 408, 429, 500, 502, 503]) {
      expect(classifyRpcFailure({ status }).kind).toBe("transient");
    }
    expect(classifyRpcFailure({ status: 401, code: "PGRST303", message: "JWT expired" }).kind).toBe("transient");
  });

  it("sends business rejections and other 4xx to Needs attention", () => {
    for (const [status, code] of [
      [400, "P0001"],
      [403, "42501"],
      [400, "22P02"],
      [400, "22007"],
      [409, "23505"],
      [400, "23514"],
      [404, "PGRST202"],
    ] as const) {
      const c = classifyRpcFailure({ status, code, message: "x" });
      expect(c).toEqual({ kind: "permanent", code, message: "x" });
    }
  });

  it("counts an existing photo at the fixed path as uploaded", () => {
    expect(isAlreadyUploaded({ statusCode: "409", message: "The resource already exists" })).toBe(true);
    expect(isAlreadyUploaded({ error: "Duplicate", message: "" })).toBe(true);
    expect(isAlreadyUploaded({ statusCode: 403, message: "new row violates row-level security policy" })).toBe(false);
  });
});

describe("minimum version", () => {
  it("compares numerically", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(isBelowMinimum("1.0.0", "1.2.0")).toBe(true);
    expect(isBelowMinimum("1.0.0", null)).toBe(false);
    expect(isBelowMinimum("1.0.0", "0.0.0")).toBe(false);
  });
});

describe("dates in the app time zone", () => {
  const tz = "Africa/Johannesburg";
  it("starts today at local midnight", () => {
    expect(startOfTodayIso(tz, new Date("2026-11-04T21:59:00Z"))).toBe("2026-11-03T22:00:00.000Z");
    expect(startOfTodayIso(tz, new Date("2026-11-04T22:01:00Z"))).toBe("2026-11-04T22:00:00.000Z");
  });

  it("the last 7 days are today and the 6 days before", () => {
    expect(sevenDayWindowStart(tz, new Date("2026-11-04T10:00:00Z"))).toBe("2026-10-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("round-trips wall-clock inputs", () => {
    const iso = zonedInputToIso("2026-11-04T08:02", tz);
    expect(iso).toBe("2026-11-04T06:02:00.000Z");
    expect(isoToZonedInput(iso, tz)).toBe("2026-11-04T08:02");
  });

  it("shows a plain date as is", () => {
    expect(shortDate("2026-11-04", tz)).toBe("04/11/2026");
  });
});

describe("stock rights", () => {
  it("loads are system_admin only", () => {
    expect(canDoc(["admin"], "loads", "create")).toBe(false);
    expect(canDoc(["system_admin"], "loads", "create")).toBe(true);
    expect(canDoc(["viewer"], "work-orders", "read")).toBe(true);
    expect(canDoc(["viewer"], "work-orders", "create")).toBe(false);
  });
});

describe("synced timestamp text", () => {
  it("parses Postgres-style timestamps the way Hermes needs", async () => {
    const { toDate, shortDateTime } = await import("./dates");
    expect(toDate("2026-11-04 06:02:31.123Z").toISOString()).toBe("2026-11-04T06:02:31.123Z");
    expect(toDate("2026-11-04 06:02:31+00").toISOString()).toBe("2026-11-04T06:02:31.000Z");
    expect(toDate("2026-11-04T08:02:31+0200").toISOString()).toBe("2026-11-04T06:02:31.000Z");
    expect(shortDateTime("2026-11-04 06:02:31Z", "Africa/Johannesburg")).toBe("04/11/2026 08:02");
  });
});
