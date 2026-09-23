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
