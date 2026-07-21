-- Add Pad to release planning and the global feature test map.
-- Existing values remain valid; this migration only widens the allowed platform values.

alter table public.releases
  drop constraint if exists releases_platform_check;

alter table public.releases
  add constraint releases_platform_check
  check (platform in ('android', 'ios', 'pad', 'both', 'mobile_all', 'app', 'app_pad'));

alter table public.product_features
  drop constraint if exists product_features_platform_scope_check;

alter table public.product_features
  add constraint product_features_platform_scope_check
  check (platform_scope in ('android', 'ios', 'pad', 'both', 'mobile_all', 'app', 'app_pad', 'web', 'pc'));

comment on column public.releases.platform is
  'app, app_pad, or pad; legacy android, ios, both, and mobile_all remain accepted';

comment on column public.product_features.platform_scope is
  'app, app_pad, pad, web, or pc; legacy android, ios, both, and mobile_all remain accepted';
