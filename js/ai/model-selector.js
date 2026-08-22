/* ===== ThirdHub js/ai/model-selector.js — 模型选择器 v2.2（底部弹出 · 我的模型 · 按厂商分组 · 类型过滤 · 同步模型合并） ===== */
import { PROVIDERS, refreshCustomProviders, modelIdOf, modelNickOf, sortProviders, modelCapTags } from './ai-models.js';
import { vendorIcon } from './vendors.js';
import { modal, $, esc, icon } from '../ui.js';
import { getApiKey, getSyncedModels, getFreeModel, refreshFreeModels } from './ai-api.js';
import { kvGet, kvSet } from '../store.js';

/* type: 'chat'（默认）| 'image' | 'video' */
export async function pickModel({ multi = false, selected = [], type = 'chat' } = {}) {
  await refreshCustomProviders();
  await refreshFreeModels().catch(() => {});
  const freeModels = await getFreeModel();
  /* v5.5：国内厂商优先（deepseek 置顶、kimi 次之），国外靠后 */
  const ordered = [
    ...PROVIDERS.filter((p) => p.custom),
    ...sortProviders(PROVIDERS.filter((p) => !p.custom && p.id !== 'custom')),
  ];
  const keys = {};
  for (const p of ordered) keys[p.id] = !!(await getApiKey(p.id));

  // 各类型可用模型
  const modelsOf = (p) => {
    if (type === 'image') return p.image || [];
    if (type === 'video') return p.video || [];
    return p.models || [];
  };
  // 聊天类型合并实时同步的模型（不含历史模型与非对话模型）
  const NON_CHAT_RE = /embed|whisper|tts|transcri|speech|audio|dall-e|image|imagen|moderation|rerank|babbage|davinci|clip|sora|veo|wanx|cogview|cogvideo|kolors|stable-diffusion|seedream|seedance|hailuo|sensemirage/i;
  const syncedMap = {};
  if (type === 'chat') {
    for (const p of ordered) {
      const synced = await getSyncedModels(p.id);
      if (synced.length) syncedMap[p.id] = synced.filter((m) => !(p.deprecated || []).includes(m) && !(p.models || []).map(modelIdOf).includes(m) && !NON_CHAT_RE.test(m));
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };

    const body = document.createElement('div');
    body.innerHTML = `
      <div class="ms-search"><input class="input" placeholder="搜索模型或厂商…"></div>
      <div class="ms-list"></div>
      ${multi ? '<div style="padding-top:10px"><button class="btn btn-primary btn-block" data-a="done">确定</button></div>' : ''}`;
    const listEl = $('.ms-list', body);
    const picked = new Set(selected);

    let myHeader = false;
    let kw = '';
    function render(filter = '') {
      kw = filter.trim().toLowerCase();
      listEl.innerHTML = '';
      /* v7.2：后端设备（DSH）分组 —— 从模型选择器直接选后端 */
      renderBackend();
      /* v5.8：异步渲染完成后才判断空态，避免空态文案残留在列表顶部 */
      Promise.all(ordered.map((p) => Promise.resolve().then(() => renderVendor(p)))).then(() => {
        if (!listEl.children.length) listEl.innerHTML = '<div class="empty"><div class="empty-title">没有匹配的模型</div></div>';
      });
    }
    async function renderBackend() {
      let devices = [];
      try {
        const { listDevices, getStatus } = await import('../modules/compute.js');
        devices = listDevices().filter((d) => d.paired || d.auto);
        const statusOf = (id) => getStatus(id);
        if (!devices.length) return;
        const group = document.createElement('div');
        group.className = 'ms-group open';
        group.innerHTML = `
          <button class="ms-vendor">
            <span class="ms-vico">${vendorIcon('cpu')}</span>
            <span class="ms-vname ellipsis">🖥️ 后端设备（DSH）</span>
            <span class="ms-vcount">${devices.length}</span>
            <span class="ms-chev">${icon('arrowR')}</span>
          </button>
          <div class="ms-items"></div>`;
        const itemsEl = group.querySelector('.ms-items');
        group.querySelector('.ms-vendor').onclick = () => { const open = itemsEl.hidden; itemsEl.hidden = !open; group.classList.toggle('open', open); };
        devices.forEach((d) => {
          const st = statusOf(d.id);
          const item = document.createElement('button');
          item.className = 'ms-item' + (st === 'online' ? '' : ' dim');
          item.innerHTML = `<span class="ellipsis">🖥️ ${esc(d.name || d.host)}${st === 'online' ? '<span class="tag tag-green" style="font-size:10px">在线</span>' : '<span class="tag tag-gray" style="font-size:10px">离线 · 自动重连</span>'}</span>`;
          item.onclick = () => {
            if (st !== 'online') toast('设备离线，连接后自动生效', 'ok');
            settle({ providerId: 'backend', model: d.id });
            m2.mask.remove();
          };
          itemsEl.appendChild(item);
        });
        listEl.appendChild(group);
      } catch (e) {}
    }
    async function renderVendor(p) {
      let entries = modelsOf(p).map((m) => ({
        id: modelIdOf(m), nick: modelNickOf(m), isNew: false,
        meta: (typeof m === 'object' && m) ? m : null,
      })).filter((x) => x.id);
      if (syncedMap[p.id]) entries = entries.concat(syncedMap[p.id].map((m) => ({ id: m, nick: m, isNew: true })));
      entries = entries.filter((x) => !kw || x.id.toLowerCase().includes(kw) || x.nick.toLowerCase().includes(kw) || p.name.toLowerCase().includes(kw));
      /* v6.6：云端限时免费（管理后台 th_free_models）注入标记并置顶 */
      const fms = freeModels.filter((m) => m.provider === p.id);
      if (fms.length) entries = entries.map((x) => {
        const fm = fms.find((m) => m.model === x.id);
        return fm ? Object.assign({}, x, { free: fm, meta: Object.assign({}, x.meta || {}, { tags: ((x.meta && x.meta.tags) || []).concat('free') }) }) : x;
      });
      /* v5.5：置顶模型排最前（按置顶先后） */
      const pins = (await kvGet('ai:model-pins', [])) || [];
      const pinRank = (x) => { const i = pins.indexOf(p.id + '/' + x.id); return i < 0 ? 999 : i; };
      entries = entries.sort((a, b) => pinRank(a) - pinRank(b));
      /* v7.1：已配置厂商优先 + 限时免费/推荐，再按隐私等级 安全→注意→风险 排序 */
      const plv = (x) => { const v = x.meta && x.meta.privacyLevel; return v === 'risk' ? 2 : v === 'caution' ? 1 : v === 'safe' ? 0 : 1; };
      const cfgW = !!keys[p.id] ? 2 : 0;
      const hot = (x) => (x.free ? 4 : 0) + ((x.meta && x.meta.recommended) ? 2 : 0) + cfgW;
      entries = entries.sort((a, b) => (hot(b) - hot(a)) || (plv(a) - plv(b)));
      if (!entries.length) return;
      if (p.custom && !myHeader) {
        myHeader = true;
        const sec = document.createElement('div');
        sec.className = 'ai-drawer-sec';
        sec.style.padding = '2px 4px 6px';
        sec.textContent = '我的模型';
        listEl.appendChild(sec);
      }
      const group = document.createElement('div');
      const hasPicked = entries.some((x) => picked.has(p.id + '/' + x.id));
      const expand = !!kw || hasPicked || p.custom;
      group.className = 'ms-group' + (expand ? ' open' : '');
      group.innerHTML = `
        <button class="ms-vendor">
          <span class="ms-vico">${vendorIcon(p.id)}</span>
          <span class="ms-vname ellipsis">${esc(p.name)}</span>${p.desc ? `<span class="muted" style="font-size:10.5px;margin-left:6px">${esc(p.desc)}</span>` : ''}
          <span class="ms-vcount">${entries.length}</span>
          ${keys[p.id] ? '<span class="tag tag-green">已配置</span>' : '<span class="tag tag-gray">未配置</span>'}
          <span class="ms-chev">${icon('arrowR')}</span>
        </button>
        <div class="ms-items" ${expand ? '' : 'hidden'}></div>`;
      const itemsEl = group.querySelector('.ms-items');
      group.querySelector('.ms-vendor').onclick = () => {
        const open = itemsEl.hidden;
        itemsEl.hidden = !open;
        group.classList.toggle('open', open);
      };
      entries.forEach((x) => {
        const id = p.id + '/' + x.id;
        const item = document.createElement('button');
        item.className = 'ms-item' + (picked.has(id) ? ' on' : '') + (keys[p.id] ? '' : ' dim');
        const meta = x.meta || {};
        const pr = meta.privacyLevel;
        const prBadge = pr === 'safe' ? '<span class="tag tag-green" style="font-size:10px">安全</span>'
          : pr === 'risk' ? '<span class="tag" style="background:#ef444422;color:#ef4444;font-size:10px">风险</span>'
          : pr === 'caution' ? '<span class="tag" style="background:#fbbf2422;color:#fbbf24;font-size:10px">注意</span>' : '';
        const freeLeft = (() => {
          if (!x.free) return '';
          const d = x.free.end_time ? Math.max(0, Math.ceil((new Date(x.free.end_time).getTime() - Date.now()) / 86400000)) : -1;
          if (x.free.remaining >= 0) return ' 剩' + x.free.remaining + '次';
          if (d >= 0) return ' 剩' + d + '天';
          return '';
        })();
        const freeTag = (meta.tags || []).includes('free') ? '<span class="tag" style="background:#22c55e22;color:#22c55e;font-size:10px">🆓 限时免费' + esc(freeLeft) + '</span>' : '';
        const recTag = meta.recommended ? '<span class="tag" style="background:#f59e0b22;color:#f59e0b;font-size:10px">⭐ 推荐</span>' : '';
        item.innerHTML = `<span class="ellipsis">${esc(x.nick)}${x.nick !== x.id ? `<span class="muted" style="font-size:11px;margin-left:6px">${esc(x.id)}</span>` : ''}</span>${freeTag}${recTag}${prBadge}${x.isNew ? '<span class="tag tag-blue">新上线</span>' : ''}${modelCapTags(p.id, x.id)}${picked.has(id) ? icon('check') : ''}`;
        if (pr === 'risk' && meta.privacyNote) item.title = '⚠️ ' + meta.privacyNote;
        /* v5.5：长按模型置顶（可多个，按置顶先后；云端同步） */
        let pinTimer = null;
        item.addEventListener('touchstart', () => { pinTimer = setTimeout(pinModel, 550); }, { passive: true });
        item.addEventListener('touchend', () => clearTimeout(pinTimer));
        item.addEventListener('touchmove', () => clearTimeout(pinTimer));
        item.addEventListener('contextmenu', (e) => { e.preventDefault(); pinModel(); });
        async function pinModel() {
          const list = (await kvGet('ai:model-pins', [])) || [];
          const key2 = p.id + '/' + x.id;
          const rest = list.filter((k3) => k3 !== key2);
          rest.push(key2);
          await kvSet('ai:model-pins', rest);
          toast('已置顶：' + (x.nick || x.id), 'ok');
          render(kw ? $('.ms-search input', body).value : '');
        }
        item.onclick = () => {
          if (multi) {
            picked.has(id) ? picked.delete(id) : picked.add(id);
            render(kw ? $('.ms-search input', body).value : '');
          } else {
            if (pr === 'risk') toast('⚠️ 隐私警告：' + (meta.privacyNote || '该模型可能记录使用数据，请勿发送机密信息'), 'err');
            settle({ providerId: p.id, model: x.id });
            m2.mask.remove();
          }
        };
        itemsEl.appendChild(item);
      });
      listEl.appendChild(group);
    }
    render();
    $('.ms-search input', body).addEventListener('input', (e) => render(e.target.value));
    const titles = { chat: multi ? '选择多个模型（对比/协同）' : '选择模型', image: '选择绘画模型', video: '选择视频模型' };
    const m2 = modal({ title: titles[type] || titles.chat, body, onClose: () => settle(multi ? [...picked].map(parseId) : null) });
    if (multi) {
      $('[data-a="done"]', body).onclick = () => { settle([...picked].map(parseId)); m2.mask.remove(); };
    }
    function parseId(s) { const i = s.indexOf('/'); return { providerId: s.slice(0, i), model: s.slice(i + 1) }; }
  });
}
