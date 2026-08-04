-- Schedule third-party employee conversions and apply them on/after the effective date.

begin;

alter table public.department_members
  add column if not exists conversion_effective_date date,
  add column if not exists conversion_notes text not null default '',
  add column if not exists conversion_requested_by uuid references auth.users(id) on delete set null,
  add column if not exists conversion_requested_at timestamp with time zone;

create index if not exists department_members_conversion_due_idx
  on public.department_members(conversion_effective_date)
  where conversion_effective_date is not null
    and employee_category = 'third_party_supplier';

create or replace function public.apply_due_department_member_conversions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  applied_count integer := 0;
  effective_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  for target in
    select
      dm.id,
      dm.member_id,
      dm.department_id,
      dm.supplier_id,
      dm.contract_start_date,
      dm.contract_end_date,
      dm.conversion_effective_date,
      dm.conversion_notes,
      dm.conversion_requested_by
    from public.department_members dm
    where dm.employee_category = 'third_party_supplier'
      and dm.conversion_effective_date is not null
      and dm.conversion_effective_date <= effective_today
    for update skip locked
  loop
    update public.department_members
    set employee_category = 'hannto_regular',
        supplier_id = null,
        contract_start_date = null,
        contract_end_date = null,
        conversion_effective_date = null,
        conversion_notes = '',
        conversion_requested_by = null,
        conversion_requested_at = null
    where id = target.id;

    insert into public.employment_change_history (
      member_id,
      department_id,
      change_type,
      effective_date,
      previous_values,
      new_values,
      notes,
      created_by
    ) values (
      target.member_id,
      target.department_id,
      'conversion',
      target.conversion_effective_date,
      jsonb_build_object(
        'employee_category', 'third_party_supplier',
        'supplier_id', target.supplier_id,
        'contract_start_date', target.contract_start_date,
        'contract_end_date', target.contract_end_date
      ),
      jsonb_build_object('employee_category', 'hannto_regular'),
      coalesce(nullif(target.conversion_notes, ''), '第三方供应商员工转为汉图正式员工'),
      target.conversion_requested_by
    );

    applied_count := applied_count + 1;
  end loop;

  return applied_count;
end;
$$;

revoke all on function public.apply_due_department_member_conversions() from public;
grant execute on function public.apply_due_department_member_conversions() to authenticated;

create or replace function public.schedule_department_member_conversion(
  target_department_member_id uuid,
  target_effective_date date,
  target_notes text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.department_members%rowtype;
  effective_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  select * into target
  from public.department_members
  where id = target_department_member_id
  for update;

  if target.id is null then
    raise exception 'Department member not found';
  end if;
  if not public.can_manage_department(target.department_id) then
    raise exception 'Department manager permission required';
  end if;
  if target.employee_category is distinct from 'third_party_supplier' then
    raise exception 'Only third-party supplier employees can be converted';
  end if;
  if target_effective_date is null then
    raise exception 'Conversion effective date is required';
  end if;
  if target_effective_date < effective_today then
    raise exception 'Conversion effective date cannot be earlier than today';
  end if;

  update public.department_members
  set conversion_effective_date = target_effective_date,
      conversion_notes = coalesce(target_notes, ''),
      conversion_requested_by = auth.uid(),
      conversion_requested_at = now()
  where id = target_department_member_id;

  if target_effective_date <= effective_today then
    perform public.apply_due_department_member_conversions();
  end if;
end;
$$;

revoke all on function public.schedule_department_member_conversion(uuid, date, text) from public;
grant execute on function public.schedule_department_member_conversion(uuid, date, text) to authenticated;

create or replace function public.cancel_department_member_conversion(
  target_department_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_department_id uuid;
begin
  select department_id into target_department_id
  from public.department_members
  where id = target_department_member_id
  for update;

  if target_department_id is null then
    raise exception 'Department member not found';
  end if;
  if not public.can_manage_department(target_department_id) then
    raise exception 'Department manager permission required';
  end if;

  update public.department_members
  set conversion_effective_date = null,
      conversion_notes = '',
      conversion_requested_by = null,
      conversion_requested_at = null
  where id = target_department_member_id;
end;
$$;

revoke all on function public.cancel_department_member_conversion(uuid) from public;
grant execute on function public.cancel_department_member_conversion(uuid) to authenticated;

comment on column public.department_members.conversion_effective_date is
  'Scheduled third-party-to-regular conversion date. The member remains third-party before this date.';

commit;
