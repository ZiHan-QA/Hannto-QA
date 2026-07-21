-- Global feature test map. Features and their XMind assets are long-lived;
-- releases only record what changed and whether test assets need an update.

create table if not exists public.product_features (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  product_line text not null default 'Liene Photo',
  module_name text not null default '未分类',
  platform_scope text not null default 'app' check (platform_scope in ('android','ios','pad','both','mobile_all','app','app_pad','web','pc')),
  description text not null default '',
  owner_id uuid references public.profiles(id) on delete set null,
  testhub_library_id text,
  status text not null default 'active' check (status in ('active','deprecated')),
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.feature_release_changes (
  id uuid primary key default gen_random_uuid(),
  feature_id uuid not null references public.product_features(id) on delete cascade,
  release_id uuid not null references public.releases(id) on delete cascade,
  prd_id uuid references public.prds(id) on delete set null,
  change_type text not null default 'changed' check (change_type in ('new','changed','deprecated')),
  change_summary text not null default '',
  asset_update_status text not null default 'pending' check (asset_update_status in ('pending','updated','not_needed')),
  completed_at timestamp with time zone,
  completed_by uuid references public.profiles(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.feature_test_assets (
  id uuid primary key default gen_random_uuid(),
  feature_id uuid not null references public.product_features(id) on delete cascade,
  verified_release_id uuid references public.releases(id) on delete set null,
  asset_type text not null default 'xmind' check (asset_type in ('xmind','document','link')),
  name text not null check (length(trim(name)) > 0),
  storage_path text,
  external_url text,
  file_name text,
  file_size bigint check (file_size is null or file_size >= 0),
  notes text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  check (storage_path is not null or external_url is not null)
);

create index if not exists product_features_module_idx on public.product_features (product_line, module_name);
create unique index if not exists product_features_active_identity_idx
  on public.product_features (lower(product_line), lower(module_name), lower(name))
  where status = 'active';
create index if not exists feature_release_changes_feature_idx on public.feature_release_changes (feature_id, asset_update_status);
create index if not exists feature_release_changes_release_idx on public.feature_release_changes (release_id);
create index if not exists feature_release_changes_prd_idx on public.feature_release_changes (prd_id);
create index if not exists feature_test_assets_feature_idx on public.feature_test_assets (feature_id, updated_at desc);

drop trigger if exists product_features_set_updated_at on public.product_features;
create trigger product_features_set_updated_at before update on public.product_features
for each row execute function public.set_updated_at();

drop trigger if exists feature_release_changes_set_updated_at on public.feature_release_changes;
create trigger feature_release_changes_set_updated_at before update on public.feature_release_changes
for each row execute function public.set_updated_at();

drop trigger if exists feature_test_assets_set_updated_at on public.feature_test_assets;
create trigger feature_test_assets_set_updated_at before update on public.feature_test_assets
for each row execute function public.set_updated_at();

alter table public.product_features enable row level security;
alter table public.feature_release_changes enable row level security;
alter table public.feature_test_assets enable row level security;

drop policy if exists product_features_read_authenticated on public.product_features;
create policy product_features_read_authenticated on public.product_features for select to authenticated using (true);
drop policy if exists product_features_write_admin on public.product_features;
create policy product_features_write_admin on public.product_features for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists feature_release_changes_read_authenticated on public.feature_release_changes;
create policy feature_release_changes_read_authenticated on public.feature_release_changes for select to authenticated using (true);
drop policy if exists feature_release_changes_insert_admin on public.feature_release_changes;
create policy feature_release_changes_insert_admin on public.feature_release_changes for insert to authenticated
with check (public.is_admin() and created_by = auth.uid());
drop policy if exists feature_release_changes_update_authenticated on public.feature_release_changes;
create policy feature_release_changes_update_authenticated on public.feature_release_changes for update to authenticated
using (true) with check (true);
drop policy if exists feature_release_changes_delete_admin on public.feature_release_changes;
create policy feature_release_changes_delete_admin on public.feature_release_changes for delete to authenticated
using (public.is_admin());

drop policy if exists feature_test_assets_read_authenticated on public.feature_test_assets;
create policy feature_test_assets_read_authenticated on public.feature_test_assets for select to authenticated using (true);
drop policy if exists feature_test_assets_insert_authenticated on public.feature_test_assets;
create policy feature_test_assets_insert_authenticated on public.feature_test_assets for insert to authenticated
with check (created_by = auth.uid());
drop policy if exists feature_test_assets_update_owner_or_admin on public.feature_test_assets;
create policy feature_test_assets_update_owner_or_admin on public.feature_test_assets for update to authenticated
using (created_by = auth.uid() or public.is_admin()) with check (created_by = auth.uid() or public.is_admin());
drop policy if exists feature_test_assets_delete_owner_or_admin on public.feature_test_assets;
create policy feature_test_assets_delete_owner_or_admin on public.feature_test_assets for delete to authenticated
using (created_by = auth.uid() or public.is_admin());

revoke all on public.product_features, public.feature_release_changes, public.feature_test_assets from anon;
grant select on public.product_features, public.feature_release_changes, public.feature_test_assets to authenticated;
grant insert, update, delete on public.feature_test_assets to authenticated;
grant insert, delete on public.feature_release_changes to authenticated;
grant update (asset_update_status, completed_at, completed_by) on public.feature_release_changes to authenticated;
grant insert, update, delete on public.product_features to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('qa-test-assets', 'qa-test-assets', false, 20971520)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

drop policy if exists qa_test_assets_read_authenticated on storage.objects;
create policy qa_test_assets_read_authenticated on storage.objects for select to authenticated
using (bucket_id = 'qa-test-assets');
drop policy if exists qa_test_assets_insert_own_folder on storage.objects;
create policy qa_test_assets_insert_own_folder on storage.objects for insert to authenticated
with check (bucket_id = 'qa-test-assets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists qa_test_assets_update_owner_or_admin on storage.objects;
create policy qa_test_assets_update_owner_or_admin on storage.objects for update to authenticated
using (bucket_id = 'qa-test-assets' and (owner_id = auth.uid()::text or public.is_admin()))
with check (bucket_id = 'qa-test-assets' and (owner_id = auth.uid()::text or public.is_admin()));
drop policy if exists qa_test_assets_delete_owner_or_admin on storage.objects;
create policy qa_test_assets_delete_owner_or_admin on storage.objects for delete to authenticated
using (bucket_id = 'qa-test-assets' and (owner_id = auth.uid()::text or public.is_admin()));

comment on table public.product_features is 'Long-lived product feature catalog used by the global QA test map';
comment on table public.feature_release_changes is 'Release changes that may require existing XMind and test assets to be updated';
comment on table public.feature_test_assets is 'Versioned XMind, document and link assets belonging to a stable product feature';
