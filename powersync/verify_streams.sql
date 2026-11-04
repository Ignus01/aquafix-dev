-- The rows PowerSync should send to one user, per table: the filters in
-- powersync/sync-config.yaml, written in Postgres. Compare with what lands
-- on a test phone: for each table, the phone's local SQLite table should
-- hold exactly `rows` rows, with exactly these ids. A table that isn't
-- listed should be empty on the phone. A table synced by two streams
-- (incident, incident_note, incident_image: open_incidents and
-- my_incidents) holds each row once, so rows counts distinct ids; `streams`
-- says which streams sent rows.
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

-- id is text: my_roles makes its own (user_id:role).
synced as (
  -- reference_data: the same rows for every capture user.
  select 'reference_data' as stream, 'asset' as table_name, t.id::text as id from public.asset t, capture_user
  union all select 'reference_data', 'asset_type', t.id::text from public.asset_type t, capture_user
  union all select 'reference_data', 'location', t.id::text from public.location t, capture_user
  union all select 'reference_data', 'grading', t.id::text from public.grading t, capture_user
  union all select 'reference_data', 'colour_container', t.id::text from public.colour_container t, capture_user
  union all select 'reference_data', 'inspection', t.id::text from public.inspection t, capture_user
  union all select 'reference_data', 'inspection_drop_down_option', t.id::text from public.inspection_drop_down_option t, capture_user
  union all select 'reference_data', 'inspection_rule', t.id::text from public.inspection_rule t, capture_user
  union all select 'reference_data', 'feedback', t.id::text from public.feedback t, capture_user
  union all select 'reference_data', 'inspection_allocation', t.id::text from public.inspection_allocation t, capture_user
  union all select 'reference_data', 'quality_parameter', t.id::text from public.quality_parameter t, capture_user
  union all select 'reference_data', 'inspection_cumulative_value', t.id::text from public.inspection_cumulative_value t, capture_user
  union all select 'reference_data', 'incident_type', t.id::text from public.incident_type t, capture_user
  union all select 'reference_data', 'storage_area', t.id::text from public.storage_area t, capture_user
  union all select 'reference_data', 'item', t.id::text from public.item t, capture_user
  union all select 'reference_data', 'mobile_app_config', t.id::text from public.mobile_app_config t, capture_user
  union all select 'reference_data', 'profiles', t.id::text from public.profiles t, capture_user

  -- my_instructions
  union all
  select 'my_instructions', 'instruction', t.id::text
  from public.instruction t
  join capture_user u on t.account_id = u.user_id
  where t.in_sync_window = true
  union all
  select 'my_instructions', 'instruction_asset_allocation', t.id::text
  from public.instruction_asset_allocation t
  join capture_user u on t.sync_user_id = u.user_id

  -- my_inspections
  union all
  select 'my_inspections', 'inspection_activity', t.id::text
  from public.inspection_activity t
  join capture_user u on t.created_by = u.user_id
  where t.in_sync_window = true
  union all
  select 'my_inspections', 'inspection_value', t.id::text
  from public.inspection_value t
  join capture_user u on t.sync_user_id = u.user_id
  union all
  select 'my_inspections', 'inspection_image', t.id::text
  from public.inspection_image t
  join capture_user u on t.sync_user_id = u.user_id

  -- open_incidents
  union all
  select 'open_incidents', 'incident', t.id::text
  from public.incident t, capture_user
  where t.status <> 'completed'
  union all
  select 'open_incidents', 'incident_note', t.id::text
  from public.incident_note t, capture_user
  where t.incident_open = true
  union all
  select 'open_incidents', 'incident_image', t.id::text
  from public.incident_image t, capture_user
  where t.incident_open = true

  -- my_incidents
  union all
  select 'my_incidents', 'incident', t.id::text
  from public.incident t
  join capture_user u on t.sync_user_id = u.user_id
  union all
  select 'my_incidents', 'incident_note', t.id::text
  from public.incident_note t
  join capture_user u on t.sync_user_id = u.user_id
  union all
  select 'my_incidents', 'incident_image', t.id::text
  from public.incident_image t
  join capture_user u on t.sync_user_id = u.user_id

  -- open_services
  union all
  select 'open_services', 'service', t.id::text
  from public.service t, capture_user
  where t.is_completed = false
  union all
  select 'open_services', 'organisation', t.id::text
  from public.organisation t, capture_user
  where t.is_service_supplier = true

  -- my_stock
  union all
  select 'my_stock', 'transfer_main', t.id::text
  from public.transfer_main t
  join capture_user u on t.sync_user_id = u.user_id
  union all
  select 'my_stock', 'transfer_item', t.id::text
  from public.transfer_item t
  join capture_user u on t.sync_user_id = u.user_id
  union all
  select 'my_stock', 'work_order', t.id::text
  from public.work_order t
  join capture_user u on t.sync_user_id = u.user_id
  union all
  select 'my_stock', 'work_order_item', t.id::text
  from public.work_order_item t
  join capture_user u on t.sync_user_id = u.user_id
  union all
  select 'my_stock', 'stock_take', t.id::text
  from public.stock_take t
  join capture_user u on t.sync_user_id = u.user_id
  union all
  select 'my_stock', 'stock_take_item', t.id::text
  from public.stock_take_item t
  join capture_user u on t.sync_user_id = u.user_id
  union all
  select 'my_stock', 'load', t.id::text
  from public.load t
  join capture_user u on t.sync_user_id = u.user_id

  -- my_roles
  union all
  select 'my_roles', 'user_masterdata_roles', t.user_id::text || ':' || t.role::text
  from public.user_masterdata_roles t
  join capture_user u on t.user_id = u.user_id
)

select
  table_name,
  array_agg(distinct stream order by stream) as streams,
  count(distinct id) as rows,
  array_agg(distinct id order by id) as ids
from synced
group by table_name
order by table_name;
