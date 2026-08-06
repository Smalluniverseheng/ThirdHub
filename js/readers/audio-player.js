/* ===== ThirdHub js/readers/audio-player.js — 音频播放器（听书/音乐，后台播放/播放列表/倍速/定时） ===== */
import { $, $$, esc, icon, toast, actionSheet, fmtDuration } from '../ui.js';
import { getChapterList, getChapterContent, saveProgress, getProgress, addHistory } from '../engine/content-service.js';

/* 全局唯一播放器（支持后台继续播放） */
let audio = null;
let playerUI = null;
let playlist = [];   // [{name,url,duration,coverUrl}]
let playIdx = 0;
let sleepTimer = null;
let currentCtx = null;

export function getGlobalAudio() { return audio; }

function ensureAudio() {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener('ended', () => next());
    audio.addEventListener('timeupdate', updateMiniProgress);
  }
  return audio;
}

function updateMediaSession(meta) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title || '',
      artist: meta.artist || 'ThirdHub',
      album: meta.album || '',
      artwork: meta.cover ? [{ src: meta.cover, sizes: '512x512' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => next());
  } catch (e) {}
}

export async function openAudioPlayer({ source, item, startChapter = 0 }) {
  const a = ensureAudio();
  currentCtx = { source, item };
  let chapters = [];

  const ov = document.createElement('div');
  ov.className = 'overlay ap-overlay';
  ov.innerHTML = `
    <div class="ap-top">
      <button class="icon-btn" data-a="back">${icon('back')}</button>
      <div class="overlay-title ellipsis">${esc(item.title || item.name)}</div>
      <button class="icon-btn" data-a="timer" title="定时关闭">${icon('timer')}</button>
    </div>
    <div class="ap-main">
      <div class="ap-cover"><img data-role="cover" src="${esc(item.coverUrl || '')}" onerror="this.style.display='none'">${!item.coverUrl ? icon(item.type === 'music' ? 'music' : 'headphone') : ''}</div>
      <div class="ap-track ellipsis" data-role="track">—</div>
      <div class="ap-progress-row">
        <span class="vp-time" data-t="cur">00:00</span>
        <input type="range" class="vp-seek" min="0" max="1000" value="0">
        <span class="vp-time" data-t="dur">00:00</span>
      </div>
      <div class="ap-controls">
        <button class="vp-btn" data-a="mode" title="播放模式">${icon('repeat')}</button>
        <button class="vp-btn" data-a="prev">${icon('prev')}</button>
        <button class="vp-btn ap-play" data-a="play">${icon('play')}</button>
        <button class="vp-btn" data-a="next">${icon('next')}</button>
        <button class="vp-btn" data-a="speed" title="倍速">1.0x</button>
      </div>
    </div>
    <div class="ap-list"></div>`;
  document.getElementById('overlay-root').appendChild(ov);
  playerUI = ov;

  let playMode = 'list'; // list | single | random

  async function loadTrack(i, autoPlay = true) {
    if (i < 0 || i >= playlist.length) return;
    playIdx = i;
    const t = playlist[i];
    $('[data-role="track"]', ov).textContent = t.name || `第 ${i + 1} 集`;
    if (t.cover) $('[data-role="cover"]', ov).src = t.cover;
    a.src = t.url;
    if (autoPlay) a.play().catch(() => {});
    updateMediaSession({ title: t.name, artist: item.title || item.name, cover: t.cover || item.coverUrl });
    updatePlayBtn();
    renderList();
    saveProgress(item.id || (source.id + ':' + item.bookUrl), { chapterIndex: i });
  }

  function next() {
    if (playMode === 'single') { a.currentTime = 0; a.play(); return; }
    if (playMode === 'random') return loadTrack(Math.floor(Math.random() * playlist.length));
    if (playIdx < playlist.length - 1) loadTrack(playIdx + 1);
    else toast('列表播放完毕');
  }
  function prev() { if (playIdx > 0) loadTrack(playIdx - 1); }

  function updatePlayBtn() {
    const btn = $('[data-a="play"]', ov);
    if (btn) btn.innerHTML = a.paused ? icon('play') : icon('pause');
  }

  function updateMiniProgress() {
    if (!playerUI || !a.duration) return;
    const seek = $('.vp-seek', playerUI);
    if (seek && !seek._dragging) seek.value = Math.floor((a.currentTime / a.duration) * 1000);
    const cur = $('[data-t="cur"]', playerUI);
    const dur = $('[data-t="dur"]', playerUI);
    if (cur) cur.textContent = fmtDuration(a.currentTime);
    if (dur) dur.textContent = fmtDuration(a.duration);
  }

  function renderList() {
    const box = $('.ap-list', ov);
    box.innerHTML = `<div class="vp-ep-head">播放列表（${playlist.length}）</div>` +
      playlist.map((t, i) => `
        <button class="ap-item ${i === playIdx ? 'on' : ''}" data-i="${i}">
          <span class="ap-item-idx">${i === playIdx && !a.paused ? '▶' : i + 1}</span>
          <span class="ellipsis grow">${esc(t.name || '第 ' + (i + 1) + ' 集')}</span>
          ${t.duration ? `<span class="muted">${esc(t.duration)}</span>` : ''}
        </button>`).join('');
    $$('.ap-item', box).forEach((b) => b.onclick = () => loadTrack(+b.dataset.i));
  }

  $('.vp-seek', ov).oninput = (e) => { if (a.duration) a.currentTime = (e.target.value / 1000) * a.duration; };
  $('[data-a="back"]', ov).onclick = () => { playerUI = null; ov.remove(); /* 音频继续后台播放 */ };
  $('[data-a="play"]', ov).onclick = () => { a.paused ? a.play() : a.pause(); updatePlayBtn(); };
  $('[data-a="prev"]', ov).onclick = prev;
  $('[data-a="next"]', ov).onclick = () => next();
  a.addEventListener('play', updatePlayBtn);
  a.addEventListener('pause', updatePlayBtn);
  $('[data-a="speed"]', ov).onclick = async (e) => {
    const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    const v = await actionSheet('播放速度', speeds.map((s) => ({ label: s + 'x', value: s, icon: a.playbackRate === s ? 'check' : undefined })));
    if (v) { a.playbackRate = v; e.target.textContent = v + 'x'; }
  };
  $('[data-a="mode"]', ov).onclick = async (e) => {
    const modes = [{ id: 'list', name: '列表循环', icon: 'repeat' }, { id: 'single', name: '单曲循环', icon: 'repeat' }, { id: 'random', name: '随机播放', icon: 'shuffle' }];
    const v = await actionSheet('播放模式', modes.map((m) => ({ label: m.name, value: m.id, icon: playMode === m.id ? 'check' : undefined })));
    if (v) { playMode = v; e.target.innerHTML = icon(v === 'random' ? 'shuffle' : 'repeat'); toast(modes.find((m) => m.id === v).name); }
  };
  $('[data-a="timer"]', ov).onclick = async () => {
    const v = await actionSheet('定时关闭', [
      { label: '30 分钟后', value: 30 }, { label: '60 分钟后', value: 60 },
      { label: '播完当前', value: 'chapter' }, { label: '取消定时', value: 0 },
    ]);
    if (v === null) return;
    clearTimeout(sleepTimer);
    if (v === 0) return toast('已取消定时');
    if (v === 'chapter') {
      const stopAtEnd = () => { a.pause(); a.removeEventListener('ended', stopAtEnd); };
      a.addEventListener('ended', stopAtEnd);
      toast('将在当前内容播完后停止');
    } else {
      sleepTimer = setTimeout(() => { a.pause(); toast('定时停止播放'); }, v * 60 * 1000);
      toast(v + ' 分钟后停止播放');
    }
  };

  // 加载章节
  try {
    chapters = await getChapterList(source, item.bookUrl);
    playlist = [];
    // 逐章解析 URL（惰性：先取第一章，其余点击时解析）
    const resolveTrack = async (c) => {
      const raw = await getChapterContent(source, c.url);
      try {
        const j = JSON.parse(raw);
        return { name: j.title || c.name, url: j.url || (j.urls && j.urls[0] && j.urls[0].url), duration: j.duration || c.duration, cover: j.coverUrl };
      } catch (e) {
        return { name: c.name, url: raw.trim(), duration: c.duration };
      }
    };
    const first = await resolveTrack(chapters[startChapter] || chapters[0]);
    playlist = chapters.map((c, i) => (i === startChapter ? first : { name: c.name, url: null, _c: c, duration: c.duration }));
    renderList();
    await loadTrack(startChapter);
    addHistory({ ...item, sourceId: source.id });
  } catch (e) {
    toast('加载失败：' + e.message, 'err');
  }

  // 点击未解析的集数时惰性解析
  ov.addEventListener('click', async (e) => {
    const b = e.target.closest('.ap-item');
    if (!b) return;
    const i = +b.dataset.i;
    if (playlist[i] && !playlist[i].url && playlist[i]._c) {
      toast('解析播放地址…');
      try {
        const raw = await getChapterContent(source, playlist[i]._c.url);
        let j;
        try { j = JSON.parse(raw); } catch (err) { j = { url: raw.trim() }; }
        playlist[i] = { name: playlist[i].name, url: j.url || (j.urls && j.urls[0] && j.urls[0].url), duration: j.duration, cover: j.coverUrl };
        loadTrack(i);
      } catch (err) { toast('解析失败', 'err'); }
    }
  });
}
