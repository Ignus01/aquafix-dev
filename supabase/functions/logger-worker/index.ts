// logger-worker — pulls queued logger data (logger_pull_result rows).
//
// Called by the database (pg_net) right after a daily or manual run is
// queued, and every minute by pg_cron while any logger is due. Authenticated
// with the `logger_worker_secret` Vault secret the database sends in the
// x-worker-secret header. Claims loggers with FOR UPDATE SKIP LOCKED, so two
// overlapping runs never pull the same logger.

import { json, serviceClient } from "../_shared/clients.ts";
import { type HydrusResult, pullHydrus } from "../_shared/hydrus.ts";

// Stay well inside the Edge Function wall-clock limit; a logger makes two
// calls of at most 20 s each, so a batch started late still finishes.
const TIME_BUDGET_MS = 45_000;
const BATCH_SIZE = 5;

type ClaimedRow = {
  id: number;
  run_id: number;
  logger_type: "HYDRUS" | "DATAV8";
  logger_code: string;
  range_start: number;
  range_end: number;
  attempts: number;
};

async function pull(row: ClaimedRow, password: string): Promise<HydrusResult> {
  if (row.logger_type !== "HYDRUS") {
    return { outcome: "failed", httpStatus: null, error: `${row.logger_type} loggers aren't supported yet.` };
  }
  return pullHydrus(row.logger_code, password, row.range_start, row.range_end);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const { data: authorized } = await db.rpc("logger_worker_secret_matches", {
    p_secret: req.headers.get("x-worker-secret") ?? "",
  });
  if (authorized !== true) return json({ error: "Unauthorized" }, 401);

  const { data: config, error: configError } = await db.rpc("get_logger_config");
  if (configError || !config) {
    console.error("logger-worker: could not load settings", configError?.message);
    return json({ error: "Could not load settings" }, 500);
  }
  const password = (config as { hydrus_password: string }).hydrus_password ?? "";

  const started = Date.now();
  const counts = { success: 0, retry: 0, failed: 0, readings: 0 };

  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data: rows, error } = await db.rpc("claim_logger_pull_results", { p_limit: BATCH_SIZE });
    if (error) {
      console.error("logger-worker: claim failed", error.message);
      break;
    }
    if (!rows || rows.length === 0) break;

    await Promise.all(
      (rows as ClaimedRow[]).map(async (row) => {
        const result = await pull(row, password);
        counts[result.outcome] += 1;
        const { data: saved, error: recordError } = await db.rpc("record_logger_pull_result", {
          p_result_id: row.id,
          p_outcome: result.outcome,
          p_unit: result.outcome === "success" ? result.unit : null,
          p_readings: result.outcome === "success" ? result.readings : null,
          p_http_status: result.httpStatus,
          p_error: result.outcome === "success" ? null : result.error,
        });
        if (recordError) {
          // The row stays `running` and is reclaimed after 5 minutes.
          console.error(`logger-worker: could not record result ${row.id}`, recordError.message);
          return;
        }
        counts.readings += Number(saved ?? 0);
      }),
    );
  }

  return json(counts);
});
