-- Keep a single internship category. Existing trainee records become interns.

update public.department_members
set employee_category = 'intern',
    updated_at = now()
where employee_category = 'trainee';

alter table public.department_members
  drop constraint if exists department_members_employee_category_check;

alter table public.department_members
  add constraint department_members_employee_category_check
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
  );
