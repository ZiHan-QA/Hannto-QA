-- Safe administrator-only feature catalog merge.
-- Related release changes and test assets move to the retained feature;
-- source features are archived instead of deleted.

create or replace function public.merge_product_features(
  target_feature_id uuid,
  source_feature_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_source_ids uuid[];
begin
  if not public.is_admin() then
    raise exception 'Only administrators can merge product features';
  end if;

  select array_agg(distinct source_id)
  into normalized_source_ids
  from unnest(coalesce(source_feature_ids, '{}'::uuid[])) as source_id
  where source_id is not null and source_id <> target_feature_id;

  if target_feature_id is null or coalesce(cardinality(normalized_source_ids), 0) = 0 then
    raise exception 'A target and at least one different source feature are required';
  end if;

  perform 1
  from public.product_features
  where id = target_feature_id and status = 'active'
  for update;
  if not found then
    raise exception 'Target feature does not exist or is not active';
  end if;

  if exists (
    select 1
    from unnest(normalized_source_ids) as source_id
    left join public.product_features feature on feature.id = source_id
    where feature.id is null or feature.status <> 'active'
  ) then
    raise exception 'One or more source features do not exist or are not active';
  end if;

  perform 1
  from public.product_features
  where id = any(normalized_source_ids)
  for update;

  update public.feature_release_changes
  set feature_id = target_feature_id
  where feature_id = any(normalized_source_ids);

  update public.feature_test_assets
  set feature_id = target_feature_id
  where feature_id = any(normalized_source_ids);

  update public.product_features
  set status = 'deprecated',
      description = concat_ws(E'\n', nullif(description, ''), '已合并至功能 ' || target_feature_id::text)
  where id = any(normalized_source_ids);
end;
$$;

revoke all on function public.merge_product_features(uuid, uuid[]) from public;
grant execute on function public.merge_product_features(uuid, uuid[]) to authenticated;

comment on function public.merge_product_features(uuid, uuid[]) is
  'Admin-only transactional merge for the global QA feature catalog';
