-- Quality: lab results (spec: spec/quality/Quality lab results — spec.md).
--
-- Water-quality lab certificates (.xlsx) are uploaded, parsed by the web app
-- into lab_import.parsed, and imported by commit_lab_import() as one sample
-- per certificate row and one result per parameter. A lab's columns and
-- localities are mapped to Aquafix parameters and locations once per lab
-- (lab_parameter_map, lab_location_map) and reused by later imports.
--
-- Out-of-spec is never stored: lab_result_status() compares a result with its
-- parameter's current limits whenever it is read, so changing a limit
-- re-colours past results too.
--
-- Access: everyone with a masterdata role reads; only system admins and
-- admins import, map, and edit parameters and labs.

create type public.lab_import_status as enum ('staged', 'imported', 'cancelled');

-- Audit columns come from the session, never the client (service-role writes
-- have no auth.uid() and keep what they set).
create function public.set_quality_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

create function public.is_quality_admin()
returns boolean
language sql
stable
as $$
  select public.has_masterdata_role(array['system_admin','admin']::public.masterdata_role[]);
$$;

create function public.is_quality_reader()
returns boolean
language sql
stable
as $$
  select public.has_masterdata_role(array['system_admin','admin','user','viewer']::public.masterdata_role[]);
$$;

-- ============================================================================
-- lab — the laboratory that issued a certificate, matched on its name (A1).
-- ============================================================================
create table public.lab (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint lab_name_not_blank check (btrim(name) <> '')
);

create unique index lab_name_key on public.lab (lower(btrim(name)));

create trigger lab_set_audit_fields
  before insert or update on public.lab
  for each row execute function public.set_quality_audit_fields();

alter table public.lab enable row level security;

-- ============================================================================
-- quality_parameter — Aquafix's own parameters, with acceptable levels.
-- ============================================================================
create table public.quality_parameter (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  unit text not null,
  min_acceptable numeric,
  max_acceptable numeric,
  -- When false, a negative value in a file means "below detection limit".
  can_be_negative boolean not null default false,
  decimals smallint not null default 2,
  standard text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint quality_parameter_name_not_blank check (btrim(name) <> ''),
  constraint quality_parameter_unit_not_blank check (btrim(unit) <> ''),
  constraint quality_parameter_decimals_check check (decimals between 0 and 6),
  constraint quality_parameter_range_check check (
    min_acceptable is null or max_acceptable is null or min_acceptable <= max_acceptable)
);

create unique index quality_parameter_name_key on public.quality_parameter (lower(btrim(name)));

create trigger quality_parameter_set_audit_fields
  before insert or update on public.quality_parameter
  for each row execute function public.set_quality_audit_fields();

alter table public.quality_parameter enable row level security;

-- ============================================================================
-- lab_parameter_map — lab + lab column → parameter (null = ignore the column)
-- ============================================================================
create table public.lab_parameter_map (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references public.lab (id) on delete cascade,
  -- The cleaned row-5 header, e.g. "20 - EC".
  lab_parameter text not null,
  -- The unit seen when the mapping was made.
  lab_unit text,
  parameter_id uuid references public.quality_parameter (id) on delete restrict,
  -- File value × factor = value in the parameter's unit.
  factor numeric not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint lab_parameter_map_lab_parameter_not_blank check (btrim(lab_parameter) <> ''),
  constraint lab_parameter_map_factor_check check (factor > 0)
);

create unique index lab_parameter_map_lab_parameter_key
  on public.lab_parameter_map (lab_id, lower(lab_parameter));
create index lab_parameter_map_parameter_id_idx on public.lab_parameter_map (parameter_id);

create trigger lab_parameter_map_set_audit_fields
  before insert or update on public.lab_parameter_map
  for each row execute function public.set_quality_audit_fields();

alter table public.lab_parameter_map enable row level security;

-- ============================================================================
-- lab_location_map — lab + locality → location (null = skip its samples)
-- ============================================================================
create table public.lab_location_map (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references public.lab (id) on delete cascade,
  lab_locality text not null,
  location_id uuid references public.location (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint lab_location_map_lab_locality_not_blank check (btrim(lab_locality) <> '')
);

create unique index lab_location_map_lab_locality_key
  on public.lab_location_map (lab_id, lower(lab_locality));
create index lab_location_map_location_id_idx on public.lab_location_map (location_id);

create trigger lab_location_map_set_audit_fields
  before insert or update on public.lab_location_map
  for each row execute function public.set_quality_audit_fields();

alter table public.lab_location_map enable row level security;

-- ============================================================================
-- lab_import — one uploaded file. `parsed` is the sheet as the web app read
-- it, so the commit step doesn't parse again:
--   { lab_name, client_name, batch_no,
--     columns: [ { header, unit } ],
--     rows: [ { row, lab_no, locality, sample_type, sampled_on, values: [number|null] } ],
--     warnings: [text] }
-- values[i] belongs to columns[i].
-- ============================================================================
create table public.lab_import (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid references public.lab (id) on delete restrict,
  lab_name text not null,
  client_name text,
  batch_no text,
  file_name text not null,
  storage_path text not null unique,
  status public.lab_import_status not null default 'staged',
  parsed jsonb not null,
  samples_imported integer,
  samples_skipped integer,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  imported_at timestamptz,
  imported_by uuid references auth.users (id) on delete set null,
  constraint lab_import_file_name_not_blank check (btrim(file_name) <> ''),
  constraint lab_import_imported_check check ((status = 'imported') = (imported_at is not null))
);

create index lab_import_lab_id_idx on public.lab_import (lab_id);
create index lab_import_status_idx on public.lab_import (status, created_at desc);

-- Stamps the creator and importer; an import only leaves `staged`, once.
create function public.lab_import_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.status := 'staged';
    new.imported_at := null;
    new.imported_by := null;
    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if new.status is distinct from old.status then
    if old.status <> 'staged' then
      raise exception using errcode = 'P0001', message = 'This import is no longer staged.';
    end if;
    if new.status = 'imported' then
      new.imported_at := now();
      new.imported_by := coalesce(auth.uid(), new.imported_by);
    end if;
  else
    new.imported_at := old.imported_at;
    new.imported_by := old.imported_by;
  end if;
  return new;
end;
$$;

create trigger lab_import_set_audit_fields
  before insert or update on public.lab_import
  for each row execute function public.lab_import_audit();

alter table public.lab_import enable row level security;

-- ============================================================================
-- lab_sample — one certificate row. A lab's sample number is imported once.
-- ============================================================================
create table public.lab_sample (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.lab_import (id) on delete cascade,
  lab_id uuid not null references public.lab (id) on delete restrict,
  location_id uuid not null references public.location (id) on delete restrict,
  lab_no text not null,
  lab_locality text,
  sample_type text,
  sampled_on date not null,
  constraint lab_sample_lab_no_not_blank check (btrim(lab_no) <> ''),
  constraint lab_sample_lab_no_key unique (lab_id, lab_no)
);

create index lab_sample_import_id_idx on public.lab_sample (import_id);
create index lab_sample_location_idx on public.lab_sample (location_id, sampled_on desc);
create index lab_sample_sampled_on_idx on public.lab_sample (sampled_on desc);

alter table public.lab_sample enable row level security;

-- ============================================================================
-- lab_result — one value of one parameter in one sample.
-- ============================================================================
create table public.lab_result (
  id uuid primary key default gen_random_uuid(),
  sample_id uuid not null references public.lab_sample (id) on delete cascade,
  parameter_id uuid not null references public.quality_parameter (id) on delete restrict,
  -- As in the file, e.g. -0.002.
  raw_value numeric not null,
  -- In the parameter's unit after the factor; positive for "< value".
  value numeric not null,
  below_detection boolean not null default false,
  lab_parameter text,
  lab_unit text,
  constraint lab_result_sample_parameter_key unique (sample_id, parameter_id)
);

create index lab_result_parameter_id_idx on public.lab_result (parameter_id);

alter table public.lab_result enable row level security;

-- ============================================================================
-- RLS: every masterdata role reads; system admins and admins write.
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['lab', 'quality_parameter', 'lab_parameter_map', 'lab_location_map',
                           'lab_import', 'lab_sample', 'lab_result']
  loop
    execute format(
      $sql$
        create policy %1$I_select on public.%1$I for select
          to authenticated
          using (public.is_quality_reader());

        create policy %1$I_insert on public.%1$I for insert
          to authenticated
          with check (public.is_quality_admin());

        create policy %1$I_update on public.%1$I for update
          to authenticated
          using (public.is_quality_admin())
          with check (public.is_quality_admin());

        create policy %1$I_delete on public.%1$I for delete
          to authenticated
          using (public.is_quality_admin());
      $sql$,
      t
    );
  end loop;
end;
$$;

-- A staged import can only point at a file the caller uploaded to their own
-- folder.
drop policy lab_import_insert on public.lab_import;
create policy lab_import_insert on public.lab_import for insert
  to authenticated
  with check (
    public.is_quality_admin()
    and split_part(storage_path, '/', 1) = auth.uid()::text
  );

-- ============================================================================
-- lab_result_status — a result against its parameter's limits:
--   'no_limit'      no min and no max
--   'ok'            within the limits
--   'high' / 'low'  above the max / below the min
--   'inconclusive'  below detection, but the detection limit is above the max
-- A below-detection value ("< value") is acceptable against a max of 0 ("not
-- detected", e.g. E. coli < 1) and low against any min above 0.
-- ============================================================================
create function public.lab_result_status(
  p_value numeric,
  p_below_detection boolean,
  p_min numeric,
  p_max numeric
)
returns text
language sql
immutable
as $$
  select case
    when p_min is null and p_max is null then 'no_limit'
    when p_value is null then null
    when coalesce(p_below_detection, false) then
      case
        when p_min is not null and p_min > 0 then 'low'
        when p_max is null or p_max = 0 or p_value <= p_max then 'ok'
        else 'inconclusive'
      end
    when p_max is not null and p_value > p_max then 'high'
    when p_min is not null and p_value < p_min then 'low'
    else 'ok'
  end;
$$;

-- ============================================================================
-- Views for the Lab Results pages (security_invoker: the caller's RLS).
-- ============================================================================
create view public.lab_result_view
with (security_invoker = true)
as
select r.id, r.sample_id, r.parameter_id, r.raw_value, r.value, r.below_detection,
       r.lab_parameter, r.lab_unit,
       p.name as parameter_name, p.short_name as parameter_short_name, p.unit,
       p.min_acceptable, p.max_acceptable, p.decimals, p.sort_order,
       public.lab_result_status(r.value, r.below_detection, p.min_acceptable, p.max_acceptable) as status
from public.lab_result r
join public.quality_parameter p on p.id = r.parameter_id;

create view public.lab_sample_overview
with (security_invoker = true)
as
select s.id, s.import_id, s.lab_id, s.location_id, s.lab_no, s.lab_locality, s.sample_type, s.sampled_on,
       l.name as location_name, l.region_id, l.organisation_id,
       lb.name as lab_name,
       i.batch_no, i.client_name, i.file_name, i.imported_at, i.imported_by,
       coalesce(st.results, 0) as results,
       coalesce(st.out_of_spec, 0) as out_of_spec,
       coalesce(st.inconclusive, 0) as inconclusive,
       coalesce(st.out_of_spec_names, '{}') as out_of_spec_names
from public.lab_sample s
join public.location l on l.id = s.location_id
join public.lab lb on lb.id = s.lab_id
join public.lab_import i on i.id = s.import_id
left join lateral (
  select count(*)::integer as results,
         count(*) filter (where v.status in ('high', 'low'))::integer as out_of_spec,
         count(*) filter (where v.status = 'inconclusive')::integer as inconclusive,
         array_agg(coalesce(v.parameter_short_name, v.parameter_name) order by v.sort_order, v.parameter_name)
           filter (where v.status in ('high', 'low')) as out_of_spec_names
  from public.lab_result_view v
  where v.sample_id = s.id
) st on true;

grant select on public.lab_result_view, public.lab_sample_overview to authenticated;

-- ============================================================================
-- commit_lab_import — imports staged files in one transaction. SECURITY
-- INVOKER: the caller's RLS applies.
--
--   p_import_ids      staged lab_import rows, imported oldest first (so the
--                     first file wins when two carry the same lab no)
--   p_lab             { "<lab name as in A1>": "<existing lab id>" } to file a
--                     lab name under an existing lab (e.g. a renamed lab).
--                     Any other name is matched to a lab case-insensitively,
--                     or added as a new lab.
--   p_parameter_maps  [ { lab_name, lab_parameter, lab_unit, parameter_id|null, factor } ]
--   p_location_maps   [ { lab_name, lab_locality, location_id|null } ]
--                     Mappings chosen in the Map step; saved (upserted) first,
--                     so every later import reuses them.
--   p_replace         re-import samples whose lab no was imported before
--
-- Returns { files, imported, skipped, replaced }.
-- ============================================================================
create function public.commit_lab_import(
  p_import_ids uuid[],
  p_lab jsonb default '{}'::jsonb,
  p_parameter_maps jsonb default '[]'::jsonb,
  p_location_maps jsonb default '[]'::jsonb,
  p_replace boolean default false
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_labs jsonb := '{}'::jsonb;      -- lower(btrim(lab name)) -> lab id
  v_imp public.lab_import;
  v_lab_id uuid;
  v_name text;
  v_key text;
  v_cols jsonb;
  v_col jsonb;
  v_row jsonb;
  v_map public.lab_parameter_map;
  v_loc public.lab_location_map;
  v_param public.quality_parameter;
  v_param_ids uuid[];
  v_factors numeric[];
  v_negative boolean[];
  v_headers text[];
  v_seen text[] := '{}';
  v_sample_id uuid;
  v_raw numeric;
  v_below boolean;
  v_imported integer;
  v_skipped integer;
  v_total_imported integer := 0;
  v_total_skipped integer := 0;
  v_replaced integer := 0;
  v_files integer := 0;
  v_count integer;
  v_clash integer;
  v_factor numeric;
  e jsonb;
  i integer;
  j integer;
begin
  if not public.is_quality_admin() then
    raise exception using errcode = '42501', message = 'Only system admins and admins can import lab results.';
  end if;
  if p_import_ids is null or cardinality(p_import_ids) = 0 then
    raise exception using errcode = 'P0001', message = 'Choose the files to import.';
  end if;

  select count(*) into v_count
  from public.lab_import
  where id = any (p_import_ids) and status = 'staged';
  if v_count < (select count(distinct x) from unnest(p_import_ids) x) then
    raise exception using errcode = 'P0001',
      message = 'One of these files was already imported or cancelled. Start the import again.';
  end if;
  perform 1 from public.lab_import where id = any (p_import_ids) for update;

  -- 1. Labs: the caller's choice, else the lab of that name, else a new one.
  for v_name in
    select distinct btrim(lab_name) from public.lab_import where id = any (p_import_ids)
  loop
    v_key := lower(v_name);
    v_lab_id := null;
    select nullif(x.value #>> '{}', '')::uuid into v_lab_id
    from jsonb_each(coalesce(p_lab, '{}'::jsonb)) x
    where lower(btrim(x.key)) = v_key
    limit 1;
    if v_lab_id is not null and not exists (select 1 from public.lab where id = v_lab_id) then
      raise exception using errcode = 'P0001', message = 'That lab no longer exists.';
    end if;
    if v_lab_id is null then
      select id into v_lab_id from public.lab where lower(btrim(name)) = v_key;
    end if;
    if v_lab_id is null then
      insert into public.lab (name) values (v_name) returning id into v_lab_id;
    end if;
    v_labs := v_labs || jsonb_build_object(v_key, v_lab_id);
    update public.lab_import set lab_id = v_lab_id
    where id = any (p_import_ids) and lower(btrim(lab_name)) = v_key;
  end loop;

  -- 2. Save the mappings chosen in the Map step.
  for e in select * from jsonb_array_elements(coalesce(p_parameter_maps, '[]'::jsonb))
  loop
    v_lab_id := (v_labs ->> lower(btrim(coalesce(e ->> 'lab_name', ''))))::uuid;
    if v_lab_id is null then
      raise exception using errcode = 'P0001',
        message = format('The mapping for "%s" names a lab that isn''t in these files.', e ->> 'lab_parameter');
    end if;
    if nullif(btrim(coalesce(e ->> 'lab_parameter', '')), '') is null then
      raise exception using errcode = 'P0001', message = 'A parameter mapping has no lab parameter.';
    end if;
    v_factor := coalesce(nullif(e ->> 'factor', '')::numeric, 1);
    if v_factor <= 0 then
      raise exception using errcode = 'P0001',
        message = format('The factor for "%s" must be more than 0.', e ->> 'lab_parameter');
    end if;
    if nullif(e ->> 'parameter_id', '') is not null then
      select * into v_param from public.quality_parameter where id = (e ->> 'parameter_id')::uuid;
      if not found then
        raise exception using errcode = 'P0001',
          message = format('The parameter chosen for "%s" no longer exists.', e ->> 'lab_parameter');
      end if;
      -- Inactive parameters can't be picked in new mappings; a saved one stays.
      if not v_param.active and not exists (
        select 1 from public.lab_parameter_map
        where lab_id = v_lab_id and lower(lab_parameter) = lower(btrim(e ->> 'lab_parameter'))
          and parameter_id = v_param.id) then
        raise exception using errcode = 'P0001',
          message = format('%s is inactive, so "%s" can''t be mapped to it.', v_param.name, e ->> 'lab_parameter');
      end if;
    end if;
    insert into public.lab_parameter_map (lab_id, lab_parameter, lab_unit, parameter_id, factor)
    values (
      v_lab_id,
      btrim(e ->> 'lab_parameter'),
      nullif(btrim(coalesce(e ->> 'lab_unit', '')), ''),
      nullif(e ->> 'parameter_id', '')::uuid,
      case when nullif(e ->> 'parameter_id', '') is null then 1 else v_factor end
    )
    on conflict (lab_id, lower(lab_parameter)) do update
      set lab_unit = excluded.lab_unit,
          parameter_id = excluded.parameter_id,
          factor = excluded.factor;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_location_maps, '[]'::jsonb))
  loop
    v_lab_id := (v_labs ->> lower(btrim(coalesce(e ->> 'lab_name', ''))))::uuid;
    if v_lab_id is null then
      raise exception using errcode = 'P0001',
        message = format('The mapping for "%s" names a lab that isn''t in these files.', e ->> 'lab_locality');
    end if;
    if nullif(btrim(coalesce(e ->> 'lab_locality', '')), '') is null then
      raise exception using errcode = 'P0001', message = 'A location mapping has no lab locality.';
    end if;
    if nullif(e ->> 'location_id', '') is not null
      and not exists (select 1 from public.location where id = (e ->> 'location_id')::uuid) then
      raise exception using errcode = 'P0001',
        message = format('The location chosen for "%s" no longer exists.', e ->> 'lab_locality');
    end if;
    insert into public.lab_location_map (lab_id, lab_locality, location_id)
    values (v_lab_id, btrim(e ->> 'lab_locality'), nullif(e ->> 'location_id', '')::uuid)
    on conflict (lab_id, lower(lab_locality)) do update
      set location_id = excluded.location_id;
  end loop;

  -- 3. Samples and results, file by file.
  for v_imp in
    select * from public.lab_import where id = any (p_import_ids) order by created_at, id
  loop
    v_files := v_files + 1;
    v_imported := 0;
    v_skipped := 0;
    v_cols := coalesce(v_imp.parsed -> 'columns', '[]'::jsonb);
    v_param_ids := '{}';
    v_factors := '{}';
    v_negative := '{}';
    v_headers := '{}';

    -- Resolve every column through the saved mappings.
    for i in 0 .. jsonb_array_length(v_cols) - 1 loop
      v_col := v_cols -> i;
      select * into v_map
      from public.lab_parameter_map
      where lab_id = v_imp.lab_id and lower(lab_parameter) = lower(btrim(v_col ->> 'header'));
      if not found then
        raise exception using errcode = 'P0001',
          message = format('Column "%s" in %s has no mapping. Map it to a parameter or ignore it.',
                           v_col ->> 'header', v_imp.file_name);
      end if;
      if v_map.parameter_id is not null
        and lower(btrim(coalesce(v_map.lab_unit, ''))) <> lower(btrim(coalesce(v_col ->> 'unit', ''))) then
        raise exception using errcode = 'P0001',
          message = format('"%s" was mapped with unit %s; %s says %s. Confirm its mapping.',
                           v_col ->> 'header', coalesce(v_map.lab_unit, '(none)'), v_imp.file_name,
                           coalesce(nullif(v_col ->> 'unit', ''), '(none)'));
      end if;
      v_headers := v_headers || (v_col ->> 'header');
      v_param_ids := v_param_ids || v_map.parameter_id;
      v_factors := v_factors || v_map.factor;
      if v_map.parameter_id is null then
        v_negative := v_negative || false;
      else
        v_negative := v_negative || (select can_be_negative from public.quality_parameter where id = v_map.parameter_id);
        -- Two columns into one parameter.
        for j in 1 .. cardinality(v_param_ids) - 1 loop
          if v_param_ids[j] = v_map.parameter_id then
            raise exception using errcode = 'P0001',
              message = format('"%s" and "%s" both map to %s. Ignore one of them.',
                               v_headers[j], v_col ->> 'header',
                               (select name from public.quality_parameter where id = v_map.parameter_id));
          end if;
        end loop;
      end if;
    end loop;

    for v_row in select * from jsonb_array_elements(coalesce(v_imp.parsed -> 'rows', '[]'::jsonb))
    loop
      select * into v_loc
      from public.lab_location_map
      where lab_id = v_imp.lab_id and lower(lab_locality) = lower(btrim(coalesce(v_row ->> 'locality', '')));
      if not found then
        raise exception using errcode = 'P0001',
          message = format('Locality "%s" in %s has no mapping. Map it to a location or ignore it.',
                           v_row ->> 'locality', v_imp.file_name);
      end if;
      if v_loc.location_id is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      if nullif(btrim(coalesce(v_row ->> 'lab_no', '')), '') is null
        or nullif(v_row ->> 'sampled_on', '') is null then
        raise exception using errcode = 'P0001',
          message = format('Row %s of %s: the lab no or sampled date is missing.', v_row ->> 'row', v_imp.file_name);
      end if;

      -- Same lab no twice in this upload: the first one wins.
      if (v_imp.lab_id::text || ':' || (v_row ->> 'lab_no')) = any (v_seen) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if exists (select 1 from public.lab_sample where lab_id = v_imp.lab_id and lab_no = v_row ->> 'lab_no') then
        if not coalesce(p_replace, false) then
          v_skipped := v_skipped + 1;
          continue;
        end if;
        delete from public.lab_sample where lab_id = v_imp.lab_id and lab_no = v_row ->> 'lab_no';
        get diagnostics v_clash = row_count;
        if v_clash = 0 then
          raise exception using errcode = '42501', message = 'You can''t replace samples.';
        end if;
        v_replaced := v_replaced + 1;
      end if;
      v_seen := v_seen || (v_imp.lab_id::text || ':' || (v_row ->> 'lab_no'));

      insert into public.lab_sample (import_id, lab_id, location_id, lab_no, lab_locality, sample_type, sampled_on)
      values (v_imp.id, v_imp.lab_id, v_loc.location_id, btrim(v_row ->> 'lab_no'),
              nullif(btrim(coalesce(v_row ->> 'locality', '')), ''),
              nullif(btrim(coalesce(v_row ->> 'sample_type', '')), ''),
              (v_row ->> 'sampled_on')::date)
      returning id into v_sample_id;

      for i in 1 .. cardinality(v_param_ids) loop
        continue when v_param_ids[i] is null;
        v_raw := nullif(v_row -> 'values' ->> (i - 1), '')::numeric;
        continue when v_raw is null;
        v_below := v_raw < 0 and not v_negative[i];
        insert into public.lab_result (sample_id, parameter_id, raw_value, value, below_detection, lab_parameter, lab_unit)
        values (v_sample_id, v_param_ids[i], v_raw,
                case when v_below then abs(v_raw) else v_raw end * v_factors[i],
                v_below, v_headers[i], nullif(v_cols -> (i - 1) ->> 'unit', ''));
      end loop;
      v_imported := v_imported + 1;
    end loop;

    update public.lab_import
    set status = 'imported', samples_imported = v_imported, samples_skipped = v_skipped
    where id = v_imp.id;
    v_total_imported := v_total_imported + v_imported;
    v_total_skipped := v_total_skipped + v_skipped;
  end loop;

  return jsonb_build_object(
    'files', v_files,
    'imported', v_total_imported,
    'skipped', v_total_skipped,
    'replaced', v_replaced
  );
end;
$$;

revoke execute on function public.commit_lab_import(uuid[], jsonb, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.commit_lab_import(uuid[], jsonb, jsonb, jsonb, boolean) to authenticated;

-- ============================================================================
-- Storage: private bucket `lab-results` (10 MB, .xlsx only). Uploads go into
-- the uploader's own folder (`<auth.uid()>/<uuid>-<name>`); a file is readable
-- by its uploader, and by every reader once an import points at it.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lab-results', 'lab-results', false, 10485760,
        array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/octet-stream'])
on conflict (id) do nothing;

create policy lab_results_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'lab-results'
    and (storage.foldername(name))[1] = auth.uid()::text
    and lower(storage.extension(name)) = 'xlsx'
    and public.is_quality_admin()
  );

create policy lab_results_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lab-results'
    and (
      owner_id = auth.uid()::text
      or (public.is_quality_reader()
          and exists (select 1 from public.lab_import li where li.storage_path = objects.name))
    )
  );

create policy lab_results_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'lab-results'
    and (owner_id = auth.uid()::text or public.is_quality_admin())
  );

-- ============================================================================
-- Seed: the parameters in the CP-01 certificates, with SANS 241-1:2015
-- drinking-water limits as a starting point (editable on the Parameters page).
-- Nitrate is reported as NO₃, so its limit is SANS's 11 mg/l as N × 4.43.
-- ============================================================================
insert into public.quality_parameter
  (name, short_name, unit, min_acceptable, max_acceptable, can_be_negative, decimals, standard, sort_order)
values
  ('pH',                         'pH',      'pH',          5,    9.7,   false, 2, 'SANS 241-1:2015', 10),
  ('Electrical conductivity',    'EC',      'mS/m',        null, 170,   false, 1, 'SANS 241-1:2015', 20),
  ('Total dissolved solids',     'TDS',     'mg/l',        null, 1200,  false, 0, 'SANS 241-1:2015', 30),
  ('Total alkalinity',           'Alk',     'mg CaCO₃/l',  null, null,  false, 1, null,              40),
  ('Chloride',                   'Cl',      'mg/l',        null, 300,   false, 1, 'SANS 241-1:2015', 50),
  ('Sulphate',                   'SO₄',     'mg/l',        null, 500,   false, 1, 'SANS 241-1:2015', 60),
  ('Nitrate',                    'NO₃',     'mg/l (as NO₃)', null, 48.7,  false, 2, 'SANS 241-1:2015', 70),
  ('Ammonium',                   'NH₄',     'mg/l',        null, 1.5,   false, 3, 'SANS 241-1:2015', 80),
  ('Fluoride',                   'F',       'mg/l',        null, 1.5,   false, 3, 'SANS 241-1:2015', 90),
  ('Calcium',                    'Ca',      'mg/l',        null, null,  false, 1, null,              100),
  ('Magnesium',                  'Mg',      'mg/l',        null, null,  false, 1, null,              110),
  ('Sodium',                     'Na',      'mg/l',        null, 200,   false, 1, 'SANS 241-1:2015', 120),
  ('Potassium',                  'K',       'mg/l',        null, null,  false, 2, null,              130),
  ('Aluminium',                  'Al',      'mg/l',        null, 0.3,   false, 3, 'SANS 241-1:2015', 140),
  ('Iron',                       'Fe',      'mg/l',        null, 2,     false, 3, 'SANS 241-1:2015', 150),
  ('Manganese',                  'Mn',      'mg/l',        null, 0.4,   false, 3, 'SANS 241-1:2015', 160),
  ('Chromium',                   'Cr',      'mg/l',        null, 0.05,  false, 3, 'SANS 241-1:2015', 170),
  ('Copper',                     'Cu',      'mg/l',        null, 2,     false, 3, 'SANS 241-1:2015', 180),
  ('Nickel',                     'Ni',      'mg/l',        null, 0.07,  false, 3, 'SANS 241-1:2015', 190),
  ('Zinc',                       'Zn',      'mg/l',        null, 5,     false, 3, 'SANS 241-1:2015', 200),
  ('Cadmium',                    'Cd',      'mg/l',        null, 0.003, false, 3, 'SANS 241-1:2015', 210),
  ('Lead',                       'Pb',      'mg/l',        null, 0.01,  false, 3, 'SANS 241-1:2015', 220),
  ('E. coli',                    'E. coli', 'CFU/100ml',   null, 0,     false, 0, 'SANS 241-1:2015', 230),
  ('Total coliforms',            'T. coli', 'CFU/100ml',   null, 10,    false, 0, 'SANS 241-1:2015', 240),
  ('Turbidity',                  'NTU',     'NTU',         null, 1,     false, 2, 'SANS 241-1:2015', 250),
  ('Total hardness',             'T. hard', 'mg CaCO₃/l',  null, null,  false, 0, null,              260),
  ('Total organic carbon',       'TOC',     'mg/l',        null, 10,    false, 2, 'SANS 241-1:2015', 270),
  ('Langelier saturation index', 'LSI',     'LSI',         null, null,  true,  2, null,              280);
