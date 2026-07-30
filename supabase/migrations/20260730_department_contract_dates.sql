-- Contract term for third-party personnel.
-- The end date is the source of truth for the future one-month expiry reminder.

alter table public.department_members
  add column if not exists contract_start_date date,
  add column if not exists contract_end_date date;

alter table public.department_members
  drop constraint if exists department_members_contract_dates_check;

alter table public.department_members
  add constraint department_members_contract_dates_check
  check (
    contract_start_date is null
    or contract_end_date is null
    or contract_end_date >= contract_start_date
  );

create index if not exists department_members_contract_end_date_idx
  on public.department_members(contract_end_date)
  where contract_end_date is not null
    and employment_status = 'active';

comment on column public.department_members.contract_start_date is
  'Contract start date, primarily for third-party personnel.';

comment on column public.department_members.contract_end_date is
  'Contract expiry date and future reminder source of truth.';

-- For third-party personnel, the first contract starts on the hire date.
update public.department_members
set contract_start_date = hire_date
where employee_category = 'third_party_supplier'
  and hire_date is not null
  and contract_start_date is distinct from hire_date;

create or replace function public.sync_department_member_contract_start()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.employee_category = 'third_party_supplier' then
    new.contract_start_date := new.hire_date;
  else
    new.contract_start_date := null;
    new.contract_end_date := null;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_department_member_contract_start_trigger
  on public.department_members;
create trigger sync_department_member_contract_start_trigger
before insert or update of employee_category, hire_date, contract_start_date
on public.department_members
for each row execute function public.sync_department_member_contract_start();
