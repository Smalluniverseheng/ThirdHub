/* ===== ThirdHub js/modules/storage.js — 存储管理（v1.7） =====
   本地存储 / 云端存储 / 自有服务器（NAS · WebDAV · 自建服务器）三栏细化管理
   自有服务器支持连接配置 + 实时在线状态扫描（在线绿点 / 离线灰点）
   存储策略可选：本地 → 自有服务器 / 本地 + 云端 / 仅云端
   回收站入口位于本模块底部 */
import { $, $$, el, esc, icon, toast, openOverlay, modal, confirmDialog, formRow, fmtBytes, fmtDate, uid } from '../ui.js';
import { db, kvGet, kvSet } from '../store.js';
import { hasCloud } from '../supabase.js';
import { currentUser, levelById } from '../auth.js';
import { showRecycleBin } from './recycle-bin.js';

/* ================= 自有服务器连接（kv 存储） ================= */
export async function getServers() { return await kvGet('storage:servers', []); }
export async function saveServer(s) {
  const list = await getServers();
  const i = list.findIndex((x) => x.id === s.id);
  if (i >= 0) list[i] = s; else list.push(s);
  await kvSet('storage:servers', list);
}
export async function removeServer(id) {
  await kvSet('storage:servers', (await getServers()).filter((x) => x.id !== id));
}

/* 在线状态扫描：no-cors 探测，可达即在线（无需对方配置 CORS） */
export async function scanServer(url, timeout = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    await fetch(url, { mode: 'no-cors', signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    return true;
  } catch (e) { clearTimeout(t); return false; }
}

export async function storagePolicy() { return await kvGet('storage:policy', 'both'); }

/* ================= 存储管理主页 ================= */
export async function showStorageManagement() {
  openOverlay({
    title: '存储管理',
    build: async (body) => {
      body.innerHTML = `<div class="col gap8" id="sm-cats"></div>`;
      const cats = $('#sm-cats', body);
      const add = (ic, name, desc, fn) => {
        const b = el(`<button class="list-item" style="width:100%">
          <span class="list-ico">${icon(ic)}</span>
          <div class="grow" style="text-align:left;min-width:0">
            <div style="font-size:14px;font-weight:600">${name}</div>
            <div class="muted">${desc}</div>
          </div>
          ${icon('arrowR')}
        </button>`);
        b.onclick = fn;
        cats.appendChild(b);
      };
      add('hdd', '本地存储', '浏览器本地数据占用与各数据分类', () => subLocal());
      add('cloud', '云端存储', hasCloud() ? '云端空间用量与存储策略' : '未配置云端（纯本地模式）', () => subCloud());
      add('server', '自有服务器', '连接 NAS / WebDAV / 自建服务器 · 在线状态', () => subServers());
      add('trash', '回收站', '删除的会话在此保留，到期自动彻底清除', () => showRecycleBin());
    },
  });
}

/* ---------- 本地存储子页 ---------- */
async function subLocal() {
  openOverlay({
    title: '本地存储',
    build: async (body) => {
      let est = { usage: 0, quota: 0 };
      try { est = await navigator.storage.estimate(); } catch (e) {}
      const pct = est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
      const counts = {};
      for (const s of ['sources', 'shelf', 'history', 'favorites', 'chats', 'cache']) {
        try { counts[s] = (await db.all(s)).length; } catch (e) { counts[s] = 0; }
      }
      const NAMES = { sources: '连接器配置', shelf: '书架', history: '浏览历史', favorites: '收藏', chats: 'AI 会话', cache: '章节 / 图片缓存' };
      body.innerHTML = `<div class="set-wrap">
        <div class="card mb16">
          <div class="row gap8" style="align-items:baseline">
            <span style="font-size:20px;font-weight:800;color:var(--primary)">${fmtBytes(est.usage || 0)}</span>
            <span class="muted">/ 浏览器可用 ${fmtBytes(est.quota || 0)}</span>
          </div>
          <div class="storage-bar mt8"><div class="storage-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="section-title">数据分类</div>
        <div class="col gap8 mb16" id="sl-list">
          ${Object.keys(NAMES).map((k) => `
            <button class="list-item" style="width:100%" data-k="${k}">
              <span class="list-ico">${icon(k === 'chats' ? 'robot' : k === 'cache' ? 'hdd' : k === 'sources' ? 'plug' : k === 'shelf' ? 'books' : k === 'history' ? 'history' : 'heart')}</span>
              <div class="grow" style="text-align:left"><div style="font-size:14px;font-weight:600">${NAMES[k]}</div><div class="muted">${counts[k]} 条记录</div></div>
              ${icon('arrowR')}
            </button>`).join('')}
        </div>
        <button class="btn btn-danger btn-block" data-a="clearcache">清空章节 / 图片缓存</button>
      </div>`;
      $$('#sl-list [data-k]', body).forEach((b) => b.onclick = () => subLocalCategory(b.dataset.k, NAMES[b.dataset.k]));
      $('[data-a="clearcache"]', body).onclick = async () => {
        if (await confirmDialog('清空缓存？', '将清空所有章节 / 图片缓存（不影响书架与进度）', '清空', true)) {
          await db.clear('cache');
          toast('缓存已清空', 'ok');
        }
      };
    },
  });
}

/* 本地分类详情（可逐条查看 / 删除） */
async function subLocalCategory(storeKey, name) {
  openOverlay({
    title: name,
    build: async (body) => {
      const list = await db.all(storeKey);
      body.innerHTML = list.length ? '<div class="col gap8" id="slc"></div>' : '<div class="ai-drawer-empty" style="padding:30px 0">暂无数据</div>';
      const box = $('#slc', body);
      if (!box) return;
      list.slice(0, 200).forEach((r) => {
        const title = r.title || r.name || r.k || r.id;
        const item = el(`<div class="list-item">
          <div class="grow" style="min-width:0"><div style="font-size:13px;font-weight:600" class="ellipsis">${esc(String(title))}</div>
          <div class="muted">${esc(String(r.author || r.type || (r.messages ? r.messages.length + ' 条消息' : '') || ''))}</div></div>
          <button class="btn btn-sm btn-danger">删除</button>
        </div>`);
        $('button', item).onclick = async () => {
          if (!(await confirmDialog('删除该条数据？', '删除后不可恢复', '删除', true))) return;
          await db.del(storeKey, r.id || r.k);
          item.remove();
          toast('已删除', 'ok');
        };
        box.appendChild(item);
      });
      if (list.length > 200) box.appendChild(el(`<div class="muted" style="text-align:center;padding:10px">仅显示前 200 条</div>`));
    },
  });
}

/* ---------- 云端存储子页 ---------- */
async function subCloud() {
  const u = await currentUser();
  const lv = levelById(u ? u.level : 'guest');
  const policy = await storagePolicy();
  openOverlay({
    title: '云端存储',
    build: async (body) => {
      const used = (u && u.storageUsed) || 0;
      body.innerHTML = `<div class="set-wrap">
        ${hasCloud() ? `
        <div class="card mb16">
          <div class="row gap8" style="align-items:baseline">
            <span style="font-size:20px;font-weight:800;color:var(--primary)">${fmtBytes(used)}</span>
            <span class="muted">/ ${lv.storage === Infinity ? '无限' : fmtBytes(lv.storage)}（${lv.name}）</span>
          </div>
          <div class="storage-bar mt8"><div class="storage-fill" style="width:${lv.storage === Infinity ? 0 : Math.min(100, (used / lv.storage) * 100)}%"></div></div>
        </div>` : '<div class="card mb16 muted">当前未配置云端，为纯本地模式。配置 Supabase 后可使用云端存储。</div>'}
        <div class="section-title">存储策略</div>
        <div class="muted mb8" style="font-size:12px">选择数据同步的去向（本地数据始终保留在本机）</div>
        <div class="nr-chip-row mb16" id="sc-policy">
          ${[['own', '本地 → 自有服务器'], ['both', '本地 + 云端'], ['cloud', '仅云端']].map(([v, n]) => `<button class="ai-chip ${policy === v ? 'on' : ''}" data-v="${v}">${n}</button>`).join('')}
        </div>
        <div class="muted" style="font-size:12px;line-height:1.7">
          · 本地 → 自有服务器：数据只同步到你在「自有服务器」中连接的 NAS / WebDAV / 服务器<br>
          · 本地 + 云端：同时同步到 ThirdHub 云端，多设备自动一致（默认）<br>
          · 仅云端：以云端为准，进入浏览器时拉取覆盖本地
        </div>
      </div>`;
      $$('#sc-policy .ai-chip', body).forEach((b) => b.onclick = async () => {
        await kvSet('storage:policy', b.dataset.v);
        $$('#sc-policy .ai-chip', body).forEach((x) => x.classList.toggle('on', x === b));
        toast('存储策略已更新', 'ok');
      });
    },
  });
}

/* ---------- 自有服务器子页 ---------- */
async function subServers() {
  openOverlay({
    title: '自有服务器',
    headExtra: '<button class="btn btn-sm btn-primary" id="sv-add">添加</button>',
    build: async (body) => {
      body.innerHTML = `
        <div class="muted" style="line-height:1.7;margin-bottom:12px">连接你自己的 NAS、WebDAV 网盘或自建服务器，作为数据同步与备份目的地。状态实时扫描：绿点 = 在线，灰点 = 离线。</div>
        <div class="col gap8" id="sv-list"></div>`;
      const listBox = $('#sv-list', body);
      let scanTimer = null;
      const TYPES = { nas: 'NAS', webdav: 'WebDAV', server: '自建服务器' };

      async function renderList() {
        const servers = await getServers();
        listBox.innerHTML = servers.length ? '' : '<div class="ai-drawer-empty" style="padding:30px 0">尚未连接任何服务器<br><span style="font-size:12px">点击右上角「添加」连接 NAS / WebDAV</span></div>';
        servers.forEach((s) => {
          const item = el(`<div class="list-item">
            <span class="sv-dot scanning" data-dot="${s.id}"></span>
            <div class="grow" style="min-width:0">
              <div style="font-size:14px;font-weight:600" class="ellipsis">${esc(s.name)} <span class="tag tag-gray">${TYPES[s.type] || s.type}</span></div>
              <div class="muted ellipsis">${esc(s.url)}</div>
            </div>
            <button class="btn btn-sm" data-a="edit">编辑</button>
            <button class="btn btn-sm btn-danger" data-a="rm">删除</button>
          </div>`);
          $('[data-a="edit"]', item).onclick = () => editServer(s, renderList);
          $('[data-a="rm"]', item).onclick = async () => {
            if (await confirmDialog('删除该连接？', '仅删除连接配置，不影响服务器上的数据', '删除', true)) {
              await removeServer(s.id);
              renderList();
            }
          };
          listBox.appendChild(item);
        });
        scanAll();
      }

      /* 实时扫描全部服务器状态 */
      async function scanAll() {
        const servers = await getServers();
        for (const s of servers) {
          const dot = $(`[data-dot="${s.id}"]`, listBox);
          if (!dot) continue;
          dot.className = 'sv-dot scanning';
          scanServer(s.url).then((on) => {
            const d = $(`[data-dot="${s.id}"]`, listBox);
            if (d) { d.className = 'sv-dot ' + (on ? 'online' : 'offline'); d.title = on ? '在线' : '离线'; }
          });
        }
      }

      function editServer(s, done) {
        const isNew = !s.id;
        const b2 = el(`<div>
          ${formRow('类型', `<div class="nr-chip-row" id="sv-type">${Object.entries(TYPES).map(([v, n]) => `<button class="ai-chip ${s.type === v ? 'on' : ''}" data-v="${v}">${n}</button>`).join('')}</div>`)}
          ${formRow('名称', `<input class="input" data-f="name" value="${esc(s.name || '')}" placeholder="例如：家里的群晖">`)}
          ${formRow('地址 URL', `<input class="input" data-f="url" value="${esc(s.url || '')}" placeholder="https://nas.example.com:5006">`)}
          ${formRow('账号（可选）', `<input class="input" data-f="user" value="${esc(s.user || '')}">`)}
          ${formRow('密码 / 令牌（可选）', `<input class="input" type="password" data-f="pass" value="${esc(s.pass || '')}">`)}
          <div class="muted" style="font-size:12px">凭据仅保存在本机，用于 WebDAV 等需要鉴权的连接。</div>
        </div>`);
        let type = s.type || 'webdav';
        $$('#sv-type .ai-chip', b2).forEach((c) => c.onclick = () => { type = c.dataset.v; $$('#sv-type .ai-chip', b2).forEach((x) => x.classList.toggle('on', x === c)); });
        const m = modal({
          title: isNew ? '添加服务器' : '编辑服务器', body: b2,
          footer: '<button class="btn grow" data-a="c">取消</button><button class="btn btn-primary grow" data-a="ok">保存</button>',
        });
        $('[data-a="c"]', m.mask).onclick = m.close;
        $('[data-a="ok"]', m.mask).onclick = async () => {
          const name = $('[data-f="name"]', b2).value.trim();
          let url = $('[data-f="url"]', b2).value.trim();
          if (!name || !url) { toast('请填写名称和地址'); return; }
          if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
          Object.assign(s, {
            id: s.id || uid(), type, name, url,
            user: $('[data-f="user"]', b2).value.trim(),
            pass: $('[data-f="pass"]', b2).value,
          });
          await saveServer(s);
          m.close();
          toast('已保存，正在检测在线状态…', 'ok');
          done();
        };
      }

      $('#sv-add', body.closest('.overlay')).onclick = () => editServer({}, renderList);
      renderList();
      /* 页面打开期间每 30 秒自动复扫 */
      scanTimer = setInterval(() => { if (!document.contains(listBox)) clearInterval(scanTimer); else scanAll(); }, 30000);
    },
  });
}
