-- water_quality_reading: leave out site answers that aren't readings.
--
-- pH, Total hardness and Nitrate were captured as TEXT inspections before
-- they became DECIMAL_VALUE. Their old answers include notes ("N/A", "No
-- stock") and blanks, which now read as 0 because a DECIMAL_VALUE always has
-- a value (default 0); pH 0 then shows as out of spec. A site value now counts
-- when its saved answer is a number or its value isn't 0. New saves always
-- store the number as the display value, so they're unaffected.

create or replace view public.water_quality_reading
with (security_invoker = true)
as
select w.source, w.id, w.location_id, w.asset_id, w.asset_name, w.sampled_on, w.sampled_at,
       w.reference, w.sample_id, w.inspection_activity_id, w.parameter_id, w.value, w.below_detection,
       l.name as location_name, l.region_id, l.organisation_id,
       p.name as parameter_name, p.short_name as parameter_short_name, p.unit,
       p.min_acceptable, p.max_acceptable, p.decimals, p.sort_order,
       public.lab_result_status(w.value, w.below_detection, p.min_acceptable, p.max_acceptable) as status
from (
  select 'lab'::text as source,
         r.id,
         s.location_id,
         null::uuid as asset_id,
         null::text as asset_name,
         s.sampled_on,
         null::timestamptz as sampled_at,
         s.lab_no as reference,
         s.id as sample_id,
         null::uuid as inspection_activity_id,
         r.parameter_id,
         r.value,
         r.below_detection
  from public.lab_result r
  join public.lab_sample s on s.id = r.sample_id
  union all
  select 'site',
         v.id,
         a.location_id,
         a.id,
         a.name,
         (ia.inspection_date at time zone public.app_time_zone())::date,
         ia.inspection_date,
         ia.legacy_uid::text,
         null,
         ia.id,
         i.quality_parameter_id,
         v.decimal_value,
         false
  from public.inspection_value v
  join public.inspection i on i.id = v.inspection_id
  join public.inspection_activity ia on ia.id = v.inspection_activity_id
  join public.asset a on a.id = ia.asset_id
  where i.is_water_quality_parameter
    and v.is_current
    and (v.decimal_value <> 0 or btrim(v.display_value) ~ '^-?[0-9]+([.,][0-9]+)?$')
) w
join public.location l on l.id = w.location_id
join public.quality_parameter p on p.id = w.parameter_id;
