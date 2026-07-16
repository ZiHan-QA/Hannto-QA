-- Liene QA existing-table security baseline.
-- Captures the RLS and privilege hardening applied manually on 2026-07-15/16.

begin;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke truncate, trigger, references on all tables in schema public from authenticated;

alter table public.assets enable row level security;
alter table public.consumables enable row level security;
alter table public.copy_texts enable row level security;
alter table public.device_configs enable row level security;
alter table public.onboarding_docs enable row level security;
alter table public.outbound_logs enable row level security;
alter table public.prd_changes enable row level security;
alter table public.prds enable row level security;
alter table public.profiles enable row level security;
alter table public.requirements enable row level security;
alter table public.restock_logs enable row level security;
alter table public.run_results enable row level security;
alter table public.run_tasks enable row level security;

drop policy if exists profiles_select_policy on public.profiles;
drop policy if exists profiles_insert_policy on public.profiles;
drop policy if exists profiles_update_policy on public.profiles;
drop policy if exists profiles_delete_policy on public.profiles;

create policy profiles_select_policy on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_admin());

create policy profiles_insert_policy on public.profiles
for insert to authenticated
with check (public.is_admin());

create policy profiles_update_policy on public.profiles
for update to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy profiles_delete_policy on public.profiles
for delete to authenticated
using (public.is_admin());

drop policy if exists copy_texts_read_authenticated on public.copy_texts;
drop policy if exists copy_texts_write_admin on public.copy_texts;
create policy copy_texts_read_authenticated on public.copy_texts
for select to authenticated using (true);
create policy copy_texts_write_admin on public.copy_texts
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete onboarding_docs" on public.onboarding_docs;
drop policy if exists "Admins can insert onboarding_docs" on public.onboarding_docs;
drop policy if exists "Admins can update onboarding_docs" on public.onboarding_docs;
drop policy if exists "Anyone can read onboarding_docs" on public.onboarding_docs;
drop policy if exists onboarding_docs_read_authenticated on public.onboarding_docs;
drop policy if exists onboarding_docs_write_admin on public.onboarding_docs;
create policy onboarding_docs_read_authenticated on public.onboarding_docs
for select to authenticated using (true);
create policy onboarding_docs_write_admin on public.onboarding_docs
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists assets_authenticated_all on public.assets;
drop policy if exists consumables_authenticated_all on public.consumables;
create policy assets_authenticated_all on public.assets
for all to authenticated using (true) with check (true);
create policy consumables_authenticated_all on public.consumables
for all to authenticated using (true) with check (true);

drop policy if exists restock_logs_authenticated_read on public.restock_logs;
drop policy if exists restock_logs_authenticated_insert on public.restock_logs;
drop policy if exists outbound_logs_authenticated_read on public.outbound_logs;
drop policy if exists outbound_logs_authenticated_insert on public.outbound_logs;
create policy restock_logs_authenticated_read on public.restock_logs
for select to authenticated using (true);
create policy restock_logs_authenticated_insert on public.restock_logs
for insert to authenticated with check (true);
create policy outbound_logs_authenticated_read on public.outbound_logs
for select to authenticated using (true);
create policy outbound_logs_authenticated_insert on public.outbound_logs
for insert to authenticated with check (true);

drop policy if exists prds_authenticated_all on public.prds;
drop policy if exists requirements_authenticated_all on public.requirements;
drop policy if exists prd_changes_authenticated_read on public.prd_changes;
drop policy if exists prd_changes_authenticated_insert on public.prd_changes;
create policy prds_authenticated_all on public.prds
for all to authenticated using (true) with check (true);
create policy requirements_authenticated_all on public.requirements
for all to authenticated using (true) with check (true);
create policy prd_changes_authenticated_read on public.prd_changes
for select to authenticated using (true);
create policy prd_changes_authenticated_insert on public.prd_changes
for insert to authenticated with check (true);

drop policy if exists device_configs_authenticated_read on public.device_configs;
drop policy if exists device_configs_admin_all on public.device_configs;
drop policy if exists run_tasks_authenticated_read on public.run_tasks;
drop policy if exists run_results_authenticated_read on public.run_results;
create policy device_configs_authenticated_read on public.device_configs
for select to authenticated using (true);
create policy device_configs_admin_all on public.device_configs
for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy run_tasks_authenticated_read on public.run_tasks
for select to authenticated using (true);
create policy run_results_authenticated_read on public.run_results
for select to authenticated using (true);

grant select, insert, update, delete on
  public.assets,
  public.consumables,
  public.copy_texts,
  public.device_configs,
  public.onboarding_docs,
  public.outbound_logs,
  public.prd_changes,
  public.prds,
  public.profiles,
  public.requirements,
  public.restock_logs,
  public.run_results,
  public.run_tasks
to authenticated;

revoke update, delete on
  public.outbound_logs,
  public.prd_changes,
  public.restock_logs
from authenticated;

revoke insert, update, delete on
  public.run_results,
  public.run_tasks
from authenticated;

commit;
