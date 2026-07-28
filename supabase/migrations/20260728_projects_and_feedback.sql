begin;

create table if not exists public.qa_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_unit text not null
    check (business_unit in ('xiaomi', 'consumer', 'other')),
  description text,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (business_unit, name)
);

create table if not exists public.qa_project_members (
  project_id uuid not null references public.qa_projects(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  is_owner boolean not null default false,
  added_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamp with time zone not null default now(),
  primary key (project_id, member_id)
);

create or replace function public.can_view_qa_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.qa_project_members
      where project_id = target_project_id
        and member_id = auth.uid()
    );
$$;

revoke all on function public.can_view_qa_project(uuid) from public;
grant execute on function public.can_view_qa_project(uuid) to authenticated;

alter table public.project_monthly_plans
  add column if not exists project_id uuid
  references public.qa_projects(id) on delete set null;

create index if not exists project_monthly_plans_project_id_idx
  on public.project_monthly_plans(project_id);

alter table public.qa_projects enable row level security;
alter table public.qa_project_members enable row level security;

drop policy if exists qa_projects_select_accessible on public.qa_projects;
create policy qa_projects_select_accessible
on public.qa_projects for select
to authenticated
using (public.can_view_qa_project(id));

drop policy if exists qa_projects_manage_leads on public.qa_projects;
create policy qa_projects_manage_leads
on public.qa_projects for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists qa_project_members_select_accessible on public.qa_project_members;
create policy qa_project_members_select_accessible
on public.qa_project_members for select
to authenticated
using (public.can_view_qa_project(project_id));

drop policy if exists qa_project_members_manage_leads on public.qa_project_members;
create policy qa_project_members_manage_leads
on public.qa_project_members for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.qa_projects from anon;
revoke all on public.qa_project_members from anon;
grant select, insert, update, delete on public.qa_projects to authenticated;
grant select, insert, update, delete on public.qa_project_members to authenticated;

insert into public.qa_projects (name, business_unit, description)
values
  ('小米 BU', 'xiaomi', '小米业务相关测试项目'),
  ('消费 BU', 'consumer', '消费业务相关测试项目'),
  ('Other', 'other', '其他测试项目')
on conflict (business_unit, name) do nothing;

create table if not exists public.qa_feedback (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.qa_projects(id) on delete set null,
  title text not null,
  description text not null,
  category text not null default 'suggestion'
    check (category in ('bug', 'suggestion', 'experience', 'other')),
  status text not null default 'submitted'
    check (status in ('submitted', 'reviewing', 'planned', 'resolved', 'closed')),
  admin_reply text,
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists qa_feedback_created_by_idx
  on public.qa_feedback(created_by, created_at desc);
create index if not exists qa_feedback_status_idx
  on public.qa_feedback(status, created_at desc);

alter table public.qa_feedback enable row level security;

drop policy if exists qa_feedback_select_owner_or_system_admin on public.qa_feedback;
create policy qa_feedback_select_owner_or_system_admin
on public.qa_feedback for select
to authenticated
using (created_by = auth.uid() or public.is_system_admin());

drop policy if exists qa_feedback_insert_own on public.qa_feedback;
create policy qa_feedback_insert_own
on public.qa_feedback for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists qa_feedback_update_system_admin on public.qa_feedback;
create policy qa_feedback_update_system_admin
on public.qa_feedback for update
to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

drop policy if exists qa_feedback_delete_system_admin on public.qa_feedback;
create policy qa_feedback_delete_system_admin
on public.qa_feedback for delete
to authenticated
using (public.is_system_admin());

revoke all on public.qa_feedback from anon;
grant select, insert on public.qa_feedback to authenticated;
grant update, delete on public.qa_feedback to authenticated;

drop trigger if exists qa_projects_set_updated_at on public.qa_projects;
create trigger qa_projects_set_updated_at
before update on public.qa_projects
for each row execute function public.set_updated_at();

drop trigger if exists qa_feedback_set_updated_at on public.qa_feedback;
create trigger qa_feedback_set_updated_at
before update on public.qa_feedback
for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';

commit;
