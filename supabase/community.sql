-- ============================================================
-- ThirdHub 社区模块数据库（v4.9）
-- 执行方式：Supabase Dashboard → SQL Editor → 粘贴运行（全选执行）
-- 或：Supabase PAT（Personal Access Token）→ 通过 Management API 执行
-- ============================================================

-- 帖子表
create table if not exists community_posts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  nickname text,
  category text default 'share',            -- share 分享 | help 求助
  content text not null,
  related_type text,                        -- 'book' | 'ai_session' | null
  related_id text,
  related_title text,
  likes int default 0,
  created_at timestamptz default now()
);

-- 评论表
create table if not exists community_comments (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references community_posts on delete cascade,
  user_id uuid not null,
  nickname text,
  content text not null,
  created_at timestamptz default now()
);

create index if not exists idx_community_posts_created on community_posts (created_at desc);
create index if not exists idx_community_comments_post on community_comments (post_id, created_at asc);

-- 行级安全（RLS）：公开可读、仅本人可写
alter table community_posts enable row level security;
alter table community_comments enable row level security;

create policy "community_posts 公开可读" on community_posts for select using (true);
create policy "community_posts 本人可发" on community_posts for insert with check (auth.uid() = user_id);
create policy "community_posts 本人可改" on community_posts for update using (auth.uid() = user_id);
create policy "community_posts 本人可删" on community_posts for delete using (auth.uid() = user_id);

create policy "community_comments 公开可读" on community_comments for select using (true);
create policy "community_comments 本人可评" on community_comments for insert with check (auth.uid() = user_id);
create policy "community_comments 本人可删" on community_comments for delete using (auth.uid() = user_id);

-- 开启 Realtime（实时评论）
alter publication supabase_realtime add table community_posts;
alter publication supabase_realtime add table community_comments;

-- ============================================================
-- v6.0 设备日志云端上报（默认开启，日志页可关闭）
-- ============================================================
create table if not exists device_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  level text not null,          -- error | warn | info
  tag text,
  msg text not null,
  app_version text,
  ts timestamptz default now()
);
create index if not exists idx_device_logs_user on device_logs (user_id, ts desc);
alter table device_logs enable row level security;
create policy "device_logs 本人可写" on device_logs for insert with check (auth.uid() = user_id);
create policy "device_logs 本人可读" on device_logs for select using (auth.uid() = user_id);
create policy "device_logs 管理员可读" on device_logs for select using (exists (select 1 from th_profiles p where p.id = auth.uid() and p.role = 'admin'));


-- ============================================================
-- v5.3 用户端分享源到官方仓库（自动分类，需管理员执行此函数）
-- ============================================================
create or replace function repo_upsert(p_pwd text, p_items jsonb)
returns int
language plpgsql security definer
as $$
declare
  v_cnt int := 0;
  v_pwd_hash text;
  it jsonb;
  v_id text;
  v_name text;
  v_fmt text;
  v_cat text;
  v_data jsonb;
begin
  select value into v_pwd_hash from th_kv where key = 'repo_pwd';
  if v_pwd_hash is null or v_pwd_hash <> encode(sha256(convert_to(p_pwd, 'utf8')), 'hex') then
    raise exception '密码错误';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_id := it->>'id';
    v_name := it->>'name';
    v_fmt := it->>'fmt';
    v_cat := it->>'category';
    v_data := it->'data';
    insert into th_repo (id, name, fmt, category, data, updated_at)
    values (v_id, v_name, v_fmt, v_cat, v_data, now())
    on conflict (id) do update
      set name = excluded.name, fmt = excluded.fmt, category = excluded.category,
          data = excluded.data, updated_at = now();
    v_cnt := v_cnt + 1;
  end loop;
  return v_cnt;
end;
$$;


-- ============================================================
-- v1.1 管理后台：限时免费模型（分等级 Token 配额）
-- ============================================================
create table if not exists th_free_models (
  id bigint generated always as identity primary key,
  provider text not null,
  model text not null,
  quota bigint default 0,               -- 月 Token 配额（0 = 不限）
  level_limits jsonb default '{}'::jsonb, -- {"guest": 2000, "vip": 20000} 每等级日配额
  note text,
  enabled boolean default true,
  created_at timestamptz default now(),
  unique (provider, model)
);
alter table th_free_models enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_free_models' and policyname='free_models 公开可读') then
    execute 'create policy "free_models 公开可读" on th_free_models for select using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_free_models' and policyname='free_models 管理员可写') then
    execute 'create policy "free_models 管理员可写" on th_free_models for all using (exists (select 1 from th_profiles p where p.id = auth.uid() and p.role = ''admin''))';
  end if;
end $$;

create or replace function admin_free_models_list(p_pwd text)
returns jsonb language plpgsql security definer as $$
declare v_rows jsonb;
begin
  if not exists (select 1 from th_kv where key='admin_pwd' and value=encode(sha256(convert_to(p_pwd,'utf8')),'hex'))
     and not exists (select 1 from th_profiles where role='admin' limit 0) then null; end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_rows
  from (select id, provider, model, quota, level_limits, note, enabled, created_at from th_free_models order by created_at desc) x;
  return v_rows;
end; $$;

create or replace function admin_free_models_add(p_pwd text, p_provider text, p_model text, p_quota bigint, p_level_limits jsonb)
returns jsonb language plpgsql security definer as $$
begin
  insert into th_free_models (provider, model, quota, level_limits)
  values (p_provider, p_model, coalesce(p_quota,0), coalesce(p_level_limits,'{}'::jsonb))
  on conflict (provider, model) do update set quota = excluded.quota, level_limits = excluded.level_limits, enabled = true;
  return '{"ok":true}'::jsonb;
end; $$;

create or replace function admin_free_models_remove(p_pwd text, p_id bigint)
returns jsonb language plpgsql security definer as $$
begin
  delete from th_free_models where id = p_id;
  return '{"ok":true}'::jsonb;
end; $$;

-- ============================================================
-- v1.2 限时免费模型升级：限时 / 限量 / 指定用户
--   玩法组合：
--     限时      = start_time ~ end_time 窗口内无限使用（不填 = 不限时）
--     限量      = max_quota 总量，用完即止（不填 = 不限量）
--     限时+限量 = 窗口内且额度未耗尽
--     范围      = scope 'all' 全体用户 / 'users' 仅 user_ids 指定用户（按 uid 分配）
--   前端对接：th_free_models_available(p_uid)  取当前用户可用列表
--             th_free_models_consume(p_uid, id, amount) 原子扣减配额并写明细
-- ============================================================
create table if not exists th_free_models (
  id bigint generated always as identity primary key,
  provider text not null,
  model text not null,
  name text,                                -- 显示名（可选）
  scope text default 'all',                 -- 'all' 全体 / 'users' 仅指定用户
  user_ids text[] default '{}',             -- scope='users' 时的 uid 列表
  start_time timestamptz,                   -- 限时开始（null = 不限）
  end_time timestamptz,                     -- 限时结束（null = 不限）
  max_quota bigint default 0,               -- 限量总量（0 = 不限）
  quota_unit text default 'count',          -- 'count' 次数 / 'tokens' Token
  used_quota bigint default 0,              -- 已用量（consume 原子累加）
  quota bigint default 0,                   -- 兼容 v1.1：月 Token 配额（0 = 不限）
  level_limits jsonb default '{}'::jsonb,   -- 兼容 v1.1：每等级日配额 {"guest":2000}
  note text,
  enabled boolean default true,
  created_at timestamptz default now()
);
alter table th_free_models enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_free_models' and policyname='free_models 公开可读') then
    execute 'create policy "free_models 公开可读" on th_free_models for select using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_free_models' and policyname='free_models 管理员可写') then
    execute 'create policy "free_models 管理员可写" on th_free_models for all using (exists (select 1 from th_profiles p where p.id = auth.uid() and p.role = ''admin''))';
  end if;
end $$;

-- 旧表升级：补齐新列 / 放开同模型多活动（同一模型可同时开多个限时活动）
alter table th_free_models add column if not exists name text;
alter table th_free_models add column if not exists scope text default 'all';
alter table th_free_models add column if not exists user_ids text[] default '{}';
alter table th_free_models add column if not exists start_time timestamptz;
alter table th_free_models add column if not exists end_time timestamptz;
alter table th_free_models add column if not exists max_quota bigint default 0;
alter table th_free_models add column if not exists quota_unit text default 'count';
alter table th_free_models add column if not exists used_quota bigint default 0;
alter table th_free_models drop constraint if exists th_free_models_provider_model_key;

-- 用量明细表
create table if not exists th_free_model_usage (
  id bigint generated always as identity primary key,
  model_id bigint not null references th_free_models(id) on delete cascade,
  uid text,
  amount bigint default 0,
  created_at timestamptz default now()
);
alter table th_free_model_usage enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_free_model_usage' and policyname='free_usage 公开可读') then
    execute 'create policy "free_usage 公开可读" on th_free_model_usage for select using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_free_model_usage' and policyname='free_usage 系统可写') then
    execute 'create policy "free_usage 系统可写" on th_free_model_usage for insert with check (true)';
  end if;
end $$;

-- 管理员口令校验（供免费模型 RPC 使用）
create or replace function admin_check(p_pwd text)
returns boolean language plpgsql security definer as $$
begin
  return exists (select 1 from th_kv where key = 'admin_pwd' and value = encode(sha256(convert_to(p_pwd, 'utf8')), 'hex'));
end; $$;

create or replace function admin_free_models_list(p_pwd text)
returns jsonb language plpgsql security definer as $$
declare v_rows jsonb;
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_rows
  from (select id, provider, model, name, scope, user_ids, start_time, end_time,
               max_quota, quota_unit, used_quota, quota, level_limits, note, enabled, created_at
        from th_free_models order by created_at desc) x;
  return v_rows;
end; $$;

create or replace function admin_free_models_add(
  p_pwd text, p_provider text, p_model text, p_name text, p_scope text,
  p_user_ids text[], p_start_time timestamptz, p_end_time timestamptz,
  p_max_quota bigint, p_quota_unit text, p_level_limits jsonb, p_note text)
returns jsonb language plpgsql security definer as $$
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  insert into th_free_models (provider, model, name, scope, user_ids, start_time, end_time, max_quota, quota_unit, level_limits, note)
  values (p_provider, p_model, p_name, coalesce(p_scope, 'all'), coalesce(p_user_ids, '{}'::text[]),
          p_start_time, p_end_time, coalesce(p_max_quota, 0), coalesce(p_quota_unit, 'count'),
          coalesce(p_level_limits, '{}'::jsonb), p_note);
  return '{"ok":true}'::jsonb;
end; $$;

create or replace function admin_free_models_update(
  p_pwd text, p_id bigint, p_provider text, p_model text, p_name text, p_scope text,
  p_user_ids text[], p_start_time timestamptz, p_end_time timestamptz,
  p_max_quota bigint, p_quota_unit text, p_level_limits jsonb, p_note text)
returns jsonb language plpgsql security definer as $$
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  update th_free_models set
    provider = p_provider, model = p_model, name = p_name, scope = coalesce(p_scope, 'all'),
    user_ids = coalesce(p_user_ids, '{}'::text[]), start_time = p_start_time, end_time = p_end_time,
    max_quota = coalesce(p_max_quota, 0), quota_unit = coalesce(p_quota_unit, 'count'),
    level_limits = coalesce(p_level_limits, '{}'::jsonb), note = p_note
  where id = p_id;
  return '{"ok":true}'::jsonb;
end; $$;

create or replace function admin_free_models_remove(p_pwd text, p_id bigint)
returns jsonb language plpgsql security definer as $$
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  delete from th_free_model_usage where model_id = p_id;
  delete from th_free_models where id = p_id;
  return '{"ok":true}'::jsonb;
end; $$;

-- 前端：当前用户可用列表（时间窗口 + 范围 + 余量，一条 SQL 完成判定）
create or replace function th_free_models_available(p_uid text)
returns jsonb language plpgsql security definer as $$
declare v_rows jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_rows
  from (
    select id, provider, model, name, quota_unit, max_quota, used_quota,
           (max_quota - used_quota) as remaining, start_time, end_time, scope, note
    from th_free_models f
    where f.enabled
      and (f.scope = 'all' or (f.user_ids is not null and f.user_ids @> array[p_uid]))
      and (f.start_time is null or f.start_time <= now())
      and (f.end_time is null or f.end_time >= now())
      and (f.max_quota = 0 or f.used_quota < f.max_quota)
    order by f.created_at desc
  ) x;
  return v_rows;
end; $$;

-- 前端：消费扣减（校验可用性 + 原子扣减 + 写明细；额度不足 / 不在窗口 / 无权限则 ok=false）
create or replace function th_free_models_consume(p_uid text, p_model_id bigint, p_amount bigint)
returns jsonb language plpgsql security definer as $$
declare v_id bigint; v_used bigint; v_max bigint; v_unit text;
begin
  update th_free_models f
    set used_quota = used_quota + coalesce(p_amount, 1)
    where f.id = p_model_id
      and f.enabled
      and (f.scope = 'all' or (f.user_ids is not null and f.user_ids @> array[p_uid]))
      and (f.start_time is null or f.start_time <= now())
      and (f.end_time is null or f.end_time >= now())
      and (f.max_quota = 0 or f.used_quota + coalesce(p_amount, 1) <= f.max_quota)
    returning f.id, f.used_quota, f.max_quota, f.quota_unit into v_id, v_used, v_max, v_unit;
  if v_id is not null then
    insert into th_free_model_usage (model_id, uid, amount) values (p_model_id, p_uid, coalesce(p_amount, 1));
    if v_max = 0 then
      return jsonb_build_object('ok', true, 'remaining', -1);
    end if;
    return jsonb_build_object('ok', true, 'remaining', v_max - v_used);
  end if;
  return jsonb_build_object('ok', false, 'remaining', 0);
end; $$;

-- ============================================================
-- v1.3 用户编辑：昵称修改（带密码确认）+ 角色管理（多管理员）
-- ============================================================

-- 修改用户昵称（昵称置空 = 不改）
create or replace function admin_set_user_nickname(p_pwd text, p_uid uuid, p_nickname text)
returns jsonb language plpgsql security definer as $$
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  update th_profiles set nickname = trim(p_nickname) where id = p_uid and length(trim(coalesce(p_nickname,''))) > 0;
  return jsonb_build_object('ok', true);
end; $$;

-- 设置 / 取消管理员角色（role: 'admin' 或 'user'，管理员可有多个）
create or replace function admin_set_user_role(p_pwd text, p_uid uuid, p_role text)
returns jsonb language plpgsql security definer as $$
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  if coalesce(p_role, '') not in ('admin', 'user', 'agent') then
    raise exception 'invalid role';
  end if;
  update th_profiles set role = p_role where id = p_uid;
  return jsonb_build_object('ok', true);
end; $$;
