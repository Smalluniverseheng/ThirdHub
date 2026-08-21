/* ===== ThirdHub keyvault.js — 密钥保险库（二级密码 · 本地加密 · 云端托管） =====
   三种存储模式：
     local       仅保存本机（默认）— 不上传云端
     cloud-enc   加密上传云端 — 用二级密码 PBKDF2+AES-GCM 加密后上传，跨设备可用，管理员不可见
     cloud-plain 明文上传云端 — 跨设备方便，但管理员可见
   二级密码丢失将无法解密已加密的密钥，请务必牢记。 */
import { kvGet, kvSet, emit } from '../store.js';
import { getSupabase, hasCloud } from '../supabase.js';
import { currentUser } from '../auth.js';
import { $, $$, el, esc, icon, modal, toast, confirmDialog, formRow, openOverlay } from '../ui.js';

export const KEY_MODES = [
  { id: 'local', name: '仅保存本机', desc: '最安全，换设备需重新填写' },
  { id: 'cloud-enc', name: '加密上传云端', desc: '用二级密码加密后上传，跨设备可用，管理员也看不到' },
  { id: 'cloud-plain', name: '明文上传云端', desc: '跨设备方便，管理员可以在后台看到密钥' },
];

const te = new TextEncoder();
const td = new TextDecoder();
let _derivedKey = null;   // 内存中的 AES 密钥（解锁期间有效）

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', te.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/* ---------- 二级密码 ---------- */
export async function hasSecPwd() {
  return !!(await kvGet('sec:hash', ''));
}
export async function verifySecPwd(pwd) {
  const h = await kvGet('sec:hash', '');
  return !!h && (await sha256('th-sec:' + pwd)) === h;
}
async function deriveKey(pwd, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(pwd), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/* 解锁：返回 true 表示当前会话已有可用密钥 */
export async function unlockSecPwd() {
  if (_derivedKey) return true;
  if (!(await hasSecPwd())) return false;
  return new Promise((resolve) => {
    const body = el(`<div>
      <p class="muted" style="margin-bottom:12px">该操作需要二级密码。二级密码用于加密你的 API 密钥等隐私信息。</p>
      ${formRow('二级密码', '<input class="input" data-f="pwd" type="password" placeholder="输入二级密码" autocomplete="off">')}
      <p class="muted" data-v="err" style="color:#ef4444"></p>
    </div>`);
    const m = modal({
      title: '输入二级密码', body,
      footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">解锁</button>',
      onClose: () => resolve(!!_derivedKey),
    });
    $('[data-a="cancel"]', m.mask).onclick = () => { m.close(); };
    const doUnlock = async () => {
      const pwd = $('[data-f="pwd"]', body).value;
      if (!pwd) return;
      if (!(await verifySecPwd(pwd))) { $('[data-v="err"]', body).textContent = '密码错误'; return; }
      const salt = unb64(await kvGet('sec:salt', ''));
      _derivedKey = await deriveKey(pwd, salt);
      m.close();
    };
    $('[data-a="ok"]', m.mask).onclick = doUnlock;
    $('[data-f="pwd"]', body).addEventListener('keydown', (e) => { if (e.key === 'Enter') doUnlock(); });
  });
}
export function lockSecPwd() { _derivedKey = null; }
export function isUnlocked() { return !!_derivedKey; }

/* ---------- 加解密 ---------- */
export async function encryptText(plain) {
  if (!_derivedKey) throw new Error('locked');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const saltB64 = await kvGet('sec:salt', '');
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _derivedKey, te.encode(plain));
  return 'enc1:' + saltB64 + ':' + b64(iv) + ':' + b64(ct);
}
export async function decryptText(payload) {
  if (!_derivedKey) throw new Error('locked');
  const parts = String(payload || '').split(':');
  if (parts[0] !== 'enc1' || parts.length !== 4) throw new Error('bad payload');
  const ct = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(parts[2]) }, _derivedKey, unb64(parts[3]));
  return td.decode(ct);
}

/* ---------- 密钥模式 ---------- */
export async function getKeyMode(providerId) {
  return await kvGet('ai:keymode:' + providerId, 'local');
}
export async function setKeyMode(providerId, mode) {
  await kvSet('ai:keymode:' + providerId, mode);
}

/* ---------- 云端托管 ---------- */
export async function syncKeyToCloud(providerId, name = '', base = '') {
  if (!hasCloud()) return false;
  const u = await currentUser();
  if (!u) return false;
  const mode = await getKeyMode(providerId);
  const sb = getSupabase();
  try {
    if (mode === 'local') {
      await sb.from('th_apikeys').delete().eq('user_id', u.id).eq('key_id', providerId);
      return true;
    }
    const { getApiKey } = await import('../ai/ai-api.js');
    const plain = await getApiKey(providerId);
    if (!plain) {
      await sb.from('th_apikeys').delete().eq('user_id', u.id).eq('key_id', providerId);
      return true;
    }
    let payload = plain;
    if (mode === 'cloud-enc') {
      if (!(await unlockSecPwd())) return false;
      payload = await encryptText(plain);
    }
    await sb.from('th_apikeys').upsert({
      user_id: u.id, key_id: providerId, name, base,
      mode: mode === 'cloud-enc' ? 'enc' : 'plain',
      payload, updated_at: new Date().toISOString(),
    });
    return true;
  } catch (e) { console.warn('syncKeyToCloud', e); return false; }
}

export async function removeKeyFromCloud(providerId) {
  if (!hasCloud()) return;
  const u = await currentUser();
  if (!u) return;
  try { await getSupabase().from('th_apikeys').delete().eq('user_id', u.id).eq('key_id', providerId); } catch (_) {}
}

/* 登录后从云端拉取密钥 */
export async function pullKeysFromCloud() {
  if (!hasCloud()) return;
  const u = await currentUser();
  if (!u) return;
  try {
    const { data, error } = await getSupabase().from('th_apikeys').select('*').eq('user_id', u.id);
    if (error || !data) return;
    const { kvSet: set } = await import('../store.js');
    const encList = [];
    for (const row of data) {
      const mode = row.mode === 'enc' ? 'cloud-enc' : 'cloud-plain';
      await setKeyMode(row.key_id, mode);
      if (row.mode === 'enc') {
        encList.push(row.key_id);
        await set('ai:keyenc:' + row.key_id, row.payload); // 密文缓存，解锁后可解密
        // 本机还没有明文且已解锁 → 直接解密填充
        const local = await kvGet('ai:key:' + row.key_id, '');
        if (!local && _derivedKey) {
          try { await set('ai:key:' + row.key_id, await decryptText(row.payload)); } catch (_) {}
        }
      } else {
        const local = await kvGet('ai:key:' + row.key_id, '');
        if (!local && row.payload) await set('ai:key:' + row.key_id, row.payload);
      }
    }
    await set('ai:keyenc:list', encList);
    emit('ai:keys-changed');
  } catch (e) { console.warn('pullKeysFromCloud', e); return; }
}

/* 用密文缓存解锁本机密钥（用户解锁二级密码后调用） */
export async function decryptCachedKeys() {
  if (!_derivedKey) return;
  const all = await kvGet('ai:keyenc:list', []);
  const { kvSet: set } = await import('../store.js');
  for (const pid of all) {
    const enc = await kvGet('ai:keyenc:' + pid, '');
    if (!enc) continue;
    try { await set('ai:key:' + pid, await decryptText(enc)); } catch (_) {}
  }
}

/* ---------- 密钥保存钩子（ai-api.setApiKey 之后调用） ---------- */
export async function afterKeySaved(providerId, name = '', base = '') {
  const mode = await getKeyMode(providerId);
  if (mode === 'local') { await removeKeyFromCloud(providerId); return; }
  await syncKeyToCloud(providerId, name, base);
}

/* ---------- 设置页 ---------- */
export function showSecPwdSettings() {
  const render = async (body) => {
    const has = await hasSecPwd();
    const modes = KEY_MODES.map((m) => `<div class="row gap8" style="align-items:flex-start;padding:8px 0">
      <span style="flex:0 0 auto;margin-top:2px">${icon('lock')}</span>
      <div><div style="font-weight:600;font-size:14px">${m.name}</div><div class="muted">${m.desc}</div></div>
    </div>`).join('');
    body.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <div style="font-weight:700;margin-bottom:6px">二级密码</div>
        <p class="muted" style="margin-bottom:10px">二级密码用于加密 API 密钥等隐私信息，与登录密码相互独立。<b style="color:#fbbf24">加密后的密钥一旦忘记二级密码将无法找回</b>，请务必牢记。</p>
        <div class="row gap8">
          <span class="tag ${has ? 'tag-green' : 'tag-gray'}">${has ? '已设置' : '未设置'}</span>
          <span class="tag ${_derivedKey ? 'tag-green' : 'tag-gray'}">${_derivedKey ? '当前会话已解锁' : '当前会话未解锁'}</span>
        </div>
        <div class="row gap8 mt8">
          <button class="btn btn-primary grow" data-a="set">${has ? '修改二级密码' : '设置二级密码'}</button>
          ${_derivedKey ? '<button class="btn grow" data-a="lock">立即锁定</button>' : ''}
          ${has ? '<button class="btn btn-danger grow" data-a="remove">移除</button>' : ''}
        </div>
      </div>
      <div class="card">
        <div style="font-weight:700;margin-bottom:6px">密钥存储方式说明</div>
        ${modes}
        <p class="muted">在「AI 设置 → API 密钥 → 选择厂商」中可为每个密钥单独选择存储方式。</p>
      </div>`;
    $('[data-a="set"]', body).onclick = () => setupSecPwdDialog(has, () => render(body));
    const lockBtn = $('[data-a="lock"]', body);
    if (lockBtn) lockBtn.onclick = () => { lockSecPwd(); toast('已锁定'); render(body); };
    const rmBtn = $('[data-a="remove"]', body);
    if (rmBtn) rmBtn.onclick = async () => {
      if (!(await confirmDialog('移除二级密码？', '已加密上传云端的密钥将无法再解密，建议先把密钥改为其他存储方式。', '移除', true))) return;
      promptVerifyAnd(async () => {
        await kvSet('sec:hash', ''); await kvSet('sec:salt', '');
        lockSecPwd();
        toast('已移除二级密码');
        render(body);
      });
    };
  };
  openOverlay({ title: '二级密码', build: render });
}

async function promptVerifyAnd(fn) {
  const body = el(`<div>
    ${formRow('当前二级密码', '<input class="input" data-f="pwd" type="password" autocomplete="off">')}
    <p class="muted" data-v="err" style="color:#ef4444"></p>
  </div>`);
  const m = modal({
    title: '验证身份', body,
    footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">确定</button>',
  });
  $('[data-a="cancel"]', m.mask).onclick = m.close;
  $('[data-a="ok"]', m.mask).onclick = async () => {
    if (!(await verifySecPwd($('[data-f="pwd"]', body).value))) { $('[data-v="err"]', body).textContent = '密码错误'; return; }
    m.close(); fn();
  };
}

function setupSecPwdDialog(isChange, done) {
  const body = el(`<div>
    ${isChange ? formRow('当前二级密码', '<input class="input" data-f="old" type="password" autocomplete="off">') : ''}
    ${formRow('新二级密码（6 位以上）', '<input class="input" data-f="pwd" type="password" autocomplete="off" placeholder="与登录密码不同更安全">')}
    ${formRow('再次输入', '<input class="input" data-f="pwd2" type="password" autocomplete="off">')}
    <p class="muted" style="color:#fbbf24">⚠️ 二级密码只保存在本机，忘记后已加密的密钥将无法解密，平台也无法帮你找回。</p>
    <p class="muted" data-v="err" style="color:#ef4444"></p>
  </div>`);
  const m = modal({
    title: isChange ? '修改二级密码' : '设置二级密码', body,
    footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">确定</button>',
  });
  $('[data-a="cancel"]', m.mask).onclick = m.close;
  $('[data-a="ok"]', m.mask).onclick = async () => {
    const err = $('[data-v="err"]', body);
    const pwd = $('[data-f="pwd"]', body).value;
    const pwd2 = $('[data-f="pwd2"]', body).value;
    if (isChange && !(await verifySecPwd($('[data-f="old"]', body).value))) { err.textContent = '当前密码错误'; return; }
    if (pwd.length < 6) { err.textContent = '密码至少 6 位'; return; }
    if (pwd !== pwd2) { err.textContent = '两次输入不一致'; return; }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await kvSet('sec:salt', b64(salt));
    await kvSet('sec:hash', await sha256('th-sec:' + pwd));
    _derivedKey = await deriveKey(pwd, salt);
    m.close();
    toast(isChange ? '二级密码已修改' : '二级密码已设置', 'ok');
    if (isChange) await reEncryptAllKeys();
    done && done();
  };
}

/* 修改密码后重加密所有云端加密密钥 */
async function reEncryptAllKeys() {
  if (!hasCloud()) return;
  const u = await currentUser();
  if (!u) return;
  try {
    const { data } = await getSupabase().from('th_apikeys').select('key_id,name,base,mode').eq('user_id', u.id);
    for (const row of data || []) {
      if (row.mode !== 'enc') continue;
      const plain = await kvGet('ai:key:' + row.key_id, '');
      if (!plain) continue;
      const payload = await encryptText(plain);
      await getSupabase().from('th_apikeys').update({ payload, updated_at: new Date().toISOString() })
        .eq('user_id', u.id).eq('key_id', row.key_id);
    }
  } catch (e) { console.warn('reEncryptAllKeys', e); }
}

/* 密钥存储方式选择行（嵌入厂商密钥编辑弹窗） */
export function keyModeRowHtml(mode) {
  return `<div style="margin-bottom:12px">
    <div class="muted" style="margin-bottom:6px">存储方式</div>
    <div class="row gap4" data-v="modes">
      ${KEY_MODES.map((m) => `<button class="btn btn-sm ${m.id === mode ? 'btn-primary' : ''}" data-mode="${m.id}">${m.name}</button>`).join('')}
    </div>
    <div class="muted" data-v="modedesc" style="margin-top:4px">${KEY_MODES.find((m) => m.id === mode).desc}</div>
  </div>`;
}
export function bindKeyModeRow(container, providerId, onChange) {
  let mode = null;
  const box = $('[data-v="modes"]', container);
  const desc = $('[data-v="modedesc"]', container);
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    mode = b.dataset.mode;
    if (mode === 'cloud-enc') {
      if (!(await hasSecPwd())) {
        toast('请先设置二级密码');
        showSecPwdSettings();
        return;
      }
      if (!(await unlockSecPwd())) return;
    }
    $$('button', box).forEach((x) => x.classList.toggle('btn-primary', x === b));
    desc.textContent = KEY_MODES.find((m) => m.id === mode).desc;
    await setKeyMode(providerId, mode);
    onChange && onChange(mode);
  });
}
