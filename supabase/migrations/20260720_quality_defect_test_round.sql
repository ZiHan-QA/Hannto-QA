-- Link an escaped defect to the concrete QA task / test round where it surfaced.

alter table public.quality_defects
  add column if not exists qa_task_id uuid references public.qa_tasks(id) on delete set null;

alter table public.quality_defects
  add column if not exists reopen_count integer not null default 0 check (reopen_count >= 0),
  add column if not exists is_change_induced boolean not null default false,
  add column if not exists is_missed_test boolean not null default false;

create index if not exists quality_defects_qa_task_id_idx
  on public.quality_defects (qa_task_id);

comment on column public.quality_defects.qa_task_id is
  'QA task and test round in which this escaped defect was found';

comment on column public.quality_defects.reopen_count is
  'Number of times the defect was reopened after a fix';

comment on column public.quality_defects.is_change_induced is
  'Whether the defect was introduced by a related code or configuration change';

comment on column public.quality_defects.is_missed_test is
  'Whether retrospective confirmed the defect was missed by testing';
