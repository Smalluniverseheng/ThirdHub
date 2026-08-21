-- ============================================================
-- ThirdHub 社区模块数据库（v5.0，含管理后台 v1.1~v1.5 全部依赖）
-- 执行方式：Supabase Dashboard → SQL Editor → 粘贴运行（全选执行）
-- 或：Supabase PAT（Personal Access Token）→ 通过 Management API 执行
--
-- !!! 执行前必读 !!!
-- 1. 把下面的 'CHANGE_ME_PASSWORD' 改成你当前的后台登录密码（明文）。
--    执行后所有后台 RPC 的密码校验统一走 th_kv.admin_pwd（旧 RPC 也会自动跟随）。
-- 2. 需要「忘记密码」功能时，把下方 admin_email 的 '' 改成你的接收邮箱（如 182 账号邮箱）。
-- 3. 需要把某个账号标记为「开发者」时，取消 admin_role 注释行并改 uid。
-- ============================================================

-- 后台配置表（v1.5 新增：所有后台 RPC 的口令 / 角色 / 找回邮箱 / 公告都存这里）
create table if not exists th_kv (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);
alter table th_kv enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_kv' and policyname='th_kv 公开可读') then
    execute 'create policy "th_kv 公开可读" on th_kv for select using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_kv' and policyname='th_kv 系统可写') then
    execute 'create policy "th_kv 系统可写" on th_kv for all using (true)';
  end if;
end $$;

-- 后台登录密码初始化（明文只出现在本次脚本里，执行后仅存 sha256 哈希）
-- 修改后请用新密码登录后台；改密码请用「系统设置 → 修改后台密码」
insert into th_kv (key, value) values ('admin_pwd', encode(sha256(convert_to('CHANGE_ME_PASSWORD', 'utf8')), 'hex'))
on conflict (key) do nothing;

-- 后台权限角色：developer（最高） / admin
insert into th_kv (key, value) values ('admin_role', 'developer')
on conflict (key) do nothing;

-- 找回密码接收邮箱（登录页「忘记密码」把验证码发到这里）
insert into th_kv (key, value) values ('admin_email', '')
on conflict (key) do nothing;

-- （可选）把指定账号标记为开发者：取消下面注释并修改 uid
-- update th_profiles set role = 'developer' where id = '<你的182账号uid>'::uuid;

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

-- ============================================================
-- v1.4 权限体系：开发者(developer) > 管理员(admin)
--   th_kv.admin_role      当前后台权限角色（developer / admin），SQL 默认 developer
--   th_kv.admin_email     找回密码接收邮箱（登录页“忘记密码”用）
--   th_kv.announcement    公告内容 {title, content, enabled}
--   收款设置 admin_set_pay_config 仅 developer 可调用
-- ============================================================

-- 初始化后台配置（幂等）
insert into th_kv (key, value) values
  ('admin_role', 'developer'),
  ('admin_email', '')
on conflict (key) do nothing;

-- 把指定账号标记为开发者（最高权限）。执行前把 WHERE 改成你的账号：
--   例：WHERE id = '182'::uuid / WHERE email = 'xxx@yyy.com' / WHERE phone = '182'
-- update th_profiles set role = 'developer'
--   where id = '<你的182账号uid>'::uuid;

-- 当前后台角色（登录后调用，前端据此显示/隐藏功能）
create or replace function admin_whoami(p_pwd text)
returns jsonb language plpgsql security definer as $$
declare v_role text;
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  select coalesce(value, 'developer') into v_role from th_kv where key = 'admin_role';
  return jsonb_build_object('role', v_role);
end; $$;

-- 切换后台权限角色（开发者 <-> 管理员，需要当前密码；供后期调整权限用）
create or replace function admin_set_role(p_pwd text, p_role text)
returns jsonb language plpgsql security definer as $$
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  if coalesce(p_role, '') not in ('developer', 'admin') then raise exception 'invalid role'; end if;
  insert into th_kv (key, value) values ('admin_role', p_role)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true, 'role', p_role);
end; $$;

-- 修改后台登录密码（需旧密码；新密码至少 6 位）
create or replace function admin_change_pwd(p_pwd text, p_new_pwd text)
returns jsonb language plpgsql security definer as $$
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  if length(coalesce(p_new_pwd, '')) < 6 then raise exception 'password too short'; end if;
  insert into th_kv (key, value) values ('admin_pwd', encode(sha256(convert_to(p_new_pwd, 'utf8')), 'hex'))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true);
end; $$;

-- 忘记密码：请求重置码（邮箱必须等于 admin_email；码 10 分钟有效，返回给调用方用于发送邮件）
create or replace function admin_reset_request(p_email text)
returns jsonb language plpgsql security definer as $$
declare v_email text; v_code text;
begin
  select coalesce(value, '') into v_email from th_kv where key = 'admin_email';
  if v_email = '' or lower(trim(p_email)) <> lower(trim(v_email)) then
    return jsonb_build_object('ok', false, 'reason', 'email mismatch');
  end if;
  v_code := lpad(floor(random() * 1000000)::text, 6, '0');
  insert into th_kv (key, value) values ('admin_reset_code', v_code)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into th_kv (key, value) values ('admin_reset_expire', to_char(now() + interval '10 minutes', 'YYYY-MM-DD HH24:MI:SS'))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true, 'code', v_code);
end; $$;

-- 忘记密码：用重置码设置新密码
create or replace function admin_reset_apply(p_code text, p_new_pwd text)
returns jsonb language plpgsql security definer as $$
declare v_code text; v_expire text;
begin
  select coalesce(value, '') into v_code from th_kv where key = 'admin_reset_code';
  select coalesce(value, '') into v_expire from th_kv where key = 'admin_reset_expire';
  if v_code = '' or v_code <> trim(p_code) then return jsonb_build_object('ok', false, 'reason', 'bad code'); end if;
  if v_expire = '' or now() > to_timestamp(v_expire, 'YYYY-MM-DD HH24:MI:SS') then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if length(coalesce(p_new_pwd, '')) < 6 then return jsonb_build_object('ok', false, 'reason', 'too short'); end if;
  insert into th_kv (key, value) values ('admin_pwd', encode(sha256(convert_to(p_new_pwd, 'utf8')), 'hex'))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  delete from th_kv where key in ('admin_reset_code', 'admin_reset_expire');
  return jsonb_build_object('ok', true);
end; $$;

-- 公告管理（管理员可改）：存 th_kv.announcement
create or replace function admin_upsert_announcement(p_pwd text, p_title text, p_content text, p_enabled boolean)
returns jsonb language plpgsql security definer as $$
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  insert into th_kv (key, value)
  values ('announcement', jsonb_build_object('title', coalesce(p_title, ''), 'content', coalesce(p_content, ''), 'enabled', coalesce(p_enabled, false), 'updated_at', now()))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true);
end; $$;

-- 收款设置权限：后端加固（可选）。已部署的 admin_set_pay_config 无法在此覆盖（需按实际表结构写），
-- 前端已按角色隐藏「收款设置」入口；如需后端强制校验，取消下面注释并确认 th_pay_config 列名后执行：
-- create or replace function admin_set_pay_config(p_pwd text, val jsonb)
-- returns jsonb language plpgsql security definer as $$
-- declare v_role text;
-- begin
--   if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
--   select coalesce(value, 'developer') into v_role from th_kv where key = 'admin_role';
--   if v_role <> 'developer' then raise exception 'developer only'; end if;
--   insert into th_pay_config (key, value) values ('payment', val)
--   on conflict (key) do update set value = excluded.value;
--   return jsonb_build_object('ok', true);
-- end; $$;

-- ============================================================
-- v5.8：灵感任务库 + 活动/公告（AI 新建对话欢迎区）
-- 任务：前端内置 220 条，后台可在此表扩充；公告：优先显示活动/公告小框
-- ============================================================

create table if not exists th_prompts (
  id bigint generated always as identity primary key,
  title text not null,
  category text default '✍️ 写作文案',
  "desc" text,
  prompt text not null,
  active boolean default true,
  sort int default 0,
  created_at timestamptz default now()
);
alter table th_prompts enable row level security;
create policy "th_prompts_read" on th_prompts for select using (true);
create policy "th_prompts_write" on th_prompts for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- 灵感任务管理（管理员口令校验）
create or replace function admin_upsert_prompt(p_pwd text, p_id bigint, p_title text, p_category text, p_desc text, p_prompt text, p_active boolean, p_sort int)
returns jsonb language plpgsql security definer as $$
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  if p_id is null then
    insert into th_prompts (title, category, "desc", prompt, active, sort)
    values (coalesce(p_title, ''), coalesce(p_category, '✍️ 写作文案'), coalesce(p_desc, ''), coalesce(p_prompt, ''), coalesce(p_active, true), coalesce(p_sort, 0));
  else
    update th_prompts set title = coalesce(p_title, title), category = coalesce(p_category, category),
      "desc" = coalesce(p_desc, "desc"), prompt = coalesce(p_prompt, prompt),
      active = coalesce(p_active, active), sort = coalesce(p_sort, sort)
    where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end; $$;

create or replace function admin_delete_prompt(p_pwd text, p_id bigint)
returns jsonb language plpgsql security definer as $$
begin
  if not admin_check(p_pwd) then raise exception 'unauthorized'; end if;
  delete from th_prompts where id = p_id;
  return jsonb_build_object('ok', true);
end; $$;

-- 公告读取（前端 AI 欢迎区使用）：返回当前启用的公告
create or replace function get_active_announcement()
returns jsonb language sql stable as $$
  select value from th_kv where key = 'announcement' and (value->>'enabled')::boolean = true
$$;

-- ============================================================
-- v1.5 忘记密码走 email-code 通道（163 SMTP）
--   验证码由 Supabase Edge Function「email-code」发送并存表 email_verification_codes
--   本 RPC 复用该表校验（动态列名，兼容结构差异），通过后直接重置后台密码
-- ============================================================

-- 校验邮箱是否为后台找回邮箱（不发码，防止向任意邮箱发信）
create or replace function admin_check_email(p_email text)
returns jsonb language plpgsql security definer as $$
declare v_email text;
begin
  select coalesce(value, '') into v_email from th_kv where key = 'admin_email';
  if v_email = '' or lower(trim(p_email)) <> lower(trim(v_email)) then
    return jsonb_build_object('ok', false, 'reason', 'email mismatch');
  end if;
  return jsonb_build_object('ok', true);
end; $$;

-- 用邮箱验证码重置后台密码（复用 email-code 的验证码表）
create or replace function admin_reset_via_code(p_email text, p_code text, p_new_pwd text)
returns jsonb language plpgsql security definer as $$
declare
  v_email text; v_code text; v_expire timestamptz; v_attempts int;
  v_code_col text; v_exp_col text; v_att_col text; v_created_col text; v_q text;
begin
  select coalesce(value, '') into v_email from th_kv where key = 'admin_email';
  if v_email = '' or lower(trim(p_email)) <> lower(trim(v_email)) then
    return jsonb_build_object('ok', false, 'reason', 'email mismatch');
  end if;
  -- 动态探测 email_verification_codes 列名
  select column_name into v_code_col from information_schema.columns
    where table_schema = 'public' and table_name = 'email_verification_codes' and lower(column_name) like '%code%' limit 1;
  select column_name into v_exp_col from information_schema.columns
    where table_schema = 'public' and table_name = 'email_verification_codes' and lower(column_name) like '%expir%' limit 1;
  select column_name into v_att_col from information_schema.columns
    where table_schema = 'public' and table_name = 'email_verification_codes' and lower(column_name) like '%attempt%' limit 1;
  select column_name into v_created_col from information_schema.columns
    where table_schema = 'public' and table_name = 'email_verification_codes' and lower(column_name) like '%created%' limit 1;
  if v_code_col is null or v_exp_col is null or v_created_col is null then
    return jsonb_build_object('ok', false, 'reason', 'schema unknown');
  end if;
  v_q := 'select ' || quote_ident(v_code_col) || ', ' || quote_ident(v_exp_col) ||
         coalesce(', ' || quote_ident(v_att_col), ', null') ||
         ' from public.email_verification_codes where email = $1 order by ' || quote_ident(v_created_col) || ' desc limit 1';
  execute v_q into v_code, v_expire, v_attempts using lower(trim(p_email));
  if v_code is null or v_code <> trim(p_code) then
    return jsonb_build_object('ok', false, 'reason', 'bad code');
  end if;
  if v_expire is not null and now() > v_expire then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_attempts is not null and v_attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too many attempts');
  end if;
  if length(coalesce(p_new_pwd, '')) < 6 then
    return jsonb_build_object('ok', false, 'reason', 'too short');
  end if;
  insert into th_kv (key, value) values ('admin_pwd', encode(sha256(convert_to(p_new_pwd, 'utf8')), 'hex'))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true);
end; $$;

-- ============================================================
-- v5.1 参数名对齐修复（PostgREST 按参数名匹配，admin.js 调用用 pwd/email/code 等）
-- ============================================================


-- ============================================================
-- v5.2 登录修复：admin_list_feedback 等 4 个 RPC 参数名恢复为 pwd（PostgREST 按参数名匹配，
-- 并行版本误用 p_pwd 导致后台登录 404「密码错误或云端不可用」；返回结构恢复 SETOF）
-- ============================================================
drop function if exists admin_list_feedback(p_pwd text) cascade;
drop function if exists admin_repo_list(p_pwd text) cascade;
drop function if exists admin_repo_upsert(p_pwd text, p_items jsonb) cascade;
drop function if exists admin_repo_set_password(p_pwd text, p_new_pwd text) cascade;
drop function if exists admin_repo_delete(p_pwd text, p_ids jsonb) cascade;
drop function if exists admin_free_models_add(p_pwd text, p_provider text, p_model text, p_quota bigint, p_level_limits jsonb) cascade;

create or replace function admin_list_feedback(pwd text)
returns setof th_feedback language plpgsql security definer as $$
begin
  if not admin_check(pwd) then raise exception 'unauthorized'; end if;
  return query select * from public.th_feedback order by updated_at desc limit 200;
end; $$;

create or replace function admin_repo_list(pwd text)
returns setof th_official_repo language plpgsql security definer as $$
begin
  if not admin_check(pwd) then raise exception 'unauthorized'; end if;
  return query select * from public.th_official_repo order by updated_at desc;
end; $$;

create or replace function admin_repo_upsert(pwd text, items jsonb)
returns integer language plpgsql security definer as $$
declare v_cnt int := 0; v_item record; v_id text;
begin
  if not admin_check(pwd) then raise exception 'unauthorized'; end if;
  for v_item in select * from jsonb_array_elements(coalesce(items, '[]'::jsonb)) loop
    v_id := coalesce(v_item.value->>'id', v_item.value->>'fmt' || ':' || v_item.value->>'name');
    insert into th_official_repo (id, name, fmt, category, data, updated_at)
    values (v_id, v_item.value->>'name', v_item.value->>'fmt', v_item.value->>'category', v_item.value->'data', now())
    on conflict (id) do update set name = excluded.name, fmt = excluded.fmt, category = excluded.category, data = excluded.data, updated_at = now();
    v_cnt := v_cnt + 1;
  end loop;
  return v_cnt;
end; $$;

create or replace function admin_repo_set_password(pwd text, new_pwd text)
returns jsonb language plpgsql security definer as $$
begin
  if not admin_check(pwd) then raise exception 'unauthorized'; end if;
  insert into th_repo_meta (id, pass_md5) values ('main', md5(new_pwd))
  on conflict (id) do update set pass_md5 = excluded.pass_md5;
  return jsonb_build_object('ok', true);
end; $$;

-- 刷新 PostgREST 缓存（让新签名立即生效）
select pg_notify('pgrst', 'reload schema');
