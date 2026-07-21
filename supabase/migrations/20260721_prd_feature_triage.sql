-- Persist PRD classification decisions for the global feature catalog.
-- A PRD is a release change by default and may map to multiple stable features.

create table if not exists public.prd_feature_triage (
  prd_id uuid primary key references public.prds(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'mapped', 'ignored')),
  note text not null default '',
  updated_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists prd_feature_triage_status_idx
  on public.prd_feature_triage (status, updated_at desc);

drop trigger if exists prd_feature_triage_set_updated_at on public.prd_feature_triage;
create trigger prd_feature_triage_set_updated_at
before update on public.prd_feature_triage
for each row execute function public.set_updated_at();

alter table public.prd_feature_triage enable row level security;

drop policy if exists prd_feature_triage_read_authenticated on public.prd_feature_triage;
create policy prd_feature_triage_read_authenticated
on public.prd_feature_triage for select to authenticated using (true);

drop policy if exists prd_feature_triage_write_admin on public.prd_feature_triage;
create policy prd_feature_triage_write_admin
on public.prd_feature_triage for all to authenticated
using (public.is_admin()) with check (public.is_admin() and updated_by = auth.uid());

revoke all on public.prd_feature_triage from anon;
grant select, insert, update, delete on public.prd_feature_triage to authenticated;

comment on table public.prd_feature_triage is
  'Admin decisions that map, ignore, or leave PRDs pending for the stable feature catalog';
