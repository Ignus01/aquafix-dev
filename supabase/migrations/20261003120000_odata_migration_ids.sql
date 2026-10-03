-- Source-system identity for the OData migration (Settings → Data migration).
-- Each migrated row remembers the Mendix object ID it came from, so the
-- migration can be re-run: rows that already have the ID are updated, the rest
-- are created. Stored as text because Mendix IDs exceed 2^53 and would lose
-- precision as JSON numbers.

alter table public.region add column odata_id text;
alter table public.organisation add column odata_id text;
alter table public.colour_container add column odata_id text;
alter table public.asset_type add column odata_id text;
alter table public.location add column odata_id text;
alter table public.grading add column odata_id text;
alter table public.asset add column odata_id text;
alter table public.incident_type add column odata_id text;
alter table public.inspection add column odata_id text;
alter table public.inspection_allocation add column odata_id text;
alter table public.inspection_drop_down_option add column odata_id text;
alter table public.inspection_rule add column odata_id text;

create unique index region_odata_id_key on public.region (odata_id);
create unique index organisation_odata_id_key on public.organisation (odata_id);
create unique index colour_container_odata_id_key on public.colour_container (odata_id);
create unique index asset_type_odata_id_key on public.asset_type (odata_id);
create unique index location_odata_id_key on public.location (odata_id);
create unique index grading_odata_id_key on public.grading (odata_id);
create unique index asset_odata_id_key on public.asset (odata_id);
create unique index incident_type_odata_id_key on public.incident_type (odata_id);
create unique index inspection_odata_id_key on public.inspection (odata_id);
create unique index inspection_allocation_odata_id_key on public.inspection_allocation (odata_id);
create unique index inspection_drop_down_option_odata_id_key on public.inspection_drop_down_option (odata_id);
create unique index inspection_rule_odata_id_key on public.inspection_rule (odata_id);
