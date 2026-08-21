/* ===== ThirdHub js/modules/ai-inspire.js — 灵感广场独立页（v1.6） =====
   成品示例墙：长提示词 + 使用模型署名 + 来源标注；支持用户上传自己的作品。
   hooks.useWork(work)：切换到作品所用模型/工作区并把提示词填入输入框。 */
import { $, $$, el, esc, icon, toast, openOverlay, modal, formRow } from '../ui.js';
import { kvGet, kvSet } from '../store.js';
import { INSPIRATIONS } from '../ai/ai-agents.js';
import { providerById } from '../ai/ai-models.js';
import { vendorIcon } from '../ai/vendors.js';
import { pickModel } from '../ai/model-selector.js';

const TYPE_NAMES = { chat: '聊天', image: '图片', video: '视频' };
const TYPE_ICONS = { chat: 'robot', image: 'image', video: 'film' };

/* 统一作品结构 */
function presetWorks() {
  const out = [];
  INSPIRATIONS.forEach((g) => {
    const type = g.image ? 'image' : g.video ? 'video' : 'chat';
    g.cards.forEach((c) => out.push({
      t: c.t, p: c.p, type,
      model: c.model || null, self: !!c.self,
      source: '官方精选', mine: false,
    }));
  });
  return out;
}
async function userWorks() {
  return (await kvGet('ai:inspire-uploads', [])).map((w) => ({ ...w, mine: true }));
}

/* 作品详情弹窗：来源 / 使用模型 / 完整提示词 / 复制 / 用此模型创作 */
export function showInspireDetail(page, work, hooks, onDelete) {
  const p = work.model ? providerById(work.model.providerId) : null;
  const body = el(`<div>
    <div class="insp-detail-head">
      <span class="insp-type-badge ${work.type}">${icon(TYPE_ICONS[work.type])} ${TYPE_NAMES[work.type]}</span>
      <span class="muted">来源：${esc(work.source || '官方精选')}</span>
    </div>
    <div style="font-size:16px;font-weight:700;margin:8px 0 12px">${esc(work.t)}</div>
    ${work.img ? `<img src="${work.img}" style="width:100%;border-radius:12px;margin-bottom:12px">` : ''}
    ${work.model ? `<button class="insp-model-card" data-a="model">
      <span class="rank-ico">${vendorIcon(work.model.providerId)}</span>
      <div class="grow" style="text-align:left;min-width:0">
        <div style="font-size:13.5px;font-weight:700" class="ellipsis">${esc(work.model.model)}</div>
        <div class="muted">使用模型 · ${esc(p ? p.name : work.model.providerId)}</div>
      </div>
      ${icon('arrowR')}
    </button>` : '<div class="muted" style="margin-bottom:12px">自创作品 · 仅分享提示词</div>'}
    <div class="insp-prompt-box">${esc(work.p)}</div>
  </div>`);
  const m = modal({
    title: '作品详情', body,
    footer: `${work.mine ? '<button class="btn grow btn-danger" data-a="del">删除</button>' : ''}<button class="btn grow" data-a="copy">复制提示词</button><button class="btn btn-primary grow" data-a="use">${work.model ? '用此模型创作' : '使用此提示词'}</button>`,
  });
  if (work.model) $('[data-a="model"]', body).onclick = () => { m.close(); hooks.useWork(work); };
  const del = $('[data-a="del"]', m.mask);
  if (del) del.onclick = async () => { m.close(); onDelete && onDelete(work); };
  $('[data-a="copy"]', m.mask).onclick = async () => {
    try { await navigator.clipboard.writeText(work.p); toast('提示词已复制', 'ok'); } catch (e) { toast('复制失败', 'err'); }
  };
  $('[data-a="use"]', m.mask).onclick = () => { m.close(); hooks.useWork(work); };
}

/* 灵感广场主页 */
export async function showInspirePage(page, hooks) {
  let filter = 'all';
  const ref = openOverlay({
    title: '灵感广场',
    build: async (body) => {
      body.innerHTML = `<div class="set-wrap">
        <div class="row gap8" style="margin-bottom:12px">
          <div class="insp-filters grow">
            ${['all', 'chat', 'image', 'video'].map((f) => `<button class="ai-dfilter ${f === filter ? 'on' : ''}" data-f="${f}">${f === 'all' ? '全部' : TYPE_NAMES[f]}</button>`).join('')}
          </div>
          <button class="btn btn-sm" data-a="upload">${icon('plus')} 上传作品</button>
        </div>
        <div class="insp-grid" id="insp-grid"></div>
      </div>`;
      const grid = $('#insp-grid', body);
      // 从页面内使用作品时，连同页面一起关闭
      const pageHooks = { useWork: (w) => { ref.close(); hooks.useWork(w); } };

      const render = async () => {
        const works = [...(await userWorks()), ...presetWorks()].filter((w) => filter === 'all' || w.type === filter);
        grid.innerHTML = works.length ? '' : '<div class="empty"><div class="empty-title">暂无作品</div></div>';
        works.forEach((w) => {
          const card = el(`<button class="insp-card">
            ${w.img ? `<img class="insp-cover" src="${w.img}">` : `<div class="insp-cover insp-cover-ph">${icon(TYPE_ICONS[w.type])}</div>`}
            <div class="insp-card-body">
              <div class="insp-card-t ellipsis">${esc(w.t)}</div>
              <div class="insp-card-meta">
                ${w.model ? `<span class="insp-card-model">${vendorIcon(w.model.providerId)}<span class="ellipsis">${esc(w.model.model)}</span></span>` : '<span class="muted">自创作品</span>'}
                <span class="insp-type-dot ${w.type}">${TYPE_NAMES[w.type]}</span>
              </div>
            </div>
          </button>`);
          card.onclick = () => showInspireDetail(page, w, pageHooks, async (delWork) => {
            const ups = await kvGet('ai:inspire-uploads', []);
            await kvSet('ai:inspire-uploads', ups.filter((x) => x.id !== delWork.id));
            toast('已删除', 'ok');
            render();
          });
          grid.appendChild(card);
        });
      };
      await render();
      $$('.insp-filters .ai-dfilter', body).forEach((b) => b.onclick = () => {
        filter = b.dataset.f;
        $$('.insp-filters .ai-dfilter', body).forEach((x) => x.classList.toggle('on', x === b));
        render();
      });
      $('[data-a="upload"]', body).onclick = () => uploadDialog(render);
    },
  });

  /* 上传作品 */
  function uploadDialog(onDone) {
    let type = 'chat', model = null, img = '';
    const body = el(`<div>
      ${formRow('作品标题', '<input class="input" data-f="t" placeholder="给我的作品起个名字">')}
      ${formRow('类型', `<div class="row gap8" data-v="types">
        ${['chat', 'image', 'video'].map((t) => `<button class="ai-ws-chip sm ${t === type ? 'on' : ''}" data-t="${t}">${TYPE_NAMES[t]}</button>`).join('')}
      </div>`)}
      ${formRow('完整提示词', '<textarea class="input" rows="5" data-f="p" placeholder="创作这个作品时使用的完整提示词（越详细越能帮助别人）"></textarea>')}
      ${formRow('使用模型（可选）', '<button class="btn btn-block" data-a="model">选择模型</button>')}
      ${formRow('封面图（可选）', '<button class="btn btn-block" data-a="img">上传图片</button><input type="file" accept="image/*" data-f="imgfile" hidden>')}
      ${formRow('署名（可选）', '<input class="input" data-f="src" placeholder="你的昵称">')}
    </div>`);
    $$('[data-t]', body).forEach((b) => b.onclick = () => {
      type = b.dataset.t;
      $$('[data-t]', body).forEach((x) => x.classList.toggle('on', x === b));
    });
    $('[data-a="model"]', body).onclick = async () => {
      const picked = await pickModel();
      if (picked) { model = picked; $('[data-a="model"]', body).textContent = picked.model; }
    };
    $('[data-a="img"]', body).onclick = () => $('[data-f="imgfile"]', body).click();
    $('[data-f="imgfile"]', body).onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { img = rd.result; $('[data-a="img"]', body).textContent = '已选择图片'; };
      rd.readAsDataURL(f);
    };
    const m = modal({
      title: '上传作品到灵感广场', body,
      footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">发布</button>',
    });
    $('[data-a="cancel"]', m.mask).onclick = m.close;
    $('[data-a="ok"]', m.mask).onclick = async () => {
      const t = $('[data-f="t"]', body).value.trim();
      const p = $('[data-f="p"]', body).value.trim();
      if (!t || !p) return toast('请填写标题和完整提示词');
      const work = {
        id: Date.now(), t, p, type, model,
        img: img || '', self: !model,
        source: $('[data-f="src"]', body).value.trim() || '用户分享',
      };
      const ups = await kvGet('ai:inspire-uploads', []);
      ups.unshift(work);
      await kvSet('ai:inspire-uploads', ups.slice(0, 100));
      // 已登录云端时同步分享（失败静默）
      try {
        const { hasCloud, getSupabase } = await import('../supabase.js');
        if (hasCloud()) {
          const { data: sess } = await getSupabase().auth.getSession();
          if (sess && sess.session) {
            await getSupabase().from('th_inspiration').insert({
              user_id: sess.session.user.id, id: String(work.id),
              data: { t: work.t, p: work.p, type: work.type, model: work.model, source: work.source },
              updated_at: new Date().toISOString(),
            });
          }
        }
      } catch (e) {}
      m.close();
      toast('已发布到灵感广场', 'ok');
      onDone && onDone();
    };
  }
}
