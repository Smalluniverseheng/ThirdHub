-- ============================================================
-- v6.3 设备自动发现与一键配对（Agent ↔ 前端）
-- ============================================================

-- 设备注册表：Agent 启动时注册 + 每 30s 心跳
create table if not exists th_devices (
  device_id text primary key,
  name text,
  lan_ips jsonb default '[]'::jsonb,
  public_ip text,
  status text default 'unbound',        -- unbound | bound
  owner uuid,                            -- 绑定用户
  secret_hash text,                      -- Agent 心跳/配对校验
  version text,
  relay text,                            -- 公网中继 wss 地址(cloudflared quick tunnel)
  last_seen timestamptz default now(),
  created_at timestamptz default now()
);
alter table th_devices enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_devices' and policyname='devices 公开可读') then
    execute 'create policy "devices 公开可读" on th_devices for select using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_devices' and policyname='devices 仅服务端写') then
    execute 'create policy "devices 仅服务端写" on th_devices for all using (false)';
  end if;
end $$;

-- 配对令牌：前端(登录态)生成，Agent 直连校验后使用
create table if not exists th_device_pairs (
  token text primary key,               -- 随机 24 位
  device_id text not null,
  user_id uuid not null,
  exp timestamptz not null,
  status text default 'pending',        -- pending | used
  created_at timestamptz default now()
);
alter table th_device_pairs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_device_pairs' and policyname='pairs 本人可发') then
    execute 'create policy "pairs 本人可发" on th_device_pairs for insert with check (auth.uid() = user_id)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_device_pairs' and policyname='pairs 校验可读') then
    execute 'create policy "pairs 校验可读" on th_device_pairs for select using (status = ''pending'')';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='th_device_pairs' and policyname='pairs 仅服务端写') then
    execute 'create policy "pairs 仅服务端写" on th_device_pairs for all using (false)';
  end if;
end $$;

-- Agent 注册/心跳（校验 secret）
create or replace function device_ping(p_device_id text, p_secret_hash text, p_name text, p_lan_ips jsonb, p_public_ip text, p_version text, p_relay text default null)
returns jsonb language plpgsql security definer as $$
declare v_status text; v_owner uuid;
begin
  if p_device_id is null or p_secret_hash is null then return jsonb_build_object('ok', false, 'reason', 'bad args'); end if;
  insert into th_devices (device_id, name, secret_hash, lan_ips, public_ip, version, relay, last_seen)
  values (p_device_id, coalesce(p_name, ''), p_secret_hash, coalesce(p_lan_ips, '[]'::jsonb), coalesce(p_public_ip, ''), coalesce(p_version, ''), coalesce(p_relay, ''), now())
  on conflict (device_id) do update
    set name = excluded.name, lan_ips = excluded.lan_ips, public_ip = excluded.public_ip,
        version = excluded.version, relay = coalesce(excluded.relay, th_devices.relay), last_seen = now(),
        secret_hash = case when th_devices.status = 'unbound' then excluded.secret_hash else th_devices.secret_hash end;
  select status, owner into v_status, v_owner from th_devices where device_id = p_device_id;
  return jsonb_build_object('ok', true, 'status', v_status, 'owner', v_owner);
end; $$;

-- 配对校验（Agent 用）：token 有效 → 绑定设备 → 标记 used
create or replace function device_pair_claim(p_device_id text, p_token text)
returns jsonb language plpgsql security definer as $$
declare v_user uuid; v_sec text;
begin
  select user_id into v_user from th_device_pairs
    where token = p_token and device_id = p_device_id and status = 'pending' and exp > now();
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'invalid token'); end if;
  update th_device_pairs set status = 'used' where token = p_token;
  update th_devices set status = 'bound', owner = v_user where device_id = p_device_id and status = 'unbound';
  select secret_hash into v_sec from th_devices where device_id = p_device_id;
  return jsonb_build_object('ok', true, 'user_id', v_user, 'secret_hash', v_sec);
end; $$;

-- 解除绑定（Agent 端解绑后调用）
create or replace function device_unbind(p_device_id text, p_secret_hash text)
returns jsonb language plpgsql security definer as $$
begin
  update th_devices set status = 'unbound', owner = null where device_id = p_device_id and secret_hash = p_secret_hash;
  return jsonb_build_object('ok', true);
end; $$;

grant execute on function device_ping(text, text, text, jsonb, text, text) to anon, authenticated, service_role;
grant execute on function device_ping(text, text, text, jsonb, text, text, text) to anon, authenticated, service_role;
grant execute on function device_pair_claim(text, text) to anon, authenticated, service_role;
grant execute on function device_unbind(text, text) to anon, authenticated, service_role;