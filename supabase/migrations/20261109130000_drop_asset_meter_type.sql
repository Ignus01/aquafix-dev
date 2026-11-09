-- Drop asset.meter_type (Phase 2 of "Billing and Meter Classification").
--
-- Since 20261109120000_asset_classification.sql the asset type's
-- classification says what a meter measures, and nothing reads
-- asset.meter_type. Ship this only once Phase 1 has run in production for a
-- few days: until then the column is the way back. Each moved asset's old
-- value stays in asset_type_migration_log.old_meter_type.

alter table public.asset drop column meter_type;
drop type public.meter_type;
