-- Correct the supplier display name and safely merge an already-created legacy row.

insert into public.department_suppliers (department_id, name)
select id, '科锐'
from public.departments
where name = '软件质量'
on conflict (department_id, name) do nothing;

update public.department_members as member
set supplier_id = replacement.id,
    updated_at = now()
from public.department_suppliers as legacy
join public.department_suppliers as replacement
  on replacement.department_id = legacy.department_id
 and replacement.name = '科锐'
where member.supplier_id = legacy.id
  and legacy.name = '科之锐';

delete from public.department_suppliers
where name = '科之锐';
