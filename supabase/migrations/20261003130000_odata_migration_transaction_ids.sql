-- Source-system identity for migrated transactions (see
-- 20261003120000_odata_migration_ids.sql for the reference data).

alter table public.instruction add column odata_id text;
alter table public.instruction_asset_allocation add column odata_id text;
alter table public.inspection_activity add column odata_id text;
alter table public.inspection_value add column odata_id text;
alter table public.inspection_cumulative_value add column odata_id text;
alter table public.incident add column odata_id text;
alter table public.incident_note add column odata_id text;
alter table public.service add column odata_id text;

create unique index instruction_odata_id_key on public.instruction (odata_id);
create unique index instruction_asset_allocation_odata_id_key on public.instruction_asset_allocation (odata_id);
create unique index inspection_activity_odata_id_key on public.inspection_activity (odata_id);
create unique index inspection_value_odata_id_key on public.inspection_value (odata_id);
create unique index inspection_cumulative_value_odata_id_key on public.inspection_cumulative_value (odata_id);
create unique index incident_odata_id_key on public.incident (odata_id);
create unique index incident_note_odata_id_key on public.incident_note (odata_id);
create unique index service_odata_id_key on public.service (odata_id);
