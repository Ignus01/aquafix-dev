-- The `powersync` publication (PowerSync requires that name): the tables
-- powersync/sync-config.yaml reads, and no others, so PowerSync never
-- receives changes to anything else. Same list as the grants to
-- powersync_role in the previous migration.

create publication powersync for table
  public.instruction,
  public.instruction_asset_allocation,
  public.inspection_activity,
  public.inspection_value,
  public.inspection_image,
  public.asset,
  public.asset_type,
  public.location,
  public.grading,
  public.colour_container,
  public.inspection,
  public.inspection_drop_down_option,
  public.inspection_rule,
  public.feedback,
  public.inspection_allocation,
  public.quality_parameter,
  public.inspection_cumulative_value,
  public.user_masterdata_roles;
