-- Escaped defect ownership and retrospective workflow for quality reporting.

create table if not exists public.quality_defects (
  id uuid primary key default gen_random_uuid(),
  pingcode_id text,
  title text not null check (length(btrim(title)) between 1 and 300),
  external_url text,
  source text not null default 'manual' check (source in ('manual', 'pingcode')),
  release_id uuid references public.releases(id) on delete set null,
  exposed_stage text not null check (exposed_stage in ('integration', 'production')),
  severity text not null default 'P1' check (severity in ('P0', 'P1', 'P2', 'P3')),
  status text not null default 'open' check (status in ('open', 'fixing', 'verified', 'closed')),
  executor_id uuid not null references public.profiles(id) on delete restrict,
  found_at date not null default current_date,
  closed_at date,
  root_cause_category text check (root_cause_category in (
    'requirement', 'design', 'code', 'test_case', 'environment',
    'data', 'communication', 'process', 'other'
  )),
  impact text not null default '',
  escape_reason text not null default '',
  corrective_action text not null default '',
  prevention_action text not null default '',
  review_status text not null default 'pending'
    check (review_status in ('pending', 'in_review', 'completed')),
  raw_data jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closed_at is null or closed_at >= found_at)
);

create unique index if not exists quality_defects_pingcode_id_idx
  on public.quality_defects (pingcode_id)
  where pingcode_id is not null;
create index if not exists quality_defects_stage_found_idx
  on public.quality_defects (exposed_stage, found_at desc);
create index if not exists quality_defects_executor_review_idx
  on public.quality_defects (executor_id, review_status, found_at desc);
create index if not exists quality_defects_release_idx
  on public.quality_defects (release_id);

drop trigger if exists set_quality_defects_updated_at on public.quality_defects;
create trigger set_quality_defects_updated_at
before update on public.quality_defects
for each row execute function public.set_updated_at();

alter table public.quality_defects enable row level security;

drop policy if exists quality_defects_read_authenticated on public.quality_defects;
create policy quality_defects_read_authenticated
on public.quality_defects for select
to authenticated
using (true);

drop policy if exists quality_defects_insert_admin on public.quality_defects;
create policy quality_defects_insert_admin
on public.quality_defects for insert
to authenticated
with check (public.is_admin() and created_by = auth.uid());

drop policy if exists quality_defects_update_owner_or_admin on public.quality_defects;
create policy quality_defects_update_owner_or_admin
on public.quality_defects for update
to authenticated
using (executor_id = auth.uid() or public.is_admin())
with check (executor_id = auth.uid() or public.is_admin());

drop policy if exists quality_defects_delete_admin on public.quality_defects;
create policy quality_defects_delete_admin
on public.quality_defects for delete
to authenticated
using (public.is_admin());

revoke all on public.quality_defects from anon;
grant select, insert, update, delete on public.quality_defects to authenticated;

comment on table public.quality_defects is
  'Integration and production escaped defects with executor ownership and retrospective actions';
