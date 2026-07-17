-- China work calendar overrides for resource planning.
-- Normal Monday-Friday dates are working days. Rows below override weekends/holidays.

create table if not exists public.work_calendar (
  work_date date primary key,
  is_workday boolean not null,
  name text not null default '',
  source text not null default 'manual'
    check (source in ('manual', 'china_official')),
  created_at timestamptz not null default now()
);

alter table public.work_calendar enable row level security;

drop policy if exists work_calendar_admin_select on public.work_calendar;
drop policy if exists work_calendar_authenticated_select on public.work_calendar;
drop policy if exists work_calendar_admin_insert on public.work_calendar;
drop policy if exists work_calendar_admin_update on public.work_calendar;
drop policy if exists work_calendar_admin_delete on public.work_calendar;

create policy work_calendar_authenticated_select on public.work_calendar
for select to authenticated using (true);
create policy work_calendar_admin_insert on public.work_calendar
for insert to authenticated with check (public.is_admin());
create policy work_calendar_admin_update on public.work_calendar
for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy work_calendar_admin_delete on public.work_calendar
for delete to authenticated using (public.is_admin());

revoke all on public.work_calendar from anon;
grant select, insert, update, delete on public.work_calendar to authenticated;

insert into public.work_calendar (work_date, is_workday, name, source)
select day::date, false, holiday_name, 'china_official'
from (
  values
    ('2026-01-01'::date, '2026-01-03'::date, '元旦'),
    ('2026-02-15'::date, '2026-02-23'::date, '春节'),
    ('2026-04-04'::date, '2026-04-06'::date, '清明节'),
    ('2026-05-01'::date, '2026-05-05'::date, '劳动节'),
    ('2026-06-19'::date, '2026-06-21'::date, '端午节'),
    ('2026-09-25'::date, '2026-09-27'::date, '中秋节'),
    ('2026-10-01'::date, '2026-10-07'::date, '国庆节')
) as holidays(start_date, end_date, holiday_name)
cross join lateral generate_series(holidays.start_date, holidays.end_date, interval '1 day') as day
on conflict (work_date) do update
set is_workday = excluded.is_workday,
    name = excluded.name,
    source = excluded.source;

insert into public.work_calendar (work_date, is_workday, name, source)
values
  ('2026-01-04', true, '元旦调休上班', 'china_official'),
  ('2026-02-14', true, '春节调休上班', 'china_official'),
  ('2026-02-28', true, '春节调休上班', 'china_official'),
  ('2026-05-09', true, '劳动节调休上班', 'china_official'),
  ('2026-09-20', true, '国庆节调休上班', 'china_official'),
  ('2026-10-10', true, '国庆节调休上班', 'china_official')
on conflict (work_date) do update
set is_workday = excluded.is_workday,
    name = excluded.name,
    source = excluded.source;

comment on table public.work_calendar is
  'Overrides default Monday-Friday resource planning for holidays and adjusted workdays';
