-- ============================================================
-- v6.4 官方仓库统一 + 健康/18+ 分区 + 自动分类
-- ============================================================

-- 1. 分区字段
alter table th_official_repo add column if not exists zone text default 'health';
alter table th_repo add column if not exists zone text default 'health';

-- 2. 自动分区判定（入库时调用）
create or replace function repo_zone_of(p_name text, p_data jsonb) returns text
language plpgsql stable as $$
declare v_txt text; v_zone text := 'health';
begin
  v_txt := lower(coalesce(p_name, '') || ' ' || coalesce(p_data->>'bookSourceComment', '') || ' ' || coalesce(p_data->>'bookSourceGroup', '') || ' ' || coalesce(p_data->>'bookSourceUrl', '') || ' ' || coalesce(p_data->>'name', '') || ' ' || coalesce(p_data->>'key', ''));
  if v_txt ~ '18\+|成人|h漫|禁漫|hentai|nhentai|ehentai|里番|无修|ntr|色情|黄色|情色|porn|adult|xhamster|av\d|肉番|工口|小黄' then
    v_zone := 'adult';
  end if;
  return v_zone;
end; $$;

-- 3. 用户端 repo_list / repo_upsert：返回/写入 zone
create or replace function repo_list(pwd text)
returns jsonb language plpgsql security definer as $$
declare v_rows jsonb;
begin
  if not repo_check(pwd) then raise exception '密码错误'; end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_rows
  from (select id, name, fmt, category, zone, data, updated_at from th_official_repo order by updated_at desc) x;
  return v_rows;
end; $$;

create or replace function repo_upsert(pwd text, items jsonb)
returns int language plpgsql security definer as $$
declare v_cnt int := 0; it jsonb;
begin
  if not repo_check(pwd) then raise exception '密码错误'; end if;
  for it in select * from jsonb_array_elements(coalesce(items, '[]'::jsonb)) loop
    insert into th_official_repo (id, name, fmt, category, zone, data, updated_at)
    values (it->>'id', it->>'name', it->>'fmt', it->>'category',
            repo_zone_of(it->>'name', it->'data'), it->'data', now())
    on conflict (id) do update
      set name = excluded.name, fmt = excluded.fmt, category = excluded.category,
          zone = excluded.zone, data = excluded.data, updated_at = now();
    v_cnt := v_cnt + 1;
  end loop;
  return v_cnt;
end; $$;

-- 4. 后台 admin_repo_*：统一到 th_official_repo（与用户端同一仓库）+ zone
create or replace function admin_repo_list(pwd text)
returns jsonb language plpgsql security definer as $$
declare v_rows jsonb;
begin
  if not admin_check(pwd) then raise exception 'unauthorized'; end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_rows
  from (select id, name, fmt, category, zone, data, updated_at from th_official_repo order by updated_at desc) x;
  return v_rows;
end; $$;

create or replace function admin_repo_upsert(pwd text, items jsonb)
returns int language plpgsql security definer as $$
declare v_cnt int := 0; it jsonb;
begin
  if not admin_check(pwd) then raise exception 'unauthorized'; end if;
  for it in select * from jsonb_array_elements(coalesce(items, '[]'::jsonb)) loop
    insert into th_official_repo (id, name, fmt, category, zone, data, updated_at)
    values (it->>'id', it->>'name', it->>'fmt', it->>'category',
            repo_zone_of(it->>'name', it->'data'), it->'data', now())
    on conflict (id) do update
      set name = excluded.name, fmt = excluded.fmt, category = excluded.category,
          zone = excluded.zone, data = excluded.data, updated_at = now();
    v_cnt := v_cnt + 1;
  end loop;
  return v_cnt;
end; $$;

create or replace function admin_repo_delete(pwd text, ids text[])
returns int language plpgsql security definer as $$
declare v_cnt int := 0;
begin
  if not admin_check(pwd) then raise exception 'unauthorized'; end if;
  delete from th_official_repo where id = any(ids);
  get diagnostics v_cnt = row_count;
  return v_cnt;
end; $$;

create or replace function admin_repo_set_password(pwd text, new_pwd text)
returns jsonb language plpgsql security definer as $$
begin
  if not admin_check(pwd) then raise exception 'unauthorized'; end if;
  if new_pwd is null or length(new_pwd) < 4 then raise exception '密码至少4位'; end if;
  insert into th_kv (key, value) values ('repo_pwd', encode(sha256(convert_to(new_pwd, 'utf8')), 'hex'))
  on conflict (key) do update set value = excluded.value;
  return '{"ok":true}'::jsonb;
end; $$;

-- 5. 迁移 th_repo 现有数据到 th_official_repo（用户端立即可见）
insert into th_official_repo (id, name, fmt, category, zone, data, updated_at)
select id, name, fmt, category, repo_zone_of(name, data), data, updated_at
from th_repo
on conflict (id) do update
  set name = excluded.name, fmt = excluded.fmt, category = excluded.category,
      zone = excluded.zone, data = excluded.data, updated_at = excluded.updated_at;

-- 6. 回填现有 th_official_repo 的 zone
update th_official_repo set zone = repo_zone_of(name, data) where zone is null or zone = '';