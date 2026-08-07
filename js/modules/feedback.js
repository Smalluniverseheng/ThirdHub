/* ===== ThirdHub js/modules/feedback.js — 意见反馈（v1.7） =====
   用户可提交反馈（公开 = 所有用户可见并可评论 / 仅管理员团队可见）
   公开反馈支持留言讨论；需要登录（云端模式） */
import { $, $$, el, esc, icon, toast, openOverlay, modal, formRow, fmtDate, uid } from '../ui.js';
import { hasCloud, getSupabase } from '../supabase.js';
import { currentUser } from '../auth.js';

async function sb() { return getSupabase(); }

export async function listFeedback() {
  const { data, error } = await (await sb()).from('th_feedback').select('*').order('updated_at', { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({ id: r.id, ...(r.data || {}), userId: r.user_id, updatedAt: r.updated_at }));
}

export async function addFeedback({ title, content, visibility }) {
  const u = await currentUser();
  const id = uid();
  const row = {
    id, user_id: u.id,
    data: { title, content, visibility, nickname: u.nickname || (u.email || '').split('@')[0], status: 'open', createdAt: Date.now() },
  };
  const { error } = await (await sb()).from('th_feedback').insert(row);
  if (error) throw new Error(error.message);
  return id;
}

export async function listComments(fid) {
  const { data, error } = await (await sb()).from('th_feedback_comments').select('*')
    .order('updated_at', { ascending: true });
  if (error) return [];
  return (data || []).map((r) => ({ id: r.id, ...(r.data || {}), userId: r.user_id })).filter((c) => c.feedbackId === fid);
}

export async function addComment(fid, content) {
  const u = await currentUser();
  const row = { id: uid(), user_id: u.id, data: { feedbackId: fid, content, nickname: u.nickname || (u.email || '').split('@')[0], createdAt: Date.now() } };
  const { error } = await (await sb()).from('th_feedback_comments').insert(row);
  if (error) throw new Error(error.message);
}

/* ================= 反馈广场页面 ================= */
export async function showFeedback() {
  if (!hasCloud()) { toast('意见反馈需要云端模式'); return; }
  const u = await currentUser();
  if (!u) { toast('请先登录后再提交反馈'); return; }
  openOverlay({
    title: '意见反馈',
    headExtra: '<button class="btn btn-sm btn-primary" id="fb-new">提交反馈</button>',
    build: async (body) => {
      body.innerHTML = `
        <div class="muted" style="line-height:1.7;margin-bottom:12px">在这里提交建议或报告问题。选择「公开」后其他用户可以看到并留言讨论；选择「仅管理员团队可见」则只有管理员能看到。</div>
        <div class="col gap8" id="fb-list"><div class="muted" style="padding:20px 0;text-align:center">加载中…</div></div>`;
      const listBox = $('#fb-list', body);

      async function renderList() {
        let items = [];
        try { items = await listFeedback(); }
        catch (e) { listBox.innerHTML = `<div class="muted" style="padding:20px 0;text-align:center">加载失败：${esc(e.message)}</div>`; return; }
        if (!items.length) { listBox.innerHTML = '<div class="ai-drawer-empty" style="padding:30px 0">还没有反馈，来提第一条吧</div>'; return; }
        listBox.innerHTML = '';
        items.forEach((f) => {
          const mine = f.userId === u.id;
          const card = el(`<button class="card" style="text-align:left;width:100%">
            <div class="row gap8" style="align-items:baseline">
              <span style="font-size:14px;font-weight:700" class="ellipsis grow">${esc(f.title)}</span>
              <span class="tag ${f.visibility === 'public' ? 'tag-green' : 'tag-gray'}">${f.visibility === 'public' ? '公开' : '仅管理员'}</span>
            </div>
            <div class="muted mt8" style="font-size:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(f.content)}</div>
            <div class="muted mt8" style="font-size:11px">${esc(f.nickname || '用户')}${mine ? '（我）' : ''} · ${fmtDate(f.createdAt || Date.now())}</div>
          </button>`);
          card.onclick = () => showFeedbackDetail(f, renderList);
          listBox.appendChild(card);
        });
      }

      $('#fb-new', body.closest('.overlay') || document).onclick = () => {
        const b2 = el(`<div>
          ${formRow('标题', '<input class="input" data-f="title" maxlength="40" placeholder="一句话描述你的建议或问题">')}
          ${formRow('详细内容', '<textarea class="input" rows="5" data-f="content" maxlength="1000" placeholder="描述复现步骤、期望效果等"></textarea>')}
          <div class="muted mb8">可见范围</div>
          <div class="nr-chip-row mb16" id="fb-vis">
            <button class="ai-chip on" data-v="public">公开（所有人可见，可评论）</button>
            <button class="ai-chip" data-v="admin">仅管理员团队可见</button>
          </div>
        </div>`);
        let vis = 'public';
        $$('#fb-vis .ai-chip', b2).forEach((c) => c.onclick = () => { vis = c.dataset.v; $$('#fb-vis .ai-chip', b2).forEach((x) => x.classList.toggle('on', x === c)); });
        const m = modal({
          title: '提交反馈', body: b2,
          footer: '<button class="btn grow" data-a="c">取消</button><button class="btn btn-primary grow" data-a="ok">提交</button>',
        });
        $('[data-a="c"]', m.mask).onclick = m.close;
        $('[data-a="ok"]', m.mask).onclick = async () => {
          const title = $('[data-f="title"]', b2).value.trim();
          const content = $('[data-f="content"]', b2).value.trim();
          if (!title || !content) { toast('请填写标题和内容'); return; }
          try {
            await addFeedback({ title, content, visibility: vis });
            m.close();
            toast('反馈已提交，感谢！', 'ok');
            renderList();
          } catch (e) { toast('提交失败：' + e.message, 'err'); }
        };
      };

      renderList();
    },
  });
}

/* 反馈详情 + 评论 */
function showFeedbackDetail(f, onChange) {
  openOverlay({
    title: '反馈详情',
    build: async (body) => {
      body.innerHTML = `
        <div class="card mb16">
          <div class="row gap8" style="align-items:baseline">
            <span style="font-size:16px;font-weight:800" class="grow">${esc(f.title)}</span>
            <span class="tag ${f.visibility === 'public' ? 'tag-green' : 'tag-gray'}">${f.visibility === 'public' ? '公开' : '仅管理员'}</span>
          </div>
          <div style="font-size:14px;line-height:1.8;margin-top:10px;white-space:pre-wrap">${esc(f.content)}</div>
          <div class="muted mt8" style="font-size:12px">${esc(f.nickname || '用户')} · ${fmtDate(f.createdAt || Date.now())}</div>
        </div>
        <div class="section-title">留言</div>
        <div class="col gap8 mb16" id="fb-comments"></div>
        <div class="row gap8">
          <input class="input grow" id="fb-cinput" placeholder="写下你的留言…" maxlength="300">
          <button class="btn btn-primary" id="fb-csend">发送</button>
        </div>`;
      const cBox = $('#fb-comments', body);

      async function renderComments() {
        const comments = await listComments(f.id);
        cBox.innerHTML = comments.length ? '' : '<div class="muted" style="padding:12px 0;text-align:center">暂无留言</div>';
        comments.forEach((c) => {
          cBox.appendChild(el(`<div class="card" style="padding:10px 12px">
            <div class="row gap8" style="align-items:baseline"><span style="font-size:13px;font-weight:700">${esc(c.nickname || '用户')}</span><span class="muted" style="font-size:11px">${fmtDate(c.createdAt || Date.now())}</span></div>
            <div style="font-size:13px;line-height:1.7;margin-top:4px;white-space:pre-wrap">${esc(c.content)}</div>
          </div>`));
        });
      }

      $('#fb-csend', body).onclick = async () => {
        const v = $('#fb-cinput', body).value.trim();
        if (!v) return;
        try {
          await addComment(f.id, v);
          $('#fb-cinput', body).value = '';
          renderComments();
        } catch (e) { toast('留言失败：' + e.message, 'err'); }
      };
      renderComments();
    },
  });
}
