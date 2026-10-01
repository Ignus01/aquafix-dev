-- Field app "Add New Load" captures who delivered the load and in which
-- vehicle. Both are optional free text.

alter table public.load
  add column driver text,
  add column vehicle_reg_nr text;

grant insert (driver, vehicle_reg_nr) on public.load to authenticated;
grant update (driver, vehicle_reg_nr) on public.load to authenticated;
