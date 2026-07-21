-- Allow APP, Pad and PC to each have an independent current release.

alter table public.releases drop constraint if exists releases_platform_check;
alter table public.releases
  add constraint releases_platform_check
  check (platform in ('android', 'ios', 'pad', 'pc', 'both', 'mobile_all', 'app', 'app_pad'));

-- Replace the original global "only one active release" index with one slot
-- per product end. Combined APP + Pad releases occupy both slots.
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

create or replace function public.transition_release_status(
  target_release_id uuid,
  target_status text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  target_platform text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can change release status';
  end if;
  if target_status not in ('planned', 'active', 'released', 'archived') then
    raise exception 'Invalid release status';
  end if;
  select platform into target_platform from public.releases where id = target_release_id;
  if target_platform is null then
    raise exception 'Release not found';
  end if;

  if target_status = 'active' then
    update public.releases
    set status = 'planned'
    where status = 'active'
      and id <> target_release_id
      and (
        (target_platform in ('android','ios','both','app') and platform in ('android','ios','both','app','mobile_all','app_pad'))
        or (target_platform = 'pad' and platform in ('pad','mobile_all','app_pad'))
        or (target_platform = 'pc' and platform = 'pc')
        or (target_platform in ('mobile_all','app_pad') and platform in ('android','ios','both','app','pad','mobile_all','app_pad'))
      );
  end if;

  update public.releases set status = target_status where id = target_release_id;
end;
$$;

revoke all on function public.transition_release_status(uuid, text) from public;
grant execute on function public.transition_release_status(uuid, text) to authenticated;

comment on function public.transition_release_status(uuid, text) is
  'Changes release lifecycle status while keeping independent current releases for APP, Pad and PC';
comment on column public.releases.platform is
  'Release product end: app, pad, pc, or app_pad; legacy mobile values remain accepted';
