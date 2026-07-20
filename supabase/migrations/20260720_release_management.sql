-- Atomic release lifecycle transitions for the release management page.

create or replace function public.transition_release_status(
  target_release_id uuid,
  target_status text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can change release status';
  end if;
  if target_status not in ('planned', 'active', 'released', 'archived') then
    raise exception 'Invalid release status';
  end if;
  if not exists (select 1 from public.releases where id = target_release_id) then
    raise exception 'Release not found';
  end if;

  if target_status = 'active' then
    update public.releases
    set status = 'planned'
    where status = 'active'
      and id <> target_release_id;
  end if;

  update public.releases
  set status = target_status
  where id = target_release_id;
end;
$$;

revoke all on function public.transition_release_status(uuid, text) from public;
grant execute on function public.transition_release_status(uuid, text) to authenticated;

comment on function public.transition_release_status(uuid, text) is
  'Atomically changes release lifecycle status while keeping at most one active release';
