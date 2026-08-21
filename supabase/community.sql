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
