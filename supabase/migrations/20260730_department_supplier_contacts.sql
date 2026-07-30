-- Contact details for department suppliers.

alter table public.department_suppliers
  add column if not exists contact_name text not null default '',
  add column if not exists contact_phone text not null default '',
  add column if not exists contact_email text not null default '';

comment on column public.department_suppliers.contact_name is
  'Primary business contact name.';
comment on column public.department_suppliers.contact_phone is
  'Primary business contact phone.';
comment on column public.department_suppliers.contact_email is
  'Primary business contact email.';
