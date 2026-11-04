-- mobile_app_config: settings for the Aquafix Capture phone app (spec, App
-- operations → Minimum version). One row, synced to every phone in the
-- reference_data stream (powersync/sync-config.yaml).
--
-- min_app_version: below it, the app keeps uploading queued work but blocks
-- new captures and asks the user to update. Raise it to retire old builds
-- before a breaking backend change. Maintained by SQL only (no web screen):
--
--   update public.mobile_app_config set min_app_version = '1.2.0';
--
-- Not readable by web users: RLS on with no policies and no grants to anon
-- or authenticated. Only powersync_role (and the service role) reads it.

create table public.mobile_app_config (
  id uuid primary key default gen_random_uuid(),
  -- major.minor.patch, compared numerically by the app.
  min_app_version text not null default '0.0.0'
    constraint mobile_app_config_min_app_version_format
    check (min_app_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  updated_at timestamptz not null default now()
);

-- At most one row: every row has the same value for this index.
create unique index mobile_app_config_one_row on public.mobile_app_config ((true));

create trigger mobile_app_config_set_updated_at
  before update on public.mobile_app_config
  for each row execute function public.set_updated_at();

alter table public.mobile_app_config enable row level security;
revoke all on public.mobile_app_config from anon, authenticated;

insert into public.mobile_app_config (min_app_version) values ('0.0.0');

-- PowerSync (same list as 20261102130000_powersync_role.sql and
-- 20261102140000_powersync_publication.sql).
grant select on public.mobile_app_config to powersync_role;
alter publication powersync add table public.mobile_app_config;
