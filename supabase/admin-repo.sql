-- ============================================================
-- ThirdHub 补充:后台登录 + 官方仓库(admin_repo 系列) + 反馈表
-- 在 community.sql 之后执行(可重复执行)
-- ============================================================

-- 配置表(存 admin_pwd / repo_pwd / admin_role 等)
create table if not exists th_kv (
  key text primary key,
  value text
);
alter table th_kv enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_kv' and policyname='th_kv 仅服务端') then
    execute 'create policy "th_kv 仅服务端" on th_kv for all using (false)';
  end if;
end $$;

-- 官方仓库(书源分发)
create table if not exists th_repo (
  id text primary key,
  name text,
  fmt text,
  category text,
  data jsonb,
  updated_at timestamptz default now()
);
alter table th_repo enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_repo' and policyname='th_repo 公开可读') then
    execute 'create policy "th_repo 公开可读" on th_repo for select using (true)';
  end if;
end $$;

-- 反馈表(登录校验依赖)
create table if not exists th_feedback (
  id bigint generated always as identity primary key,
  user_id uuid,
  content text,
  status text default 'pending',
  created_at timestamptz default now()
);
alter table th_feedback enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_feedback' and policyname='th_feedback 公开可读') then
    execute 'create policy "th_feedback 公开可读" on th_feedback for select using (true)';
  end if;
end $$;

-- 后台登录:首次调用时用该密码初始化 admin_pwd(之后必须用同一密码)
create or replace function admin_whoami(p_pwd text)
returns jsonb language plpgsql security definer as $$
declare v_role text;
begin
  if not exists (select 1 from th_kv where key = 'admin_pwd') then
    insert into th_kv (key, value) values ('admin_pwd', encode(sha256(convert_to(p_pwd, 'utf8')), 'hex'))
    on conflict (key) do nothing;
    return jsonb_build_object('ok', true, 'role', 'developer');
  end if;
  if exists (select 1 from th_kv where key = 'admin_pwd' and value = encode(sha256(convert_to(p_pwd, 'utf8')), 'hex')) then
    select coalesce((select value from th_kv where key = 'admin_role'), 'developer') into v_role;
    return jsonb_build_object('ok', true, 'role', v_role);
  end if;
  return jsonb_build_object('ok', false);
end; $$;

create or replace function admin_change_pwd(p_pwd text, p_new_pwd text)
returns jsonb language plpgsql security definer as $$
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  if p_new_pwd is null or length(p_new_pwd) < 4 then raise exception '密码至少4位'; end if;
  insert into th_kv (key, value) values ('admin_pwd', encode(sha256(convert_to(p_new_pwd, 'utf8')), 'hex'))
  on conflict (key) do update set value = excluded.value;
  return '{"ok":true}'::jsonb;
end; $$;

-- 登录校验用反馈列表(表空则返回空列表)
create or replace function admin_list_feedback(p_pwd text)
returns jsonb language plpgsql security definer as $$
declare v_rows jsonb;
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_rows
  from (select id, user_id, content, status, created_at from th_feedback order by created_at desc limit 200) x;
  return v_rows;
end; $$;

-- ============ 官方仓库 admin_repo 系列 ============
create or replace function admin_repo_list(p_pwd text)
returns jsonb language plpgsql security definer as $$
declare v_rows jsonb;
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_rows
  from (select id, name, fmt, category, data, updated_at from th_repo order by updated_at desc) x;
  return v_rows;
end; $$;

create or replace function admin_repo_upsert(p_pwd text, p_items jsonb)
returns int language plpgsql security definer as $$
declare v_cnt int := 0;
        it jsonb;
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into th_repo (id, name, fmt, category, data, updated_at)
    values (it->>'id', it->>'name', it->>'fmt', it->>'category', it->'data', now())
    on conflict (id) do update
      set name = excluded.name, fmt = excluded.fmt, category = excluded.category,
          data = excluded.data, updated_at = now();
    v_cnt := v_cnt + 1;
  end loop;
  return v_cnt;
end; $$;

create or replace function admin_repo_delete(p_pwd text, p_ids jsonb)
returns int language plpgsql security definer as $$
declare v_cnt int := 0;
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  delete from th_repo where id in (select jsonb_array_elements_text(p_ids));
  get diagnostics v_cnt = row_count;
  return v_cnt;
end; $$;

create or replace function admin_repo_set_password(p_pwd text, p_new_pwd text)
returns jsonb language plpgsql security definer as $$
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  if p_new_pwd is null or length(p_new_pwd) < 4 then raise exception '密码至少4位'; end if;
  insert into th_kv (key, value) values ('repo_pwd', encode(sha256(convert_to(p_new_pwd, 'utf8')), 'hex'))
  on conflict (key) do update set value = excluded.value;
  return '{"ok":true}'::jsonb;
end; $$;

grant execute on function admin_whoami(text) to anon, authenticated, service_role;
grant execute on function admin_change_pwd(text, text) to anon, authenticated, service_role;
grant execute on function admin_list_feedback(text) to anon, authenticated, service_role;
grant execute on function admin_repo_list(text) to anon, authenticated, service_role;
grant execute on function admin_repo_upsert(text, jsonb) to anon, authenticated, service_role;
grant execute on function admin_repo_delete(text, jsonb) to anon, authenticated, service_role;
grant execute on function admin_repo_set_password(text, text) to anon, authenticated, service_role;
grant execute on function admin_check(text) to anon, authenticated, service_role;
grant execute on function repo_upsert(text, jsonb) to anon, authenticated, service_role;