-- Source-system identity for migrated photos (see
-- 20261003130000_odata_migration_transaction_ids.sql for their parents). The
-- migration skips a photo once its odata_id is here, which is what lets it
-- resume across the many runs ~10,000 photos take.

alter table public.incident_image add column odata_id text;
alter table public.inspection_image add column odata_id text;

create unique index incident_image_odata_id_key on public.incident_image (odata_id);
create unique index inspection_image_odata_id_key on public.inspection_image (odata_id);
