/* ===== ThirdHub auth.js — 登录/注册/会员/卡密（Supabase） ===== */
import { kvGet, kvSet, state, emit, on } from './store.js';
import { getSupabase, hasCloud } from './supabase.js';
import { toast } from './ui.js';

/* 会员等级定义（只卖存储容量，不卖 Token） */
export const LEVELS = [
  { id: 'guest',     name: '游客', cls: 'lv-guest',     tag: 'tag-gray',   storage: 0,                price: 0 },
  { id: 'satellite', name: '卫星', cls: 'lv-satellite', tag: 'tag-blue',   storage: 100 * 1024 ** 2,   price: 0 },
  { id: 'planet',    name: '行星', cls: 'lv-planet',    tag: 'tag-green',  storage: 1024 ** 3,         price: 29 },
  { id: 'star',      name: '恒星', cls: 'lv-star',      tag: 'tag-orange', storage: 5 * 1024 ** 3,     price: 99 },
  { id: 'galaxy',    name: '星系', cls: 'lv-galaxy',    tag: 'tag-purple', storage: 20 * 1024 ** 3,    price: 199 },
  { id: 'universe',  name: '宇宙', cls: 'lv-universe',  tag: 'tag-gold',   storage: Infinity,         price: 399 },
];
export function levelById(id) { return LEVELS.find((l) => l.id === id) || LEVELS[0]; }

/* 当前用户（本地缓存） */
export async function currentUser() {
  return await kvGet('auth:user', null); // {id,email,level,role,expireAt}
}
export async function isAdmin() {
  const u = await currentUser();
  return !!u && u.role === 'admin';
}
export async function currentLevel() {
  const u = await currentUser();
  return levelById(u ? u.level : 'guest');
}

export async function initAuth() {
  state.user = await currentUser();
  if (!hasCloud()) return;
  const sb = getSupabase();
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session) await refreshProfile();
    sb.auth.onAuthStateChange(async (ev) => {
      if (ev === 'SIGNED_IN') await refreshProfile();
      if (ev === 'SIGNED_OUT') { await kvSet('auth:user', null); state.user = null; emit('auth:changed'); }
    });
  } catch (e) { console.warn('auth session 恢复失败', e); }
}

export async function refreshProfile() {
  const sb = getSupabase();
  const { data: sess } = await sb.auth.getSession();
  if (!sess || !sess.session) return null;
  const uid = sess.session.user.id;
  const email = sess.session.user.email;
  let profile = null;
  try {
    const { data } = await sb.from('th_profiles').select('*').eq('id', uid).maybeSingle();
    profile = data;
  } catch (e) {}
  const meta = sess.session.user.user_metadata || {};
  const user = {
    id: uid,
    email,
    level: (profile && profile.level) || 'satellite',
    role: (profile && profile.role) || 'user',
    nickname: (profile && profile.nickname) || meta.nickname || (email ? email.split('@')[0] : '用户'),
    avatar: (profile && profile.avatar) || meta.avatar || '',
    phone: (profile && profile.phone) || '',
    bio: (profile && profile.bio) || '',
    expireAt: (profile && profile.expire_at) || null,
    storageUsed: (profile && profile.storage_used) || 0,
  };
  await kvSet('auth:user', user);
  state.user = user;
  emit('auth:changed');
  return user;
}

/* 云端报错中文化：把 Supabase / 网络的英文错误翻译成界面语言 */
export function zhErr(e) {
  const m = String((e && e.message) || e || '');
  const t = m.toLowerCase();
  if (/invalid login credentials/.test(t)) return '邮箱或密码不正确';
  if (/email not confirmed/.test(t)) return '邮箱尚未验证，请先查收验证邮件';
  if (/user already registered|already been registered/.test(t)) return '该邮箱已注册，请直接登录';
  if (/password.*at least|should be at least/.test(t)) return '密码长度不足（至少 6 位）';
  if (/unable to validate email|invalid email/.test(t)) return '邮箱格式不正确';
  if (/signup.*disabled|signups not allowed/.test(t)) return '当前暂未开放注册';
  if (/rate limit|too many requests|over_request_rate/.test(t)) return '操作太频繁，请稍后再试';
  if (/email rate limit exceeded/.test(t)) return '邮件发送太频繁，请稍后再试';
  if (/failed to fetch|networkerror|network request failed|load failed/.test(t)) return '网络连接失败，请检查网络后重试';
  if (/timeout|timed out|aborterror/.test(t)) return '网络超时，请稍后再试';
  if (/jwt|token.*expired|session.*expired|refresh token/.test(t)) return '登录状态已过期，请重新登录';
  if (/new row violates row-level security/.test(t)) return '没有权限执行该操作';
  if (/duplicate key/.test(t)) return '记录已存在，请勿重复提交';
  return m || '操作失败，请稍后再试';
}

export async function signIn(email, password) {
  if (!hasCloud()) throw new Error('云端未配置');
  const sb = getSupabase();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(zhErr(error));
  return refreshProfile();
}

export async function signUp(email, password, nickname = '') {
  if (!hasCloud()) throw new Error('云端未配置');
  const sb = getSupabase();
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { nickname: nickname || email.split('@')[0] } },
  });
  if (error) throw new Error(zhErr(error));
  // 写入资料行（失败静默：触发器可能已建行）
  try {
    if (data && data.user) {
      await sb.from('th_profiles').upsert({ id: data.user.id, nickname: nickname || email.split('@')[0] });
    }
  } catch (e) {}
  await refreshProfile().catch(() => {});
  toast('注册成功', 'ok');
}

/* ---------- 个人资料修改 ---------- */
export async function updateProfile(patch) {
  const u = await currentUser();
  if (!u) throw new Error('请先登录');
  const sb = hasCloud() ? getSupabase() : null;
  if (sb) {
    const row = { id: u.id };
    if (patch.nickname !== undefined) row.nickname = patch.nickname;
    if (patch.avatar !== undefined) row.avatar = patch.avatar;
    if (patch.phone !== undefined) row.phone = patch.phone;
    if (patch.bio !== undefined) row.bio = patch.bio;
    let { error } = await sb.from('th_profiles').upsert(row);
    // 老库可能缺 phone/bio 列：降级只更新昵称/头像
    if (error && /phone|bio|column/i.test(error.message || '')) {
      delete row.phone; delete row.bio;
      ({ error } = await sb.from('th_profiles').upsert(row));
    }
    if (error) throw new Error(zhErr(error));
    try { await sb.auth.updateUser({ data: { nickname: row.nickname, avatar: row.avatar } }); } catch (e) {}
  }
  const next = { ...u, ...patch };
  await kvSet('auth:user', next);
  state.user = next;
  emit('auth:changed');
  return next;
}

/* 修改邮箱（Supabase 会发确认邮件到新邮箱） */
export async function changeEmail(newEmail) {
  if (!hasCloud()) throw new Error('云端未配置');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) throw new Error('邮箱格式不正确');
  const sb = getSupabase();
  const { error } = await sb.auth.updateUser({ email: newEmail });
  if (error) throw new Error(zhErr(error));
}

export async function signOut() {
  if (hasCloud()) { try { await getSupabase().auth.signOut(); } catch (e) {} }
  await kvSet('auth:user', null);
  state.user = null;
  emit('auth:changed');
}

/* ---------- 卡密激活 ----------
   卡密格式：TP-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX（50 位） */
export const CARD_RE = /^TP(-[A-Z0-9]{8}){6}$/;

export async function redeemCard(cardKey) {
  cardKey = (cardKey || '').trim().toUpperCase();
  if (!CARD_RE.test(cardKey)) throw new Error('卡密格式不正确');
  if (!hasCloud()) throw new Error('云端未配置，无法激活卡密');
  const u = await currentUser();
  if (!u) throw new Error('请先登录');
  const sb = getSupabase();
  const { data, error } = await sb.rpc('th_redeem_card', { p_card: cardKey, p_user: u.id });
  if (error) throw new Error(zhErr(error));
  if (data && data.error) throw new Error(zhErr(data.error));
  await refreshProfile();
  return data;
}
