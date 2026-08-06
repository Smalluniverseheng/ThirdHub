/* ===== ThirdHub js/modules/detail.js — 内容详情页（统一入口） ===== */
import { $, $$, esc, icon, toast, openOverlay, confirmDialog } from '../ui.js';
import { getSource } from '../engine/source-service.js';
import { getBookInfo, getChapterList, addToShelf, inShelf, removeFromShelf, toggleFavorite, addHistory, getProgress } from '../engine/content-service.js';
import { openNovelReader } from '../readers/novel-reader.js';
import { openComicReader } from '../readers/comic-reader.js';
import { openVideoPlayer } from '../readers/video-player.js';
import { openAudioPlayer } from '../readers/audio-player.js';

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
            ${info.lastUpdate ? `<div class="muted mt8">更新：${esc(info.lastUpdate)}</div>` : ''}
          </div>
        </div>
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
    },
  });
  return ctl;
}
