/* ===== ThirdHub js/ai/model-selector.js — 模型选择器 v2.2（底部弹出 · 我的模型 · 按厂商分组 · 类型过滤 · 同步模型合并） ===== */
import { PROVIDERS, refreshCustomProviders, modelIdOf, modelNickOf, sortProviders, modelCapTags } from './ai-models.js';
import { vendorIcon } from './vendors.js';
import { modal, $, esc, icon } from '../ui.js';
import { getApiKey, getSyncedModels } from './ai-api.js';
import { kvGet, kvSet } from '../store.js';

/* type: 'chat'（默认）| 'image' | 'video' */
export async function pickModel({ multi = false, selected = [], type = 'chat' } = {}) {
  await refreshCustomProviders();
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
      /* v5.8：异步渲染完成后才判断空态，避免空态文案残留在列表顶部 */
      Promise.all(ordered.map((p) => Promise.resolve().then(() => renderVendor(p)))).then(() => {
        if (!listEl.children.length) listEl.innerHTML = '<div class="empty"><div class="empty-title">没有匹配的模型</div></div>';
      });
    }
    async function renderVendor(p) {
      let entries = modelsOf(p).map((m) => ({ id: modelIdOf(m), nick: modelNickOf(m), isNew: false })).filter((x) => x.id);
      if (syncedMap[p.id]) entries = entries.concat(syncedMap[p.id].map((m) => ({ id: m, nick: m, isNew: true })));
      entries = entries.filter((x) => !kw || x.id.toLowerCase().includes(kw) || x.nick.toLowerCase().includes(kw) || p.name.toLowerCase().includes(kw));
      /* v5.5：置顶模型排最前（按置顶先后） */
      const pins = (await kvGet('ai:model-pins', [])) || [];
      const pinRank = (x) => { const i = pins.indexOf(p.id + '/' + x.id); return i < 0 ? 999 : i; };
      entries = entries.sort((a, b) => pinRank(a) - pinRank(b));
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
          <span class="ms-vname ellipsis">${esc(p.name)}</span>
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
        item.innerHTML = `<span class="ellipsis">${esc(x.nick)}${x.nick !== x.id ? `<span class="muted" style="font-size:11px;margin-left:6px">${esc(x.id)}</span>` : ''}</span>${x.isNew ? '<span class="tag tag-blue">新上线</span>' : ''}${modelCapTags(p.id, x.id)}${picked.has(id) ? icon('check') : ''}`;
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
