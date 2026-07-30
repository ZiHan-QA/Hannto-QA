-- Auditable contract renewals and historical backfill for department personnel.

create table if not exists public.department_contract_renewals (
  id uuid primary key default gen_random_uuid(),
  department_member_id uuid not null references public.department_members(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  renewal_date date not null,
  previous_end_date date,
  new_end_date date not null,
  renewal_project_id uuid references public.qa_projects(id) on delete set null,
  notes text not null default '',
  is_historical boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamp with time zone not null default now(),
  check (previous_end_date is null or new_end_date >= previous_end_date)
);

create index if not exists department_contract_renewals_member_date_idx
  on public.department_contract_renewals(department_member_id, renewal_date desc);

alter table public.department_contract_renewals enable row level security;

drop policy if exists department_contract_renewals_select_accessible
  on public.department_contract_renewals;
create policy department_contract_renewals_select_accessible
on public.department_contract_renewals for select
to authenticated
using (
  member_id = auth.uid()
  or public.can_manage_department(department_id)
  or exists (
    select 1
    from public.department_members as department_member
    where department_member.id = department_member_id
      and department_member.primary_qa_lead_id = auth.uid()
  )
);

drop policy if exists department_contract_renewals_manage_department
  on public.department_contract_renewals;
create policy department_contract_renewals_manage_department
on public.department_contract_renewals for all
to authenticated
using (public.can_manage_department(department_id))
with check (public.can_manage_department(department_id));

revoke all on public.department_contract_renewals from anon;
grant select, insert, update, delete on public.department_contract_renewals to authenticated;

create or replace function public.save_department_contract_renewal(
  target_department_member_id uuid,
  target_renewal_date date,
  target_new_end_date date,
  target_renewal_project_id uuid default null,
  target_notes text default '',
  target_is_historical boolean default false,
  target_previous_end_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member public.department_members%rowtype;
  renewal_id uuid;
  effective_previous_end_date date;
begin
  select *
  into target_member
  from public.department_members
  where id = target_department_member_id
  for update;

  if target_member.id is null then
    raise exception 'Department member not found';
  end if;

  if not public.can_manage_department(target_member.department_id) then
    raise exception 'Permission denied';
  end if;

  if target_member.employee_category is distinct from 'third_party_supplier' then
    raise exception 'Contract renewal is only available to third-party personnel';
  end if;

  effective_previous_end_date := case
    when target_is_historical then target_previous_end_date
    else target_member.contract_end_date
  end;

  if effective_previous_end_date is not null
     and target_new_end_date < effective_previous_end_date then
    raise exception 'New contract end date must not be earlier than the previous end date';
  end if;

  insert into public.department_contract_renewals (
    department_member_id,
    department_id,
    member_id,
    renewal_date,
    previous_end_date,
    new_end_date,
    renewal_project_id,
    notes,
    is_historical
  )
  values (
    target_member.id,
    target_member.department_id,
    target_member.member_id,
    target_renewal_date,
    effective_previous_end_date,
    target_new_end_date,
    target_renewal_project_id,
    coalesce(target_notes, ''),
    target_is_historical
  )
  returning id into renewal_id;

  if not target_is_historical then
    update public.department_members
    set contract_end_date = target_new_end_date
    where id = target_member.id;
  end if;

  return renewal_id;
end;
$$;

revoke all on function public.save_department_contract_renewal(
  uuid, date, date, uuid, text, boolean, date
) from public;
grant execute on function public.save_department_contract_renewal(
  uuid, date, date, uuid, text, boolean, date
) to authenticated;

comment on table public.department_contract_renewals is
  'Immutable renewal history; counts are derived from rows rather than manually maintained.';
