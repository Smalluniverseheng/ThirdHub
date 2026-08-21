/* ===== ThirdHub js/modules/detail.js — 内容详情页（统一入口） ===== */
import { $, $$, esc, icon, toast, openOverlay, confirmDialog } from '../ui.js';
import { getSource } from '../engine/source-service.js';
import { getBookInfo, getChapterList, addToShelf, inShelf, removeFromShelf, toggleFavorite, addHistory, getProgress, canComment, getComments } from '../engine/content-service.js';
import { openNovelReader } from '../readers/novel-reader.js';
import { openComicReader } from '../readers/comic-reader.js';
import { openVideoPlayer } from '../readers/video-player.js';
import { openAudioPlayer } from '../readers/audio-player.js';

/* v4.0：评论富文本白名单过滤（官方支持 a/b/i/u/s/br/span/img，防注入） */
function safeRich(html) {
  const ALLOW = { B: 1, I: 1, U: 1, S: 1, BR: 1, SPAN: 1, A: 1, IMG: 1 };
  try {
    const doc = new DOMParser().parseFromString('<div>' + String(html || '') + '</div>', 'text/html');
    const walk = (node) => {
      [...node.children].forEach((ch) => {
        if (!ALLOW[ch.tagName]) { ch.replaceWith(document.createTextNode(ch.textContent || '')); return; }
        [...ch.attributes].forEach((a) => {
          const n = a.name.toLowerCase();
          const ok = (ch.tagName === 'A' && n === 'href' && /^https?:/i.test(a.value))
            || (ch.tagName === 'IMG' && n === 'src' && /^https?:/i.test(a.value))
            || (ch.tagName === 'SPAN' && n === 'style');
          if (!ok) ch.removeAttribute(a.name);
        });
        if (ch.tagName === 'A') { ch.setAttribute('target', '_blank'); ch.setAttribute('rel', 'noopener'); }
        walk(ch);
      });
    };
    walk(doc.body);
    return doc.body.firstElementChild ? doc.body.firstElementChild.innerHTML : '';
  } catch (e) { return esc(html); }
}

const OPENERS = {
  novel: openNovelReader,
  comic: openComicReader,
  video: openVideoPlayer,
  audio: openAudioPlayer,
  music: openAudioPlayer,
};

export async function openDetail({ sourceId, bookUrl, seed = {} }) {
  const source = await getSource(sourceId);
  if (!source) return toast('连接器已被删除', 'err');

  const ctl = openOverlay({
    title: seed.name || seed.title || '详情',
    build: async (body) => {
      body.innerHTML = '<div class="loading-row"><div class="spinner"></div>加载详情…</div>';
      let info;
      try {
        info = await getBookInfo(source, bookUrl);
      } catch (e) {
        info = { name: seed.name, intro: '' };
      }
      info = { ...seed, ...info };
      /* v4.0：图源扩展信息（分组标签/评分/点赞/评论数/推荐） */
      let extra = null;
      if (info.extra) { try { extra = JSON.parse(info.extra); } catch (e) {} }
      const itemId = sourceId + ':' + bookUrl;
      const shelved = await inShelf(sourceId, bookUrl);
      const item = {
        id: itemId, sourceId, type: source.type,
        title: info.name || seed.name, author: info.author || seed.author || '',
        coverUrl: info.coverUrl || seed.coverUrl || '', bookUrl, sourceName: source.name,
      };
      addHistory(item);

      body.innerHTML = `
        <div class="detail-hero">
          <div class="detail-cover">${item.coverUrl ? `<img src="${esc(item.coverUrl)}" onerror="this.remove()">` : icon('book')}</div>
          <div class="detail-meta">
            <div class="detail-title">${esc(item.title)}</div>
            ${item.author ? `<div class="muted">${esc(item.author)}</div>` : ''}
            <div class="row gap4 mt8"><span class="tag tag-blue">${esc(source.name)}</span><span class="tag tag-gray">${({ novel: '小说', comic: '漫画', video: '影视', audio: '听书', music: '音乐' })[source.type] || source.type}</span></div>
            ${extra && extra.stars ? `<div class="row gap4 mt8" style="color:var(--accent);font-size:13px;font-weight:700">★ ${Number(extra.stars).toFixed(1)}${extra.likes ? `<span class="muted" style="font-weight:400">· ${extra.likes} 赞</span>` : ''}${extra.comments ? `<span class="muted" style="font-weight:400">· ${extra.comments} 评论</span>` : ''}</div>` : ''}
            ${extra && extra.uploader ? `<div class="muted mt8">上传者：${esc(extra.uploader)}</div>` : ''}
            ${info.lastUpdate ? `<div class="muted mt8">更新：${esc(info.lastUpdate)}</div>` : ''}
          </div>
        </div>
        ${extra && extra.tagsMap ? `<div class="detail-tags">${Object.entries(extra.tagsMap).map(([ns, arr]) => `<div class="row gap4" style="flex-wrap:wrap;margin-bottom:6px"><span class="muted" style="flex-shrink:0">${esc(ns)}</span>${(arr || []).map((t) => `<span class="tag tag-purple">${esc(t)}</span>`).join('')}</div>`).join('')}</div>` : ''}
        ${info.intro ? `<div class="detail-intro clamp2" data-a="intro">${esc(info.intro)}</div>` : ''}
        <div class="detail-actions">
          <button class="btn btn-primary grow" data-a="read">${icon('play')} 开始${source.type === 'video' ? '播放' : source.type === 'comic' ? '观看' : source.type === 'novel' ? '阅读' : '收听'}</button>
          <button class="btn" data-a="shelf">${icon('books')} ${shelved ? '移出书架' : '加入书架'}</button>
          <button class="btn" data-a="fav">${icon('heart')}</button>
        </div>
        <div class="hr"></div>
        <div class="row" style="justify-content:space-between;padding:0 2px 8px">
          <div style="font-weight:700">目录 <span class="muted" data-v="count"></span></div>
          <button class="btn btn-sm" data-a="reverse">倒序</button>
        </div>
        <div class="detail-chapters"><div class="loading-row"><div class="spinner"></div></div></div>`;

      const introEl = $('[data-a="intro"]', body);
      if (introEl) introEl.onclick = () => introEl.classList.toggle('clamp2');
      $('[data-a="shelf"]', body).onclick = async (e) => {
        const inS = await inShelf(sourceId, bookUrl);
        if (inS) { await removeFromShelf(itemId); e.target.innerHTML = icon('books') + ' 加入书架'; toast('已移出书架'); }
        else { await addToShelf(item); e.target.innerHTML = icon('books') + ' 移出书架'; toast('已加入书架', 'ok'); }
      };
      $('[data-a="fav"]', body).onclick = async () => {
        const on = await toggleFavorite(item);
        toast(on ? '已收藏' : '已取消收藏');
      };
      $('[data-a="read"]', body).onclick = async () => {
        const prog = await getProgress(itemId);
        OPENERS[source.type]({ source, item, startChapter: prog ? prog.chapterIndex || 0 : 0 });
      };

      // 目录
      let chapters = [];
      let reversed = false;
      async function renderChapters() {
        const box = $('.detail-chapters', body);
        const list = reversed ? [...chapters].reverse() : chapters;
        $('[data-v="count"]', body).textContent = `（${chapters.length}）`;
        box.innerHTML = list.map((c) => `<button class="detail-ch ellipsis" data-i="${c.index}">${esc(c.name || '第 ' + (c.index + 1) + ' 集')}</button>`).join('');
        $$('.detail-ch', box).forEach((b) => b.onclick = () => OPENERS[source.type]({ source, item, startChapter: +b.dataset.i }));
      }
      try {
        chapters = await getChapterList(source, bookUrl);
        renderChapters();
      } catch (e) {
        $('.detail-chapters', body).innerHTML = `<div class="muted" style="padding:16px;text-align:center">目录加载失败：${esc(e.message)}</div>`;
      }
      $('[data-a="reverse"]', body).onclick = () => { reversed = !reversed; renderChapters(); };

      /* ---------- v4.0：推荐漫画 ---------- */
      if (extra && Array.isArray(extra.recommend) && extra.recommend.length) {
        const rec = document.createElement('div');
        rec.innerHTML = `
          <div class="hr"></div>
          <div style="font-weight:700;padding:0 2px 8px">相关推荐</div>
          <div class="detail-recs">${extra.recommend.map((r, i) => `
            <button class="detail-rec" data-i="${i}">
              <div class="detail-rec-cover">${r.coverUrl ? `<img src="${esc(r.coverUrl)}" loading="lazy" onerror="this.remove()">` : ''}</div>
              <div class="ellipsis" style="font-size:12px">${esc(r.name || '')}</div>
            </button>`).join('')}</div>`;
        body.appendChild(rec);
        $$('.detail-rec', rec).forEach((b) => b.onclick = () => {
          const r = extra.recommend[+b.dataset.i];
          openDetail({ sourceId, bookUrl: r.bookUrl, seed: r });
        });
      }

      /* ---------- v4.0：评论（图源支持时显示） ---------- */
      if (source.type === 'comic' && await canComment(source)) {
        const box = document.createElement('div');
        box.innerHTML = `
          <div class="hr"></div>
          <div style="font-weight:700;padding:0 2px 8px">评论 <span class="muted" data-v="ccount"></span></div>
          <div data-role="clist"><div class="loading-row"><div class="spinner"></div></div></div>
          <button class="btn btn-block btn-sm hidden" data-a="more-c">加载更多评论</button>`;
        body.appendChild(box);
        const clist = $('[data-role="clist]', box) || $('[data-role="clist"]', box);
        const moreBtn = $('[data-a="more-c"]', box);
        let cpage = 1, cmax = 0, total = 0;
        async function loadCs() {
          try {
            const r = await getComments(source, bookUrl, cpage);
            cmax = r.maxPage || 0;
            total += (r.comments || []).length;
            $('[data-v="ccount"]', box).textContent = cmax ? `（第 ${cpage}/${cmax} 页）` : `（${total}）`;
            const html = (r.comments || []).map((c) => `
              <div class="cmt">
                <div class="cmt-head">
                  ${c.avatar ? `<img class="cmt-avatar" src="${esc(c.avatar)}" loading="lazy" onerror="this.remove()">` : ''}
                  <span style="font-weight:600;font-size:13px">${esc(c.userName || '匿名')}</span>
                  ${c.time ? `<span class="muted">${esc(c.time)}</span>` : ''}
                </div>
                <div class="cmt-body">${safeRich(c.content)}</div>
                ${c.replyCount ? `<div class="muted" style="font-size:11px;margin-top:4px">${c.replyCount} 条回复</div>` : ''}
              </div>`).join('');
            if (cpage === 1) clist.innerHTML = html || '<div class="muted" style="padding:12px;text-align:center">还没有评论</div>';
            else clist.insertAdjacentHTML('beforeend', html);
            moreBtn.classList.toggle('hidden', !(cmax && cpage < cmax));
          } catch (e) {
            if (cpage === 1) clist.innerHTML = `<div class="muted" style="padding:12px;text-align:center">评论加载失败：${esc(e.message)}</div>`;
            moreBtn.classList.add('hidden');
          }
        }
        moreBtn.onclick = () => { cpage++; loadCs(); };
        loadCs();
      }
    },
  });
  return ctl;
}
