-- Grid redesign, phase 0.1 (docs/grid-redesign-plan.md).
--
-- The back-office grids now load one page at a time, sorted by Changed
-- (updated_at) newest first by default, so each grid's base table needs an
-- index that serves "order by updated_at desc, id limit N" without sorting
-- the whole table. The other indexes serve each grid's other common sorts.
--
-- logger_reading has no updated_at and already has (reading_at desc); its
-- grid sorts by reading_at (a recorded exception to Changed / Changed by).

-- Inspection Values sorted by when they were captured (16 s → <1 s in prod).
create index if not exists inspection_value_created_at_idx
  on public.inspection_value (created_at desc, id);
create index if not exists inspection_activity_inspection_date_idx
  on public.inspection_activity (inspection_date desc, id);

-- Changed, newest first: the default sort of every server-mode grid.
create index if not exists instruction_updated_at_idx
  on public.instruction (updated_at desc, id);
create index if not exists inspection_activity_updated_at_idx
  on public.inspection_activity (updated_at desc, id);
create index if not exists inspection_value_updated_at_idx
  on public.inspection_value (updated_at desc, id);
create index if not exists inspection_cumulative_value_updated_at_idx
  on public.inspection_cumulative_value (updated_at desc, id);
create index if not exists scheduled_instruction_updated_at_idx
  on public.scheduled_instruction (updated_at desc, id);
create index if not exists incident_updated_at_idx
  on public.incident (updated_at desc, id);
create index if not exists service_updated_at_idx
  on public.service (updated_at desc, id);
