-- Logger integration: the external logger device code an asset reports under.
-- Optional; when set it must be unique so each logger maps to one asset.
-- Blank values are stored as null (the app trims and nulls them).

alter table public.asset add column logger_code text;

alter table public.asset
  add constraint asset_logger_code_not_blank check (logger_code is null or btrim(logger_code) <> ''),
  add constraint asset_logger_code_key unique (logger_code);
