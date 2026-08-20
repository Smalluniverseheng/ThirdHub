/* ===== ThirdHub js/readers/video-player.js — 视频播放器（v4.2 全量重写） =====
   学习 TVBoxOS / TVBoxOSC 播放器设计：
   自定义进度条（已播/缓冲双条 + 拖动预览气泡）· 倍速（点击循环 / 长按选择 / 长按画面 3x）
   画面比例（默认/16:9/4:3/填充/原始/裁剪）· 片头片尾标记与自动跳过
   手势（单击呼出、双击暂停/±15s、横滑进度预览、左亮度右音量、长按 3x 速播）
   锁屏防误触 · 画中画 · 缓冲转圈 · 失败重试 · 系统时间 / 分辨率 · 键盘快捷键（桌面端） */
import { $, $$, esc, icon, toast, actionSheet, fmtDuration, loadCss } from '../ui.js';
import { getChapterList, getChapterContent, saveProgress, getProgress } from '../engine/content-service.js';
import { kvGet, kvSet, getSetting, setSetting } from '../store.js';
import { canPiP } from '../device.js';

let hlsLoader = null;
async function loadHls() {
  if (window.Hls) return window.Hls;
  if (!hlsLoader) {
    hlsLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
      s.onload = () => resolve(window.Hls);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return hlsLoader;
}

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];
/* TVBox 画面比例 0-5：默认/16:9/4:3/填充/原始/裁剪 */
const SCALES = [
  { id: 'default', name: '默认', css: 'contain', ar: '' },
  { id: '16:9', name: '16:9', css: 'contain', ar: '16 / 9' },
  { id: '4:3', name: '4:3', css: 'contain', ar: '4 / 3' },
  { id: 'fill', name: '填充', css: 'fill', ar: '' },
  { id: 'original', name: '原始', css: 'none', ar: '' },
  { id: 'crop', name: '裁剪', css: 'cover', ar: '' },
];

export async function openVideoPlayer({ source, item, startChapter = 0 }) {
  await loadCss('css/player.css');
  let chapters = [];
  let idx = startChapter;
  let hls = null;
  let lines = [];
  let lineIdx = 0;
  let locked = false;
  let uiTimer = null;
  let destroyed = false;
  const bookId = item.id || (source.id + ':' + item.bookUrl);

  /* 播放偏好：倍速与画面比例全局记忆（TVBox 同款 mPlayerConfig sp/sc） */
  let speed = (await getSetting('videoSpeed')) || 1.0;
  let scaleIdx = (await getSetting('videoScale')) || 0;
  if (scaleIdx < 0 || scaleIdx >= SCALES.length) scaleIdx = 0;
  /* 片头片尾：按“剧”记忆 { st: 片头秒数, et: 片尾秒数 } */
  let skip = (await kvGet('vskip:' + bookId, null)) || { st: 0, et: 0 };

  const ov = document.createElement('div');
  ov.className = 'overlay vp-overlay';
  ov.innerHTML = `
    <div class="vp-stage">
      <video class="vp-video" playsinline webkit-playsinline></video>
      <div class="vp-buffer" hidden><div class="spinner"></div><span>加载中…</span></div>
      <div class="vp-center-state" hidden>${icon('play')}</div>
      <div class="vp-gesture" hidden>
        <div class="vp-gesture-ico" data-g="ico"></div>
        <div class="vp-gesture-text" data-g="text"></div>
      </div>
      <button class="vp-skip-outro" hidden data-a="skipoutro">跳过片尾</button>
      <div class="vp-speed3" hidden>3x 快进中 ▶▶</div>
      <div class="vp-top cr-ui">
        <button class="icon-btn" data-a="back">${icon('back')}</button>
        <div class="vp-title-box">
          <div class="overlay-title ellipsis" style="color:#fff">${esc(item.title || item.name)}</div>
          <div class="vp-subtitle ellipsis" data-v="epname"></div>
        </div>
        <span class="vp-meta" data-v="clock"></span>
        <span class="vp-meta" data-v="res"></span>
        ${canPiP() ? `<button class="icon-btn" data-a="pip" title="画中画">${icon('gridNine')}</button>` : ''}
      </div>
      <div class="vp-controls cr-ui">
        <div class="vp-bar-row">
          <span class="vp-time" data-t="cur">00:00</span>
          <div class="vp-bar" data-v="bar">
            <div class="vp-bar-buffered" data-v="buffered"></div>
            <div class="vp-bar-played" data-v="played"></div>
            <div class="vp-bar-knob" data-v="knob"></div>
          </div>
          <span class="vp-time" data-t="dur">00:00</span>
        </div>
        <div class="vp-btn-row">
          <button class="vp-btn" data-a="prev" title="上一集">${icon('prev')}</button>
          <button class="vp-btn vp-play" data-a="play">${icon('play')}</button>
          <button class="vp-btn" data-a="next" title="下一集">${icon('next')}</button>
          <button class="vp-tbtn" data-a="speed">倍速</button>
          <button class="vp-tbtn" data-a="scale">比例</button>
          <button class="vp-tbtn" data-a="lines">线路</button>
          <button class="vp-tbtn" data-a="skip">跳过</button>
          <button class="vp-tbtn" data-a="episodes">选集</button>
          <button class="vp-btn" data-a="lock" title="锁屏">${icon('lock')}</button>
          <button class="vp-btn" data-a="fs" title="全屏">${icon('fullscreen')}</button>
        </div>
      </div>
      <button class="vp-lock-fab" hidden data-a="unlock">${icon('lock')}</button>
    </div>
    <div class="vp-episodes hidden"></div>`;
  document.getElementById('overlay-root').appendChild(ov);

  const stage = $('.vp-stage', ov);
  const video = $('.vp-video', ov);
  const bar = $('[data-v="bar"]', ov);
  const played = $('[data-v="played"]', ov);
  const buffered = $('[data-v="buffered"]', ov);
  const knob = $('[data-v="knob"]', ov);

  /* ---------- 时钟 / 分辨率 ---------- */
  function tickClock() {
    const d = new Date();
    $('[data-v="clock"]', ov).textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  tickClock();
  const clockTimer = setInterval(tickClock, 20000);

  /* ---------- UI 自动隐藏（TVBox myHandle 4 秒） ---------- */
  function showUI() {
    if (locked) return;
    ov.classList.remove('ui-hidden');
    if (uiTimer) clearTimeout(uiTimer);
    uiTimer = setTimeout(() => { if (!video.paused) ov.classList.add('ui-hidden'); }, 4000);
  }
  showUI();

  /* ---------- 画面比例 ---------- */
  function applyScale() {
    const sc = SCALES[scaleIdx];
    video.style.objectFit = sc.css === 'none' ? 'contain' : sc.css;
    video.style.width = sc.css === 'none' ? 'auto' : '100%';
    video.style.height = sc.css === 'none' ? 'auto' : '100%';
    video.style.maxWidth = sc.css === 'none' ? 'none' : '100%';
    video.style.maxHeight = sc.css === 'none' ? '100%' : '100%';
    stage.style.aspectRatio = '';
    video.style.aspectRatio = sc.ar;
    $('[data-a="scale"]', ov).textContent = sc.name === '默认' ? '比例' : sc.name;
  }
  async function cycleScale(step) {
    scaleIdx = ((scaleIdx + step) % SCALES.length + SCALES.length) % SCALES.length;
    applyScale();
    await setSetting('videoScale', scaleIdx);
    toast('画面：' + SCALES[scaleIdx].name);
  }

  /* ---------- 倍速（点击循环，长按弹出列表） ---------- */
  function applySpeed(v, silent) {
    speed = v;
    video.playbackRate = v;
    setSetting('videoSpeed', v).catch(() => {});
    $('[data-a="speed"]', ov).textContent = v === 1 ? '倍速' : v + 'x';
    if (!silent) toast('倍速 ' + v + 'x');
  }
  async function cycleSpeed() {
    const i = SPEEDS.indexOf(speed);
    applySpeed(SPEEDS[(i + 1) % SPEEDS.length], true);
    toast('倍速 ' + speed + 'x');
  }
  async function pickSpeed() {
    const v = await actionSheet('播放速度', SPEEDS.map((s) => ({ label: s + 'x', value: s, icon: speed === s ? 'check' : undefined })));
    if (v) applySpeed(v, true);
  }
  /* 长按画面 3x 速播（takagen99 同款） */
  let speedBackup = 1;
  function speed3Start() {
    speedBackup = speed;
    video.playbackRate = 3.0;
    $('.vp-speed3', ov).hidden = false;
  }
  function speed3End() {
    video.playbackRate = speedBackup;
    $('.vp-speed3', ov).hidden = true;
  }

  /* ---------- HLS / 播放 ---------- */
  function destroyHls() { if (hls) { hls.destroy(); hls = null; } }

  async function playUrl(url, resumeSec = 0) {
    destroyHls();
    hideError();
    $('.vp-buffer', ov).hidden = false;
    if (/\.m3u8($|\?)/i.test(url)) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
      } else {
        const Hls = await loadHls();
        if (Hls.isSupported()) {
          hls = new Hls({ maxBufferLength: 30 });
          hls.on(Hls.Events.ERROR, (e, data) => {
            if (data && data.fatal) {
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
              else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
              else showError('播放出错（hls），请重试或切换线路');
            }
          });
          hls.loadSource(url);
          hls.attachMedia(video);
        } else { showError('当前浏览器不支持 m3u8 播放'); return; }
      }
    } else {
      video.src = url;
    }
    if (resumeSec > 5) {
      video.addEventListener('loadedmetadata', () => { video.currentTime = resumeSec; }, { once: true });
    } else if (skip.st > 0) {
      video.addEventListener('loadedmetadata', () => { video.currentTime = skip.st; }, { once: true });
    }
    video.playbackRate = speed;
    video.play().catch(() => {});
    updatePlayBtn();
  }

  function showError(msg) {
    $('.vp-buffer', ov).hidden = true;
    const e0 = $('.vp-error', ov);
    if (e0) e0.remove();
    const box = document.createElement('div');
    box.className = 'vp-error';
    box.innerHTML = `<div class="vp-error-msg">${esc(msg)}</div>
      <div class="row gap8" style="justify-content:center">
        <button class="btn btn-primary" data-e="retry">${icon('refresh')} 重试</button>
        ${lines.length > 1 ? `<button class="btn" data-e="nextline">换线路</button>` : ''}
      </div>`;
    stage.appendChild(box);
    $('[data-e="retry"]', box).onclick = () => playUrl(lines[lineIdx].url, video.currentTime || 0);
    const nl = $('[data-e="nextline"]', box);
    if (nl) nl.onclick = () => { lineIdx = (lineIdx + 1) % lines.length; toast('切换到：' + (lines[lineIdx].name || '线路' + (lineIdx + 1))); playUrl(lines[lineIdx].url, 0); };
  }
  function hideError() { const e0 = $('.vp-error', ov); if (e0) e0.remove(); }

  /* ---------- 剧集加载 ---------- */
  async function loadEpisode(i) {
    if (i < 0 || i >= chapters.length || destroyed) return;
    idx = i;
    $('.vp-buffer', ov).hidden = false;
    try {
      const raw = await getChapterContent(source, chapters[idx].url);
      if (destroyed) return;
      let data;
      try { data = JSON.parse(raw); } catch (e) { data = { title: '', urls: [{ name: '默认', url: raw }] }; }
      if (typeof data === 'string') data = { title: '', urls: [{ name: '默认', url: data }] };
      lines = data.urls || [{ name: '默认', url: chapters[idx].url }];
      lineIdx = 0;
      $('[data-v="epname"]', ov).textContent = chapters[idx].name || `第 ${idx + 1} 集`;
      const prog = await getProgress(bookId);
      const resume = prog && prog.chapterIndex === idx && prog.position ? prog.position : 0;
      await playUrl(lines[lineIdx].url, resume);
      saveProgress(bookId, { chapterIndex: idx });
      renderEpisodes();
    } catch (e) {
      if (!destroyed) showError('加载失败：' + e.message);
    }
  }

  function renderEpisodes() {
    const box = $('.vp-episodes', ov);
    box.innerHTML = `<div class="vp-ep-head">选集（${chapters.length}）</div>` +
      `<div class="vp-ep-grid">` + chapters.map((c, i) =>
        `<button class="vp-ep ${i === idx ? 'on' : ''}" data-i="${i}">${esc(c.name || '第' + (i + 1) + '集')}</button>`).join('') + '</div>';
    $$('.vp-ep', box).forEach((b) => b.onclick = () => { box.classList.add('hidden'); loadEpisode(+b.dataset.i); });
    const cur = $('.vp-ep.on', box);
    cur && cur.scrollIntoView({ block: 'center' });
  }

  function updatePlayBtn() {
    $('[data-a="play"]', ov).innerHTML = video.paused ? icon('play') : icon('pause');
    $('.vp-center-state', ov).hidden = !video.paused || !video.src;
    if (!video.paused) showUI();
  }

  /* ---------- 进度条（已播 + 缓冲 + 拖动预览） ---------- */
  function fmtT(sec) { return fmtDuration(Math.max(0, Math.floor(sec || 0))); }
  function syncBar() {
    const d = video.duration || 0;
    if (d > 0) {
      const pc = (video.currentTime / d) * 100;
      played.style.width = pc + '%';
      knob.style.left = pc + '%';
      try {
        const b = video.buffered;
        if (b.length) buffered.style.width = Math.min(100, (b.end(b.length - 1) / d) * 100) + '%';
      } catch (e) {}
      $('[data-t="cur"]', ov).textContent = fmtT(video.currentTime);
      $('[data-t="dur"]', ov).textContent = fmtT(d);
      /* 片尾自动跳过：剩余 ≤ et 秒直接下一集 */
      if (skip.et > 0 && d - video.currentTime <= skip.et && idx < chapters.length - 1 && !video.paused) {
        toast('已跳过片尾');
        loadEpisode(idx + 1);
      }
      /* 片尾提示按钮 */
      $('.vp-skip-outro', ov).hidden = !(skip.et > 0 && d - video.currentTime <= skip.et + 30 && idx < chapters.length - 1);
    }
  }
  const timer = setInterval(() => {
    if (destroyed) return;
    syncBar();
    if (!video.paused && video.duration) {
      saveProgress(bookId, { chapterIndex: idx, position: Math.floor(video.currentTime) });
    }
  }, 1000);

  let barDragging = false;
  function barSeek(clientX, preview) {
    const r = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const t = ratio * (video.duration || 0);
    played.style.width = ratio * 100 + '%';
    knob.style.left = ratio * 100 + '%';
    if (preview) showGesture('', fmtT(t) + ' / ' + fmtT(video.duration));
    else if (video.duration) video.currentTime = t;
  }
  bar.addEventListener('pointerdown', (e) => {
    barDragging = true;
    bar.setPointerCapture(e.pointerId);
    barSeek(e.clientX, true);
  });
  bar.addEventListener('pointermove', (e) => { if (barDragging) barSeek(e.clientX, true); });
  bar.addEventListener('pointerup', (e) => {
    if (!barDragging) return;
    barDragging = false;
    barSeek(e.clientX, false);
    hideGesture();
  });

  /* ---------- 手势指示 ---------- */
  let gestureTimer = null;
  function showGesture(ico, text) {
    const g = $('.vp-gesture', ov);
    g.hidden = false;
    $('[data-g="ico"]', g).innerHTML = ico;
    $('[data-g="text"]', g).textContent = text;
    if (gestureTimer) clearTimeout(gestureTimer);
  }
  function hideGesture(delay = 600) {
    if (gestureTimer) clearTimeout(gestureTimer);
    gestureTimer = setTimeout(() => { $('.vp-gesture', ov).hidden = true; }, delay);
  }

  /* ---------- 画面手势：单击 / 双击 / 横滑进度 / 左亮度右音量 / 长按 3x ---------- */
  let gStart = null, gMode = null, gTimer = null, gTapTimer = null, gLastTap = 0, gLongFired = false;
  let brightness = 1;
  video.addEventListener('pointerdown', (e) => {
    if (locked) { showUI(); return; }
    gStart = { x: e.clientX, y: e.clientY, t: video.currentTime, time: Date.now() };
    gMode = null;
    gLongFired = false;
    if (gTimer) clearTimeout(gTimer);
    gTimer = setTimeout(() => {
      if (gStart && !gMode && !video.paused) { gLongFired = true; speed3Start(); }
    }, 480);
  });
  video.addEventListener('pointermove', (e) => {
    if (!gStart || gLongFired) return;
    const dx = e.clientX - gStart.x;
    const dy = e.clientY - gStart.y;
    if (!gMode && Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    if (gTimer) { clearTimeout(gTimer); gTimer = null; }
    if (!gMode) gMode = Math.abs(dx) > Math.abs(dy) ? 'seek' : (gStart.x < stage.clientWidth / 2 ? 'bright' : 'vol');
    if (gMode === 'seek' && video.duration) {
      const nt = Math.max(0, Math.min(video.duration, gStart.t + dx * (video.duration > 900 ? 0.5 : 0.2)));
      video._pendingSeek = nt;
      showGesture(dx > 0 ? icon('next') : icon('prev'), fmtT(nt) + ' / ' + fmtT(video.duration));
      gestureTimer && clearTimeout(gestureTimer);
    } else if (gMode === 'bright') {
      brightness = Math.max(0.2, Math.min(1, brightness - dy / 300));
      stage.style.filter = brightness >= 0.99 ? '' : `brightness(${brightness})`;
      showGesture(icon('sun'), '亮度 ' + Math.round(brightness * 100) + '%');
      gestureTimer && clearTimeout(gestureTimer);
    } else if (gMode === 'vol') {
      video.muted = false;
      video.volume = Math.max(0, Math.min(1, video.volume - dy / 300));
      showGesture(icon('speaker'), '音量 ' + Math.round(video.volume * 100) + '%');
      gestureTimer && clearTimeout(gestureTimer);
    }
  });
  video.addEventListener('pointerup', (e) => {
    if (gTimer) { clearTimeout(gTimer); gTimer = null; }
    if (gLongFired) { speed3End(); gStart = null; return; }
    if (gMode === 'seek' && video._pendingSeek != null) { video.currentTime = video._pendingSeek; video._pendingSeek = null; hideGesture(); }
    else if (gMode) { hideGesture(); }
    else if (gStart) {
      /* 无滑动 = 点击：区分单击/双击 */
      const now = Date.now();
      const x = e.clientX;
      if (now - gLastTap < 280) {
        if (gTapTimer) { clearTimeout(gTapTimer); gTapTimer = null; }
        gLastTap = 0;
        const third = stage.clientWidth / 3;
        if (x < third) { video.currentTime = Math.max(0, video.currentTime - 15); showGesture(icon('prev'), '快退 15s'); hideGesture(); }
        else if (x > third * 2) { video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 15); showGesture(icon('next'), '快进 15s'); hideGesture(); }
        else { video.paused ? video.play() : video.pause(); }
      } else {
        gLastTap = now;
        gTapTimer = setTimeout(() => {
          locked ? (() => { ov.classList.remove('ui-hidden'); setTimeout(() => ov.classList.add('ui-hidden'), 1600); })()
                 : (ov.classList.contains('ui-hidden') ? showUI() : ov.classList.add('ui-hidden'));
        }, 290);
      }
    }
    gStart = null; gMode = null;
  });
  video.addEventListener('pointercancel', () => {
    if (gTimer) clearTimeout(gTimer);
    if (gLongFired) speed3End();
    gStart = null; gMode = null; gLongFired = false;
  });

  /* ---------- 视频事件 ---------- */
  video.addEventListener('play', updatePlayBtn);
  video.addEventListener('pause', updatePlayBtn);
  video.addEventListener('waiting', () => { $('.vp-buffer', ov).hidden = false; });
  video.addEventListener('playing', () => { $('.vp-buffer', ov).hidden = true; });
  video.addEventListener('canplay', () => { $('.vp-buffer', ov).hidden = true; });
  video.addEventListener('loadedmetadata', () => {
    if (video.videoWidth) $('[data-v="res"]', ov).textContent = video.videoWidth + '×' + video.videoHeight;
  });
  video.addEventListener('error', () => {
    if (video.src && !destroyed) showError('视频加载失败，请重试或切换线路');
  });
  video.addEventListener('ended', () => { if (idx < chapters.length - 1) loadEpisode(idx + 1); });

  /* ---------- 键盘快捷键（桌面端） ---------- */
  function onKey(e) {
    if (!document.contains(ov)) { document.removeEventListener('keydown', onKey); return; }
    if (/input|textarea/i.test((document.activeElement || {}).tagName || '')) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
    else if (k === 'ArrowLeft') { video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 30 : 5)); showUI(); }
    else if (k === 'ArrowRight') { video.currentTime = Math.min(video.duration || 1e9, video.currentTime + (e.shiftKey ? 30 : 5)); showUI(); }
    else if (k === 'ArrowUp') { e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); showGesture(icon('speaker'), '音量 ' + Math.round(video.volume * 100) + '%'); hideGesture(); }
    else if (k === 'ArrowDown') { e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); showGesture(icon('speaker'), '音量 ' + Math.round(video.volume * 100) + '%'); hideGesture(); }
    else if (k === 'f' || k === 'F') toggleFs();
    else if (k === 'm' || k === 'M') video.muted = !video.muted;
    else if (k === 'n' || k === 'N') loadEpisode(idx + 1);
    else if (k === 'p' || k === 'P') loadEpisode(idx - 1);
  }
  document.addEventListener('keydown', onKey);

  /* ---------- 按钮绑定 ---------- */
  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen();
    else stage.requestFullscreen().catch(() => {});
  }
  function destroy() {
    destroyed = true;
    clearInterval(timer);
    clearInterval(clockTimer);
    if (uiTimer) clearTimeout(uiTimer);
    document.removeEventListener('keydown', onKey);
    destroyHls();
    video.pause();
    video.removeAttribute('src');
    ov.remove();
  }
  function toggleLock(on) {
    locked = on == null ? !locked : on;
    $('.vp-lock-fab', ov).hidden = !locked;
    if (locked) { ov.classList.add('ui-hidden'); toast('已锁定，点击锁图标解锁'); }
    else showUI();
  }

  $('[data-a="back"]', ov).onclick = destroy;
  $('[data-a="play"]', ov).onclick = () => { video.paused ? video.play() : video.pause(); };
  $('[data-a="prev"]', ov).onclick = () => loadEpisode(idx - 1);
  $('[data-a="next"]', ov).onclick = () => loadEpisode(idx + 1);
  $('[data-a="episodes"]', ov).onclick = () => $('.vp-episodes', ov).classList.toggle('hidden');
  $('[data-a="fs"]', ov).onclick = toggleFs;
  $('[data-a="lock"]', ov).onclick = () => toggleLock();
  $('[data-a="unlock"]', ov).onclick = () => toggleLock(false);
  $('[data-a="skipoutro"]', ov).onclick = () => { $('.vp-skip-outro', ov).hidden = true; loadEpisode(idx + 1); };
  const pipBtn = $('[data-a="pip"]', ov);
  if (pipBtn) pipBtn.onclick = () => {
    document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture().catch(() => toast('画中画不可用'));
  };
  /* 倍速：点击循环，长按弹列表 */
  const spdBtn = $('[data-a="speed"]', ov);
  spdBtn.onclick = cycleSpeed;
  let spdPress = null;
  spdBtn.addEventListener('pointerdown', () => { spdPress = setTimeout(() => { spdPress = 'fired'; pickSpeed(); }, 500); });
  spdBtn.addEventListener('pointerup', () => { if (spdPress && spdPress !== 'fired') clearTimeout(spdPress); spdPress = null; });
  spdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  /* 比例：点击循环，长按弹列表 */
  const scBtn = $('[data-a="scale"]', ov);
  scBtn.onclick = () => cycleScale(1);
  scBtn.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const v = await actionSheet('画面尺寸', SCALES.map((s, i) => ({ label: s.name, value: i, icon: i === scaleIdx ? 'check' : undefined })));
    if (v !== null && v !== undefined) { scaleIdx = v; applyScale(); setSetting('videoScale', v).catch(() => {}); }
  });
  $('[data-a="lines"]', ov).onclick = async () => {
    if (lines.length < 2) return toast('当前只有一个线路');
    const v = await actionSheet('切换线路', lines.map((l, i) => ({ label: l.name || '线路' + (i + 1), value: i, icon: i === lineIdx ? 'check' : undefined })));
    if (v !== null && v !== undefined) { lineIdx = v; playUrl(lines[lineIdx].url, video.currentTime); }
  };
  /* 片头片尾（TVBox play_time_start / play_time_end） */
  $('[data-a="skip"]', ov).onclick = async () => {
    const v = await actionSheet('片头片尾跳过', [
      { label: `把当前位置设为片头结束${skip.st ? `（已设 ${fmtT(skip.st)}）` : ''}`, value: 'st', icon: 'timer' },
      { label: `把当前位置设为片尾开始${skip.et ? `（已设 剩 ${fmtT(skip.et)}）` : ''}`, value: 'et', icon: 'timer' },
      { label: '清除片头片尾设置', value: 'clear', icon: 'clear', danger: true },
    ]);
    if (v === 'st') { skip.st = Math.floor(video.currentTime); await kvSet('vskip:' + bookId, skip); toast('片头 ' + fmtT(skip.st) + '，下次自动跳过'); }
    if (v === 'et') {
      if (!video.duration) return toast('视频时长未知，稍后再试', 'err');
      skip.et = Math.max(1, Math.floor(video.duration - video.currentTime));
      await kvSet('vskip:' + bookId, skip);
      toast('片尾剩 ' + fmtT(skip.et) + ' 时将自动下一集');
    }
    if (v === 'clear') { skip = { st: 0, et: 0 }; await kvSet('vskip:' + bookId, skip); toast('已清除'); }
  };

  /* ---------- 初始化 ---------- */
  applyScale();
  applySpeed(speed, true);
  try {
    chapters = await getChapterList(source, item.bookUrl);
    if (!chapters.length) throw new Error('没有可播放的集数');
    const prog = await getProgress(bookId);
    await loadEpisode(prog && prog.chapterIndex != null ? prog.chapterIndex : startChapter);
  } catch (e) {
    if (!destroyed) showError(e.message);
  }
}
