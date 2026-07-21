-- Fix installations that already ran 20260721_release_platform_currents.sql.
-- APP, Pad and PC each have an independent current-release slot, while a
-- combined APP + Pad release occupies both APP and Pad slots.

begin;

drop index if exists public.releases_one_active_idx;

create unique index if not exists releases_one_active_app_idx
  on public.releases ((status))
  where status = 'active'
    and platform in ('android', 'ios', 'both', 'app', 'mobile_all', 'app_pad');

create unique index if not exists releases_one_active_pad_idx
  on public.releases ((status))
  where status = 'active'
    and platform in ('pad', 'mobile_all', 'app_pad');

create unique index if not exists releases_one_active_pc_idx
  on public.releases ((status))
  where status = 'active' and platform = 'pc';

commit;
