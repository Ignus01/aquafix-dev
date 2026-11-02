-- The rows PowerSync should send to one user, per stream and table: the
-- filters in powersync/sync-config.yaml, written in Postgres. Compare with
-- what lands on a test phone: for each table, the phone's local SQLite table
-- should hold exactly `rows` rows, with exactly these ids. A table that isn't
-- listed should be empty on the phone.
--
-- Usage: put the user's auth.users id in `params` below and run it in the
-- Supabase SQL Editor (or psql). Read-only. Run it as postgres (the SQL
-- Editor's default): like powersync_role it reads past RLS.
--
-- Keep in step with sync-config.yaml: change one, change the other.
--
-- Timing: in_sync_window and sync_user_id move hourly (cron
-- powersync-sync-window). Compare right after the phone has synced, and not
-- across midnight in the app time zone.

with params as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id  -- ← the user's auth.users id
),

-- Every stream: only users with a role that can capture inspections
-- (capture_users in the config). Empty for viewers and users with no role,
-- and then every stream below is empty too.
capture_user as (
  select p.user_id
  from params p
  where p.user_id in (select user_id from public.user_masterdata_roles where role <> 'viewer')
),

synced as (
  -- reference_data: the same rows for every capture user.
  select 'reference_data' as stream, 'asset' as table_name, t.id from public.asset t, capture_user
  union all select 'reference_data', 'asset_type', t.id from public.asset_type t, capture_user
  union all select 'reference_data', 'location', t.id from public.location t, capture_user
  union all select 'reference_data', 'grading', t.id from public.grading t, capture_user
  union all select 'reference_data', 'colour_container', t.id from public.colour_container t, capture_user
  union all select 'reference_data', 'inspection', t.id from public.inspection t, capture_user
  union all select 'reference_data', 'inspection_drop_down_option', t.id from public.inspection_drop_down_option t, capture_user
  union all select 'reference_data', 'inspection_rule', t.id from public.inspection_rule t, capture_user
  union all select 'reference_data', 'feedback', t.id from public.feedback t, capture_user
  union all select 'reference_data', 'inspection_allocation', t.id from public.inspection_allocation t, capture_user
  union all select 'reference_data', 'quality_parameter', t.id from public.quality_parameter t, capture_user
  union all select 'reference_data', 'inspection_cumulative_value', t.id from public.inspection_cumulative_value t, capture_user

  -- my_instructions
  union all
  select 'my_instructions', 'instruction', t.id
  from public.instruction t
  join capture_user u on t.account_id = u.user_id
  where t.in_sync_window = true
  union all
  select 'my_instructions', 'instruction_asset_allocation', t.id
  from public.instruction_asset_allocation t
  join capture_user u on t.sync_user_id = u.user_id

  -- my_inspections
  union all
  select 'my_inspections', 'inspection_activity', t.id
  from public.inspection_activity t
  join capture_user u on t.created_by = u.user_id
  where t.in_sync_window = true
  union all
  select 'my_inspections', 'inspection_value', t.id
  from public.inspection_value t
  join capture_user u on t.sync_user_id = u.user_id
  union all
  select 'my_inspections', 'inspection_image', t.id
  from public.inspection_image t
  join capture_user u on t.sync_user_id = u.user_id
)

select
  stream,
  table_name,
  count(*) as rows,
  array_agg(id order by id) as ids
from synced
group by stream, table_name
order by stream, table_name;
