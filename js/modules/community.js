/* ===== ThirdHub js/modules/community.js — 社区（v4.8） =====
   帖子流（推荐 / 求助）· 发帖（可关联书架书 / AI 会话）· 详情 + 实时评论（Supabase Realtime）
   数据表 community_posts / community_comments（需在 Supabase 中创建，RLS：公开可读、仅本人可写） */
import { $, $$, esc, icon, toast, openOverlay, fmtDate } from '../ui.js';
import { getSupabase, hasCloud } from '../supabase.js';
import { currentUser } from '../auth.js';
import { db } from '../store.js';
import { openDetail } from './detail.js';

const TABS = [
  { id: 'all', name: '推荐' },
  { id: 'help', name: '求助' },
];
const CAT = { share: '分享', help: '求助' };
const RELATED_TYPE = { book: '📚', ai_session: '🤖' };

function sb() { return getSupabase(); }
async function needLogin() {
  const u = await currentUser();
  if (u) return u;
  toast('社区发言需登录账号（免费会员即可，游客不可发言）', 'err');
  return null;
}
function relLabel(r) {
  if (!r) return '';
  if (r.related_type === 'book') return '📚 关联：《' + (r.related_title || '书籍') + '》';
  if (r.related_type === 'ai_session') return '🤖 关联：AI 会话「' + (r.related_title || '') + '」';
  return '';
}

/* ---------- 帖子流 ---------- */
export async function renderCommunity(page) {
  page.innerHTML = `
    <div class="page-head">
      <div class="page-title">社区</div>
      <div class="spacer"></div>
      <button class="icon-btn" data-a="post" title="发帖">${icon('edit')}</button>
    </div>
    <div class="cm-tabs">${TABS.map((t) => `<button class="cm-tab ${t.id === 'all' ? 'on' : ''}" data-tab="${t.id}">${t.name}</button>`).join('')}</div>
    <div class="cm-feed" data-role="feed"></div>`;

  let curTab = 'all';
  let pageN = 0;
  const feed = $('[data-role="feed"]', page);

  $$('.cm-tab', page).forEach((b) => b.onclick = () => {
    curTab = b.dataset.tab;
    $$('.cm-tab', page).forEach((x) => x.classList.toggle('on', x === b));
    load(true);
  });

  async function load(reset = false) {
    if (!hasCloud()) { feed.innerHTML = '<div class="cm-post"><div class="muted" style="text-align:center;padding:14px">云端未配置，社区暂不可用</div></div>'; return; }
    if (reset) { pageN = 0; feed.innerHTML = '<div class="loading-row"><div class="spinner"></div>加载中…</div>'; }
    const u = await currentUser();
    const query = sb().from('community_posts').select('*').order('created_at', { ascending: false }).range(pageN * 20, pageN * 20 + 19);
    if (curTab === 'help') query.eq('category', 'help');
    const { data, error } = await query;
    if (error) { feed.innerHTML = '<div class="cm-post"><div class="muted" style="text-align:center;padding:14px">加载失败：' + esc(error.message) + '</div></div>'; return; }
    const rows = data || [];
    const html = rows.map((p) => postHtml(p, u)).join('');
    if (reset) feed.innerHTML = html || '<div class="cm-post"><div class="muted" style="text-align:center;padding:14px">还没有帖子，来发第一帖吧 ✍️</div></div>';
    else feed.insertAdjacentHTML('beforeend', html);
    const more = $('[data-a="cm-more"]', feed);
    if (more) more.remove();
    if (rows.length === 20) {
      feed.insertAdjacentHTML('beforeend', '<button class="cm-more" data-a="cm-more">加载更多</button>');
      $('[data-a="cm-more"]', feed).onclick = () => { pageN++; load(); };
    }
    bindPosts(feed, u);
  }

  function postHtml(p, u) {
    const mine = u && u.id === p.user_id;
    return `<div class="cm-post" data-post="${p.id}">
      <div class="cm-post-head">
        <span class="cm-avatar">${p.avatar ? `<img src="${esc(p.avatar)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : '👤'}</span>
        <div><div class="cm-nick">${esc(p.nickname || '书友')}${mine ? ' · <span class="muted" style="font-size:11px">我</span>' : ''}</div>
        <div class="cm-time">${fmtDate(p.created_at, true)}</div></div>
        <span class="cm-cat">${CAT[p.category] || '分享'}</span>
      </div>
      <div class="cm-content clamp" data-role="content">${esc(p.content)}</div>
      ${(p.content || '').length > 200 ? '<button class="cm-expand" data-a="expand">展开</button>' : ''}
      ${p.related_type ? `<button class="cm-related" data-rel="${p.related_type}:${esc(p.related_id || '')}">${relLabel(p)}</button>` : ''}
      <div class="cm-actions">
        <button class="cm-act ${p.liked ? 'on' : ''}" data-a="like" data-id="${p.id}" data-likes="${p.likes || 0}">${icon('heart')}<span data-role="like-n">${p.likes || 0}</span></button>
        <button class="cm-act" data-a="comment" data-id="${p.id}">${icon('message')}<span>评论</span></button>
        <span class="grow"></span>
        <button class="cm-act" data-a="open" data-id="${p.id}">查看详情 ›</button>
      </div>
    </div>`;
  }

  function bindPosts(scope, u) {
    $$('[data-a="expand"]', scope).forEach((b) => b.onclick = () => {
      const c = b.previousElementSibling;
      c.classList.toggle('clamp');
      b.textContent = c.classList.contains('clamp') ? '展开' : '收起';
    });
    $$('[data-rel]', scope).forEach((b) => b.onclick = async () => {
      const [type, id] = b.dataset.rel.split(':');
      if (type === 'book' && id) {
        const it = await db.get('shelf', id);
        if (it) openDetail({ sourceId: it.sourceId, bookUrl: it.bookUrl, seed: { name: it.title, coverUrl: it.coverUrl, author: it.author } });
        else toast('该书籍不在你的书架中');
      } else toast('暂不支持打开该关联');
    });
    $$('[data-a="like"]', scope).forEach((b) => b.onclick = async () => {
      if (!(await needLogin())) return;
      /* v8.5：点一下点赞，再点取消 */
      const liked = b.classList.contains('on');
      const n = Math.max(0, +b.dataset.likes + (liked ? -1 : 1));
      b.dataset.likes = n;
      b.classList.toggle('on', !liked);
      $('[data-role="like-n"]', b).textContent = n;
      sb().from('community_posts').update({ likes: n }).eq('id', b.dataset.id).then(() => {});
    });
    $$('[data-a="comment"]', scope).forEach((b) => b.onclick = () => openPostDetail(b.dataset.id, u));
    $$('[data-a="open"]', scope).forEach((b) => b.onclick = () => openPostDetail(b.dataset.id, u));
  }

  /* ---------- 发帖 ---------- */
  $('[data-a="post"]', page).onclick = () => openPostEditor();

  async function openPostEditor() {
    const u = await needLogin();
    if (!u) return;
    let cat = 'share';
    let related = null;
    const shelf = (await db.all('shelf')).slice(0, 50);
    openOverlay({
      title: '发帖',
      build: (body) => {
        body.classList.add('cm-editor');
        body.innerHTML = `
          <textarea data-role="text" placeholder="分享你的书评、心得，或求推荐…"></textarea>
          <div class="cm-rows">
            <div style="display:flex;gap:8px">
              <button class="cm-chip on" data-cat="share">分享</button>
              <button class="cm-chip" data-cat="help">求助</button>
            </div>
            <button class="cm-pick" data-a="pick">${related ? '已关联：' + esc(related.title) : '关联书架书籍（可选）'}</button>
          </div>
          <div class="cm-rows">
            <button class="btn btn-primary" data-a="pub" style="width:100%">发布</button>
          </div>`;
        $$('.cm-chip', body).forEach((c) => c.onclick = () => {
          cat = c.dataset.cat;
          $$('.cm-chip', body).forEach((x) => x.classList.toggle('on', x === c));
        });
        $('[data-a="pick"]', body).onclick = async () => {
          if (!shelf.length) { toast('书架是空的，先去添加书籍吧'); return; }
          const { actionSheet } = await import('../ui.js');
          const v = await actionSheet('关联书架书籍（可选）', shelf.map((it) => ({ label: it.title, value: it.id })));
          if (!v) return;
          const it = shelf.find((x) => x.id === v);
          related = it;
          $('[data-a="pick"]', body).textContent = '已关联：《' + it.title + '》';
        };
        $('[data-a="pub"]', body).onclick = async () => {
          const content = $('[data-role="text"]', body).value.trim();
          if (!content) return toast('写点什么再发布吧');
          const sess = sb().auth.getSession();
          const uid = (await sess).data.session ? (await sess).data.session.user.id : u.id;
          const { error } = await sb().from('community_posts').insert({
            user_id: uid, nickname: u.nickname || u.email || '书友', avatar: u.avatar || '', category: cat, content,
            related_type: related ? 'book' : null,
            related_id: related ? related.id : null,
            related_title: related ? related.title : null,
          });
          if (error) return toast('发布失败：' + error.message, 'err');
          toast('发布成功', 'ok');
          document.body.querySelector('.overlay') && document.body.querySelector('.overlay').remove();
          load(true);
        };
      },
    });
  }

  /* ---------- 帖子详情 + 实时评论 ---------- */
  async function openPostDetail(postId, u) {
    const { data: post } = await sb().from('community_posts').select('*').eq('id', postId).single();
    if (!post) return toast('帖子不存在', 'err');
    const api = openOverlay({
      title: '帖子详情',
      build: (body, close) => {
        body.className = 'overlay-body cm-detail-body';
        body.innerHTML = `
          <div class="cm-detail-scroll">
            <div class="cm-post" style="box-shadow:none">
              <div class="cm-post-head">
                <span class="cm-avatar">" + (post.avatar ? "<img src=\"" + esc(post.avatar) + "\" style=\"width:100%;height:100%;border-radius:50%;object-fit:cover\">" : "👤") + "</span>
                <div><div class="cm-nick">${esc(post.nickname || '书友')}</div>
                <div class="cm-time">${fmtDate(post.created_at, true)}</div></div>
                <span class="cm-cat">${CAT[post.category] || '分享'}</span>
              </div>
              <div class="cm-content">${esc(post.content)}</div>
              ${post.related_type ? `<button class="cm-related" data-rel="${post.related_type}:${esc(post.related_id || '')}">${relLabel(post)}</button>` : ''}
              <div class="cm-actions">
                <button class="cm-act" data-a="like" data-id="${post.id}" data-likes="${post.likes || 0}">${icon('heart')}<span data-role="like-n">${post.likes || 0}</span></button>
              </div>
            </div>
            <div style="font-weight:700;font-size:14px;margin:8px 2px 4px">评论 ${post.comment_count || 0}</div>
            <div data-role="clist"></div>
          </div>
          <div class="cm-comment-bar">
            <input data-role="cin" placeholder="写下你的评论…" maxlength="500">
            <button class="btn btn-primary btn-sm cm-send" data-a="send">发送</button>
          </div>`;
        const clist = $('[data-role="clist"]', body);
        const loadComments = async () => {
          const { data: rows, error } = await sb().from('community_comments').select('*').eq('post_id', postId).order('created_at', { ascending: true });
          if (error) return;
          clist.innerHTML = (rows || []).map((c) => `
            <div class="cm-comment">
              <span class="cm-avatar" style="width:30px;height:30px;font-size:14px">" + (c.avatar ? "<img src=\"" + esc(c.avatar) + "\" style=\"width:100%;height:100%;border-radius:50%;object-fit:cover\">" : "👤") + "</span>
              <div class="cm-c-body">
                <div class="cm-c-nick">${esc(c.nickname || '书友')}</div>
                <div class="cm-c-text">${esc(c.content)}</div>
                <div class="cm-c-time">${fmtDate(c.created_at, true)}</div>
              </div>
            </div>`).join('') || '<div class="muted" style="padding:18px;text-align:center;font-size:13px">还没有评论，来抢沙发～</div>';
        };
        loadComments();
        /* Realtime：新评论实时追加 */
        let ch = null;
        try {
          ch = sb().channel('cm:' + postId)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'community_comments', filter: 'post_id=eq.' + postId },
              (payload) => {
                const c = payload.new;
                if (!c) return;
                const row = document.createElement('div');
                row.className = 'cm-comment';
                row.innerHTML = `<span class="cm-avatar" style="width:30px;height:30px;font-size:14px">${c.avatar ? `<img src="${esc(c.avatar)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : '👤'}</span><div class="cm-c-body"><div class="cm-c-nick">${esc(c.nickname || '书友')}</div><div class="cm-c-content">${esc(c.content)}</div></div>`;
                clist.appendChild(row);
                const empty = clist.querySelector('.muted');
                empty && empty.remove();
              })
            .subscribe();
        } catch (e) {}
        $('[data-a="send"]', body).onclick = () => sendComment();
        $('[data-role="cin"]', body).addEventListener('keydown', (e) => { if (e.key === 'Enter') sendComment(); });
        async function sendComment() {
          const me = await needLogin();
          if (!me) return;
          const content = $('[data-role="cin"]', body).value.trim();
          if (!content) return;
          const sess = await sb().auth.getSession();
          const uid = sess.data.session ? sess.data.session.user.id : me.id;
          const { error } = await sb().from('community_comments').insert({ post_id: postId, user_id: uid, avatar: me.avatar || '', nickname: me.nickname || me.email || '书友', content });
          if (error) return toast('评论失败：' + error.message, 'err');
          $('[data-role="cin"]', body).value = '';
        }
        /* 详情内的关联跳转 */
        $('[data-rel]', body) && $('[data-rel]', body).onclick && ($('[data-rel]', body).onclick = async () => {
          const [type, id] = $('[data-rel]', body).dataset.rel.split(':');
          if (type === 'book' && id) {
            const it = await db.get('shelf', id);
            if (it) { ov && document.body.querySelectorAll('.overlay').forEach((x) => x.remove()); openDetail({ sourceId: it.sourceId, bookUrl: it.bookUrl, seed: { name: it.title, coverUrl: it.coverUrl, author: it.author } }); }
          }
        });
        $('[data-a="like"]', body).onclick = async () => {
          if (!(await needLogin())) return;
          const b = $('[data-a="like"]', body);
          const liked = b.classList.contains('on');
          const n = Math.max(0, +b.dataset.likes + (liked ? -1 : 1));
          b.dataset.likes = n; b.classList.toggle('on', !liked);
          $('[data-role="like-n"]', b).textContent = n;
          sb().from('community_posts').update({ likes: n }).eq('id', postId).then(() => {});
        };
        /* 关闭时释放 Realtime 频道 */
        const cleanup = () => { try { ch && sb().removeChannel(ch); } catch (e) {} };
        const origClose = api.close;
        close = () => { cleanup(); origClose(); };
        $('.ov-back', api.ov).onclick = close;
      },
    });
  }

  load(true);
}
