# Supabase

Migrations in `migrations/` are applied with `npx supabase db push` (project linked with
`npx supabase link`).

## Incident email notifications

When an incident is saved for the first time, a trigger queues one `email_outbox` row per
subscriber of its incident type in the same transaction. The `email-worker` Edge Function
sends them through Brevo and writes `email_log`. The database calls the worker through
`pg_net` right after commit, and `pg_cron` calls it every minute while anything is due
(retries after 1, 5 and 30 minutes).

### Deploying

```bash
npx supabase db push
npx supabase functions deploy email-worker brevo-validate-key brevo-send-test --use-api --no-verify-jwt
```

The functions check their callers themselves: `email-worker` checks the Vault secret
`email_worker_secret` (the migration creates it), and the two settings functions check for
`system_admin`. They use the `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` the platform provides, so no function secrets need to be set.

### One-time setup per project

The database needs the project URL to reach the worker. Until it's set, emails stay
queued:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url',
  'Supabase project URL, used by the database to call Edge Functions');
```

Then, in the app, go to **Admin → System Settings** as a system admin:

1. **Add key**: paste a Brevo API v3 key (`xkeysib-…`). It is stored in Vault and can't
   be read back.
2. Set a **sender email** that is verified in Brevo, and the **App URL**, the public
   `https://` address of the web app. The "View incident" link is
   `{App URL}/incidents/{reference}`.
3. Turn **Notifications** on, save, and use **Send test email to me**.

> The Brevo key that was committed to the Mendix model (`xkeysib-…`, see
> `spec/incidents/_overview.md`) must be rotated in Brevo. Don't reuse it here.

## Scheduled instructions

`pg_cron` runs `run_instruction_schedule_if_due()` every hour at :05. It issues each
active schedule's instruction once per day in the app time zone (System Settings,
default `Africa/Johannesburg`): at the first tick after local midnight, and again at
later ticks only if that day's run failed. Missed days are not caught up. Admins can
also press **Run schedule** (Inspections → Scheduled), which is always safe to repeat:
there is one instruction per schedule per day. Runs are logged in
`instruction_schedule_run`.

Daily schedules skip weekends and the dates in `public_holiday`, unless the schedule
includes them. Add each year's public holidays under Inspections → Scheduled →
**Public holidays**. A date that isn't listed is a normal working day.

## Logger data

Assets with a logger code have a logger type (`HYDRUS` or `DATAV8`, required with the
code). Only Hydrus is pulled so far, from the KovcoLabs Hydrus API
(`www.electrodevsa.co.za/wm/api/retrieve.php`).

- `pg_cron` runs `run_daily_logger_pull()` at 04:00 UTC (06:00 SAST): one run for the 24
  hours up to 06:00 SAST, for every **active** asset with a Hydrus logger code.
- System admins can pull up to 7 days by hand (Admin → Logger Data → Pull data), for all
  loggers or selected assets.
- A run queues one `logger_pull_result` per logger. The `logger-worker` Edge Function
  claims them, calls `method=params` (for the unit) and `method=readings`, and records the
  readings in `logger_reading`. It is kicked through `pg_net` when a run starts and every
  minute by `pg_cron` while a logger is due; network errors and 5xx retry after 1 and 5
  minutes. Every run and logger result shows under Logger Data → Run log.
- A reading is unique per logger code + time; pulling it again overwrites the value and
  unit. Hydrus times have no zone and are read as SAST.
- One API password for all loggers is set under Admin → System Settings → Logger data
  (stored in Vault). Not set = empty password, the Hydrus default.

Deploy the worker with the others (it checks the Vault `logger_worker_secret` the
migration creates, and needs the same `project_url` secret as the email worker):

```bash
npx supabase functions deploy logger-worker --use-api --no-verify-jwt
```

### Water usage

Home → Water usage (system admins and admins) reports daily usage per volume meter (readings in m³,
the meter's running total). `logger_daily_usage` holds one row per meter per day: the total
at the next local midnight minus the total at this one, interpolated between readings.
Recording a pull refreshes that meter's days from 30 days before the pulled range, so the
report reads at most one row per meter per day however many readings there are. Duplicate
feeds, counter excursions and meter resets are left out and listed in
`logger_usage_issue`; the migration's header explains the rules. Changing the app time zone
recalculates every day. To recalculate by hand (e.g. after correcting readings):

```sql
select public.refresh_all_logger_daily_usage();
```

Admins can read the daily usage and its issues but not the raw readings (`logger_reading`),
the Logger data pages or the Loggers tab, which stay system-admin only.

#### Treated water vs target

Each asset has a meter type (Treated Meter, Borehole Meter, Other; blank = not a meter), and
each location an optional daily target in m³ (`volume_target`) with its own colour bands
(`location_target_band`: a band runs from its `from_pct` up to the next one, and a location
with a target has one at 0%). `save_location_target()` saves a target and its bands together;
clearing the target keeps the bands. `water_target_matrix()` gives each active location's
treated water in per day up to yesterday: the sum of its Treated Meters' daily usage, with no
figure for a day on which any of them has none. Borehole and Other meters are left out, since
they often measure the same water before treatment.

#### Borehole usage vs limit

A Borehole Meter can have a daily usage limit in m³ (`asset.usage_limit`, the licensed
abstraction volume). The `asset_usage_limit_check` constraint allows a limit only on Borehole
Meters and only above 0; the asset form clears it when the meter type changes.
`water_borehole_matrix()` works like `water_target_matrix()` with Borehole Meters in place of
Treated Meters: each active location's borehole usage per day up to yesterday, against the
sum of its borehole meters' limits (null when any of them has none). The Water usage tab
colours a day green at or below the limit and red above it.

## Services

A service is one maintenance or repair job on an asset. `save_service()` validates, stamps
`performed_by` (by trigger), writes the service and its files, and, when a scheduled
maintenance on an asset with a service plan becomes completed, opens the next one
(`create_next_service()`: today + `service_interval` years × 365 days). Switching on an
asset's service plan, or changing its interval, also opens its first service. An asset can
have one open service at a time (unique index). Files go in the private `service-files`
bucket; deleting a service removes them with the service role, so the web app needs
`SUPABASE_SERVICE_ROLE_KEY` (already used by user management).

## Quality: lab results

Water-quality lab certificates (`.xlsx`) are imported under Quality → Import (system admins
and admins; everyone else reads). The browser uploads each file to the private `lab-results`
bucket (10 MB, `<user id>/…`); the web app parses it with `exceljs` and keeps it as a staged
`lab_import` (the parsed sheet is in `lab_import.parsed`). `commit_lab_import()` then imports
the chosen staged files in one transaction: it adds the lab if new, saves the mappings chosen
in the Map step, and writes one `lab_sample` per certificate row and one `lab_result` per value.

- `quality_parameter`: Aquafix's parameters with acceptable min/max, seeded with the CP-01
  parameters and SANS 241-1:2015 limits. Limits are global.
- `lab_parameter_map` / `lab_location_map`: a lab's column or locality → a parameter or
  location (null = ignore), saved once per lab and reused by later imports. A column whose
  unit changed has to be confirmed again. Editing a mapping affects future imports only.
- A negative value means "below detection" (`< 0.002`) unless the parameter can be negative
  (LSI); `value` is then the positive figure × the mapping's factor.
- A lab no is imported once per lab (`p_replace` re-imports it). Two columns of one file
  can't map to the same parameter.
- Out of spec is never stored: `lab_result_status()` compares a result with its parameter's
  current limits (`ok`, `high`, `low`, `inconclusive`, `no_limit`), and the
  `lab_result_view` / `lab_sample_overview` views use it, so changing a limit re-colours past
  results.
- Staged imports that are never imported stay listed under Lab Results → Imports, where they
  can be continued or cancelled (cancelling removes the file). There is no automatic clean-up.
- On-site readings: an `inspection` with `is_water_quality_parameter` on is linked to the
  `quality_parameter` it measures (`DECIMAL_VALUE` only; a check constraint and
  `save_inspection()` enforce it). `water_quality_reading` lists lab results and the current
  values of those inspections together (`source` = `lab` / `site`), per location and day,
  with the same `lab_result_status()` against the parameter's limits.

## Tests

`supabase/tests/` holds pgTAP tests, including the inspection validation test vectors
(T1–T16 in `spec/inspections/inspection-value-validation.md`). Run them against the
local stack:

```bash
npx supabase test db
```
