-- Department and employment foundation.
-- Department authority is independent from the existing admin / qa_lead / tester duties.

begin;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  supervisor_id uuid references public.profiles(id) on delete set null,
  description text not null default '',
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.department_suppliers (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (department_id, name)
);

create table if not exists public.department_members (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  reports_to_id uuid references public.profiles(id) on delete set null,
  primary_qa_lead_id uuid references public.profiles(id) on delete set null,
  employee_category text
    check (
      employee_category is null
      or employee_category in (
        'hannto_regular',
        'hannto_contract',
        'third_party_supplier',
        'unigroup_hannto',
        'meijie_technology',
        'intern'
      )
    ),
  supplier_id uuid references public.department_suppliers(id) on delete set null,
  hire_date date,
  onboarding_project_id uuid references public.qa_projects(id) on delete set null,
  departure_date date,
  departure_reason text not null default '',
  employment_status text not null default 'active'
    check (employment_status in ('active', 'departed')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (department_id, member_id),
  check (departure_date is null or hire_date is null or departure_date >= hire_date)
);

create table if not exists public.employment_change_history (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  change_type text not null
    check (change_type in ('hire', 'departure', 'category_change', 'conversion', 'transfer')),
  effective_date date not null,
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamp with time zone not null default now()
);

create index if not exists departments_supervisor_id_idx
  on public.departments(supervisor_id);
create index if not exists department_members_member_id_idx
  on public.department_members(member_id);
create index if not exists department_members_reports_to_id_idx
  on public.department_members(reports_to_id);
create index if not exists department_members_primary_qa_lead_id_idx
  on public.department_members(primary_qa_lead_id);
create index if not exists department_members_supplier_id_idx
  on public.department_members(supplier_id);
create index if not exists employment_change_history_member_date_idx
  on public.employment_change_history(member_id, effective_date desc);

create or replace function public.is_department_supervisor(target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.departments
    where id = target_department_id
      and supervisor_id = auth.uid()
  );
$$;

revoke all on function public.is_department_supervisor(uuid) from public;
grant execute on function public.is_department_supervisor(uuid) to authenticated;

create or replace function public.can_manage_department(target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_system_admin()
    or public.is_department_supervisor(target_department_id);
$$;

revoke all on function public.can_manage_department(uuid) from public;
grant execute on function public.can_manage_department(uuid) to authenticated;

create or replace function public.can_view_department(target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_department(target_department_id)
    or exists (
      select 1
      from public.department_members
      where department_id = target_department_id
        and (
          member_id = auth.uid()
          or primary_qa_lead_id = auth.uid()
        )
    );
$$;

revoke all on function public.can_view_department(uuid) from public;
grant execute on function public.can_view_department(uuid) to authenticated;

create or replace function public.prepare_department_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  department_supervisor uuid;
  supplier_department uuid;
begin
  select supervisor_id
  into department_supervisor
  from public.departments
  where id = new.department_id;

  if new.reports_to_id is null then
    new.reports_to_id := department_supervisor;
  end if;

  if new.employee_category is distinct from 'third_party_supplier' then
    new.supplier_id := null;
  elsif new.supplier_id is not null then
    select department_id
    into supplier_department
    from public.department_suppliers
    where id = new.supplier_id;

    if supplier_department is distinct from new.department_id then
      raise exception 'Supplier must belong to the same department';
    end if;
  end if;

  if new.departure_date is not null then
    new.employment_status := 'departed';
  elsif new.employment_status = 'departed' then
    new.employment_status := 'active';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.prepare_department_member() from public;

drop trigger if exists prepare_department_member_trigger on public.department_members;
create trigger prepare_department_member_trigger
before insert or update on public.department_members
for each row execute function public.prepare_department_member();

create or replace function public.touch_department_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_departments_updated_at on public.departments;
create trigger touch_departments_updated_at
before update on public.departments
for each row execute function public.touch_department_record();

drop trigger if exists touch_department_suppliers_updated_at on public.department_suppliers;
create trigger touch_department_suppliers_updated_at
before update on public.department_suppliers
for each row execute function public.touch_department_record();

alter table public.departments enable row level security;
alter table public.department_suppliers enable row level security;
alter table public.department_members enable row level security;
alter table public.employment_change_history enable row level security;

drop policy if exists departments_select_accessible on public.departments;
create policy departments_select_accessible
on public.departments for select
to authenticated
using (public.can_view_department(id));

drop policy if exists departments_insert_system_admin on public.departments;
create policy departments_insert_system_admin
on public.departments for insert
to authenticated
with check (public.is_system_admin());

drop policy if exists departments_update_manager on public.departments;
create policy departments_update_manager
on public.departments for update
to authenticated
using (public.can_manage_department(id))
with check (public.can_manage_department(id));

drop policy if exists departments_delete_system_admin on public.departments;
create policy departments_delete_system_admin
on public.departments for delete
to authenticated
using (public.is_system_admin());

drop policy if exists department_members_select_accessible on public.department_members;
create policy department_members_select_accessible
on public.department_members for select
to authenticated
using (
  member_id = auth.uid()
  or primary_qa_lead_id = auth.uid()
  or public.can_manage_department(department_id)
);

drop policy if exists department_members_manage_department on public.department_members;
create policy department_members_manage_department
on public.department_members for all
to authenticated
using (public.can_manage_department(department_id))
with check (public.can_manage_department(department_id));

-- Supplier data is intentionally hidden from qa_lead and tester duties.
drop policy if exists department_suppliers_manage_department on public.department_suppliers;
create policy department_suppliers_manage_department
on public.department_suppliers for all
to authenticated
using (public.can_manage_department(department_id))
with check (public.can_manage_department(department_id));

drop policy if exists employment_change_history_select_accessible on public.employment_change_history;
create policy employment_change_history_select_accessible
on public.employment_change_history for select
to authenticated
using (
  member_id = auth.uid()
  or (department_id is not null and public.can_manage_department(department_id))
);

drop policy if exists employment_change_history_insert_manager on public.employment_change_history;
create policy employment_change_history_insert_manager
on public.employment_change_history for insert
to authenticated
with check (
  department_id is not null
  and public.can_manage_department(department_id)
);

revoke all on public.departments from anon;
revoke all on public.department_suppliers from anon;
revoke all on public.department_members from anon;
revoke all on public.employment_change_history from anon;

grant select, insert, update, delete on public.departments to authenticated;
grant select, insert, update, delete on public.department_suppliers to authenticated;
grant select, insert, update, delete on public.department_members to authenticated;
grant select, insert on public.employment_change_history to authenticated;

insert into public.departments (name, supervisor_id, description)
select
  '软件质量',
  (
    select id
    from public.profiles
    where lower(btrim(name)) in ('李旭光', 'xuguang.li')
    order by case when btrim(name) = '李旭光' then 0 else 1 end
    limit 1
  ),
  'Hannto 软件质量部门'
on conflict (name) do update
set supervisor_id = coalesce(public.departments.supervisor_id, excluded.supervisor_id),
    description = excluded.description,
    updated_at = now();

insert into public.department_suppliers (department_id, name)
select departments.id, supplier_name
from public.departments
cross join (
  values ('智立方'), ('科锐')
) as supplier_list(supplier_name)
where departments.name = '软件质量'
on conflict (department_id, name) do nothing;

insert into public.department_members (department_id, member_id)
select departments.id, profiles.id
from public.departments
cross join public.profiles
where departments.name = '软件质量'
on conflict (department_id, member_id) do nothing;

create or replace function public.assign_profile_to_default_department()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.department_members (department_id, member_id)
  select id, new.id
  from public.departments
  where name = '软件质量'
  on conflict (department_id, member_id) do nothing;

  return new;
end;
$$;

revoke all on function public.assign_profile_to_default_department() from public;

drop trigger if exists assign_profile_to_default_department_trigger on public.profiles;
create trigger assign_profile_to_default_department_trigger
after insert on public.profiles
for each row execute function public.assign_profile_to_default_department();

create or replace function public.protect_department_supervisor_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.supervisor_id is distinct from new.supervisor_id
     and not public.is_system_admin() then
    raise exception 'Only system administrators may change the department supervisor';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_department_supervisor_change() from public;

drop trigger if exists protect_department_supervisor_change_trigger on public.departments;
create trigger protect_department_supervisor_change_trigger
before update of supervisor_id on public.departments
for each row execute function public.protect_department_supervisor_change();

commit;
