/* ===== ThirdHub js/modules/devices.js — 多设备管理（v1.7） =====
   每台登录设备 / 浏览器自动登记（浏览器 + 系统 + 最近活跃时间）
   云端同步设备列表；超过 20 台时自动清除最久未使用的设备；
   可手动移除任意设备（该设备下次同步时会被要求重新登录） */
import { $, el, esc, icon, toast, openOverlay, confirmDialog, fmtDate, uid } from '../ui.js';
import { kvGet, kvSet } from '../store.js';
import { hasCloud, syncPush, syncPull, getSupabase } from '../supabase.js';
import { currentUser } from '../auth.js';

const MAX_DEVICES = 20;

/* 客户端平台：android-app（安装包）/ ios / browser（浏览器） */
function clientPlatform() {
  try {
    if (window.ThirdHubNative && window.ThirdHubNative.isNative && window.ThirdHubNative.isNative()) {
      return (window.ThirdHubNative.platform && window.ThirdHubNative.platform()) === 'android' ? 'android-app' : 'native';
    }
  } catch (e) {}
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return 'browser';
}

function deviceName() {
  const ua = navigator.userAgent;
  const pf = clientPlatform();
  // 安卓安装包：优先读取系统真实机型（如 "Xiaomi 14" / "HUAWEI Mate 60"）
  if (pf === 'android-app') {
    try {
      const model = window.ThirdHubNative.getDeviceModel && window.ThirdHubNative.getDeviceModel();
      if (model) return model;
    } catch (e) {}
  }
  let os = '未知系统';
  let model = '';
  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) {
    os = 'Android';
    // 尽力从 UA 中提取机型（如 "Android 14; SM-S918B" / "Android 13; Pixel 7"）
    const mm = ua.match(/Android[\s/][\d.]+;\s*(?:[a-zA-Z]{2,}_[a-zA-Z]{2,};\s*)?(?:wv;\s*)?([^;)]+)/);
    if (mm && mm[1] && !/^(K|Build|wv)$/i.test(mm[1].trim())) model = mm[1].trim();
  }
  else if (/iPhone|iPad/i.test(ua)) os = /iPad/.test(ua) ? 'iPad' : 'iPhone';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  if (pf === 'ios') return os; // iOS 浏览器 UA 不含具体机型
  let br = '浏览器';
  if (/Edg\//i.test(ua)) br = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) br = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) br = 'Safari';
  else if (/Firefox\//i.test(ua)) br = 'Firefox';
  else if (/MicroMessenger/i.test(ua)) br = '微信内置';
  return model ? `${model}（${br}）` : `${br} · ${os}`;
}

export async function myDeviceId() {
  let id = await kvGet('device:id', '');
  if (!id) { id = uid(); await kvSet('device:id', id); }
  return id;
}

/* 登记 / 刷新本设备（启动时调用）；超限自动清除最久未用设备 */
export async function registerDevice() {
  if (!hasCloud()) return;
  const u = await currentUser();
  if (!u) return;
  const id = await myDeviceId();
  const info = { name: deviceName(), platform: clientPlatform(), ua: navigator.userAgent.slice(0, 180), lastSeen: Date.now(), createdAt: (await kvGet('device:createdAt', 0)) || Date.now() };
  await kvSet('device:createdAt', info.createdAt);
  await syncPush('th_devices', { id, data: info }, u.id);

  /* 超过 20 台 → 清除最久未使用的（保留本机） */
  try {
    const rows = await syncPull('th_devices', u.id);
    if (rows.length > MAX_DEVICES) {
      const sorted = rows
        .filter((r) => r.id !== id)
        .sort((a, b) => ((a.data && a.data.lastSeen) || 0) - ((b.data && b.data.lastSeen) || 0));
      const excess = rows.length - MAX_DEVICES;
      const sb = getSupabase();
      for (const r of sorted.slice(0, excess)) {
        await sb.from('th_devices').delete().eq('id', r.id);
      }
    }
  } catch (e) {}
}

/* ================= 多设备管理页面 ================= */
export async function showDevices() {
  const u = await currentUser();
  if (!u) { toast('登录后可管理多设备'); return; }
  if (!hasCloud()) { toast('当前为纯本地模式，无法使用多设备管理'); return; }
  openOverlay({
    title: '多设备管理',
    build: async (body) => {
      body.innerHTML = `<div class="set-wrap">
        <div class="muted" style="line-height:1.7;margin-bottom:14px">已登录的设备 / 浏览器会自动同步数据。最多保留 ${MAX_DEVICES} 台设备，超过后自动清除最久未使用的设备。</div>
        <div class="col gap8" id="dev-list"><div class="muted" style="padding:20px 0;text-align:center">加载中…</div></div>
      </div>`;
      const listBox = $('#dev-list', body);
      const myId = await myDeviceId();

      async function renderList() {
        const rows = (await syncPull('th_devices', u.id))
          .sort((a, b) => ((b.data && b.data.lastSeen) || 0) - ((a.data && a.data.lastSeen) || 0));
        if (!rows.length) { listBox.innerHTML = '<div class="muted" style="padding:20px 0;text-align:center">暂无设备记录</div>'; return; }
        listBox.innerHTML = '';
        rows.forEach((r) => {
          const d = r.data || {};
          const mine = r.id === myId;
          // 平台标识：安卓App / iOS / 浏览器（老数据无 platform 字段时按 UA 推断）
          let pf = d.platform;
          if (!pf) pf = /iPhone|iPad/i.test(d.ua || '') ? 'ios' : 'browser';
          const pfName = { 'android-app': '安卓App', native: '安卓App', ios: 'iOS', browser: '浏览器' }[pf] || '浏览器';
          const pfColor = { 'android-app': 'tag-green', native: 'tag-green', ios: 'tag-purple', browser: 'tag-gray' }[pf] || 'tag-gray';
          const item = el(`<div class="list-item">
            <span class="list-ico">${icon(pf === 'browser' ? 'devices' : 'phone')}</span>
            <div class="grow" style="min-width:0">
              <div style="font-size:14px;font-weight:600" class="ellipsis">${esc(d.name || '未知设备')}${mine ? ' <span class="tag tag-blue">本机</span>' : ''}</div>
              <div class="muted"><span class="tag ${pfColor}" style="margin-right:4px">${pfName}</span>最近活跃 ${d.lastSeen ? fmtDate(d.lastSeen, true) : '未知'}</div>
            </div>
            ${mine ? '' : `<button class="btn btn-sm btn-danger" data-a="rm">移除</button>`}
          </div>`);
          const rm = $('[data-a="rm"]', item);
          if (rm) rm.onclick = async () => {
            if (!(await confirmDialog('移除该设备？', '移除后该设备将停止同步，需重新登录。', '移除', true))) return;
            await getSupabase().from('th_devices').delete().eq('id', r.id);
            toast('已移除', 'ok');
            renderList();
          };
          listBox.appendChild(item);
        });
      }
      renderList();
    },
  });
}
