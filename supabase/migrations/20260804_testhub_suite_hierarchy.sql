begin;

alter table public.testhub_plan_suite_cache
  add column if not exists suite_path text[] not null default '{}'::text[];

comment on column public.testhub_plan_suite_cache.suite_path is
  'TestHub module ancestry from suite.paths, ordered from top-level module to the current module';

commit;
