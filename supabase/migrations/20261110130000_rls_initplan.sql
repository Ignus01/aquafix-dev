-- Grid redesign, phase 0.2 (docs/grid-redesign-plan.md).
--
-- RLS policies such as `using (public.is_inspection_reader())` call the role
-- function once per row: on inspection_value (26k rows) that alone is most
-- of the 16 s "every row" timing. Wrapped as `(select public.fn())`, Postgres
-- plans the call as an InitPlan and runs it once per query.
--
-- The rewrite is mechanical, so it is done here over pg_policies rather than
-- by restating ~110 policies by hand: every call to a role helper (and to
-- auth.uid() / auth.jwt()) in a public-schema policy is wrapped in a scalar
-- subquery. That is semantics-preserving by construction: `(select f(x))`
-- returns exactly f(x), and a call whose arguments reference a column just
-- becomes a correlated subquery (same result, no speed-up). Calls that are
-- already wrapped (`SELECT f(...)`) are left alone, so this is idempotent.
-- Policies on storage.objects are not touched.

create function pg_temp.wrap_rls_calls(expr text) returns text
language plpgsql
as $$
declare
  out_text text := '';
  i int := 1;
  n int := length(expr);
  m text[];
  depth int;
  j int;
  in_quote boolean;
  c text;
  call_text text;
  prev text;
begin
  if expr is null then
    return null;
  end if;
  while i <= n loop
    prev := case when i > 1 then substr(expr, i - 1, 1) else ' ' end;
    m := null;
    if prev !~ '[A-Za-z0-9_."]' then
      m := regexp_match(
        substr(expr, i),
        '^((?:public\.)?(?:is_[a-z_]+|can_[a-z_]+|has_masterdata_role)|auth\.uid|auth\.jwt)\('
      );
    end if;
    -- Only role helpers: skip value predicates such as is_hydrus_timestamp().
    if m is not null and m[1] ~ '(is_hydrus_timestamp|is_volume_unit)$' then
      m := null;
    end if;
    if m is null then
      out_text := out_text || substr(expr, i, 1);
      i := i + 1;
      continue;
    end if;

    -- Find the matching close paren, ignoring parens inside 'quoted' text.
    j := i + length(m[1]);  -- position of the opening paren
    depth := 0;
    in_quote := false;
    loop
      c := substr(expr, j, 1);
      if c = '' then
        raise exception 'unbalanced expression: %', expr;
      end if;
      if c = '''' then
        in_quote := not in_quote;
      elsif not in_quote and c = '(' then
        depth := depth + 1;
      elsif not in_quote and c = ')' then
        depth := depth - 1;
        exit when depth = 0;
      end if;
      j := j + 1;
    end loop;

    call_text := substr(expr, i, j - i + 1);
    if out_text ~* 'select\s*$' then
      out_text := out_text || call_text;
    else
      out_text := out_text || '( SELECT ' || call_text || ')';
    end if;
    i := j + 1;
  end loop;
  return out_text;
end;
$$;

do $$
declare
  p record;
  new_qual text;
  new_check text;
  stmt text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    new_qual := pg_temp.wrap_rls_calls(p.qual);
    new_check := pg_temp.wrap_rls_calls(p.with_check);
    if new_qual is not distinct from p.qual and new_check is not distinct from p.with_check then
      continue;
    end if;
    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if new_qual is not null then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if new_check is not null then
      stmt := stmt || format(' with check (%s)', new_check);
    end if;
    execute stmt;
  end loop;
end;
$$;
