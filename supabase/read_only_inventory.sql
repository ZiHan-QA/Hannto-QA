-- Liene QA Supabase 只读结构盘点
-- 本文件只包含 SELECT，不创建、不更新、不删除任何对象或数据。

-- 1. public schema现有数据表
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
order by table_name;

-- 2. 今日工作台相关字段
select table_name, ordinal_position, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'profiles', 'run_tasks', 'device_configs', 'assets', 'consumables',
    'prds', 'requirements', 'copy_texts', 'releases', 'qa_tasks', 'release_checks'
  )
order by table_name, ordinal_position;

-- 3. 当前RLS策略
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles', 'run_tasks', 'device_configs', 'assets', 'consumables',
    'prds', 'requirements', 'copy_texts', 'releases', 'qa_tasks', 'release_checks'
  )
order by tablename, policyname;

-- 4. 主键、外键、唯一约束和CHECK约束
select
  cls.relname as table_name,
  con.conname as constraint_name,
  case con.contype
    when 'p' then 'PRIMARY KEY'
    when 'f' then 'FOREIGN KEY'
    when 'u' then 'UNIQUE'
    when 'c' then 'CHECK'
    else con.contype::text
  end as constraint_type,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class cls on cls.oid = con.conrelid
join pg_namespace ns on ns.oid = cls.relnamespace
where ns.nspname = 'public'
  and cls.relname in (
    'profiles', 'run_tasks', 'device_configs', 'assets', 'consumables',
    'prds', 'requirements', 'copy_texts', 'releases', 'qa_tasks', 'release_checks'
  )
order by cls.relname, constraint_type, con.conname;

-- 5. 相关表索引
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'profiles', 'run_tasks', 'device_configs', 'assets', 'consumables',
    'prds', 'requirements', 'copy_texts', 'releases', 'qa_tasks', 'release_checks'
  )
order by tablename, indexname;

-- 6. 确认自动化设备是否具备心跳字段
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'device_configs'
order by ordinal_position;
