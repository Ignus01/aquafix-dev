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

## Services

A service is one maintenance or repair job on an asset. `save_service()` validates, stamps
`performed_by` (by trigger), writes the service and its files, and, when a scheduled
maintenance on an asset with a service plan becomes completed, opens the next one
(`create_next_service()`: today + `service_interval` years × 365 days). Switching on an
asset's service plan, or changing its interval, also opens its first service. An asset can
have one open service at a time (unique index). Files go in the private `service-files`
bucket; deleting a service removes them with the service role, so the web app needs
`SUPABASE_SERVICE_ROLE_KEY` (already used by user management).

## Tests

`supabase/tests/` holds pgTAP tests, including the inspection validation test vectors
(T1–T16 in `spec/inspections/inspection-value-validation.md`). Run them against the
local stack:

```bash
npx supabase test db
```
