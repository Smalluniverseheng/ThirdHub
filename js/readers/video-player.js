/* ===== ThirdHub js/readers/video-player.js — 视频播放器（m3u8/mp4/选集/线路/倍速/画中画） ===== */
import { $, $$, esc, icon, toast, actionSheet, fmtDuration } from '../ui.js';
import { getChapterList, getChapterContent, saveProgress, getProgress } from '../engine/content-service.js';
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

export async function openVideoPlayer({ source, item, startChapter = 0 }) {
  let chapters = [];
  let idx = startChapter;
  let hls = null;
  let lines = []; // 当前集的线路
  let lineIdx = 0;

  const ov = document.createElement('div');
  ov.className = 'overlay vp-overlay';
  ov.innerHTML = `
    <div class="vp-stage">
      <video class="vp-video" playsinline webkit-playsinline></video>
      <div class="vp-top cr-ui">
        <button class="icon-btn" data-a="back">${icon('back')}</button>
        <div class="overlay-title ellipsis" style="color:#fff">${esc(item.title || item.name)}</div>
        ${canPiP() ? `<button class="icon-btn" data-a="pip" title="画中画">${icon('fullscreen')}</button>` : ''}
      </div>
      <div class="vp-controls cr-ui">
        <div class="vp-progress-row">
          <span class="vp-time" data-t="cur">00:00</span>
          <input type="range" class="vp-seek" min="0" max="1000" value="0">
          <span class="vp-time" data-t="dur">00:00</span>
        </div>
        <div class="vp-btn-row">
          <button class="vp-btn" data-a="prev" title="上一集">${icon('prev')}</button>
          <button class="vp-btn vp-play" data-a="play">${icon('play')}</button>
          <button class="vp-btn" data-a="next" title="下一集">${icon('next')}</button>
          <button class="vp-btn" data-a="speed" title="倍速">1.0x</button>
          <button class="vp-btn" data-a="lines" title="线路">线路</button>
          <button class="vp-btn" data-a="episodes" title="选集">选集</button>
          <button class="vp-btn" data-a="fs" title="全屏">${icon('fullscreen')}</button>
        </div>
      </div>
    </div>
    <div class="vp-episodes hidden"></div>`;
  document.getElementById('overlay-root').appendChild(ov);

  const video = $('.vp-video', ov);
  const seek = $('.vp-seek', ov);

  function destroyHls() { if (hls) { hls.destroy(); hls = null; } }

  async function playUrl(url, resumeSec = 0) {
    destroyHls();
    if (url.includes('.m3u8')) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
      } else {
        const Hls = await loadHls();
        if (Hls.isSupported()) {
          hls = new Hls({ maxBufferLength: 30 });
          hls.loadSource(url);
          hls.attachMedia(video);
        } else { toast('当前浏览器不支持 m3u8 播放', 'err'); return; }
      }
    } else {
      video.src = url;
    }
    if (resumeSec > 5) {
      video.addEventListener('loadedmetadata', () => { video.currentTime = resumeSec; }, { once: true });
    }
    video.play().catch(() => {});
    updatePlayBtn();
  }

  async function loadEpisode(i) {
    if (i < 0 || i >= chapters.length) return;
    idx = i;
    try {
      const raw = await getChapterContent(source, chapters[idx].url);
      let data;
      try { data = JSON.parse(raw); } catch (e) { data = { title: '', urls: [{ name: '默认', url: raw }] }; }
      if (typeof data === 'string') data = { title: '', urls: [{ name: '默认', url: data }] }; 
      lines = data.urls || [{ name: '默认', url: chapters[idx].url }];
      lineIdx = 0;
      const prog = await getProgress(item.id || (source.id + ':' + item.bookUrl));
      const resume = prog && prog.chapterIndex === idx && prog.position ? prog.position : 0;
      await playUrl(lines[lineIdx].url, resume);
      saveProgress(item.id || (source.id + ':' + item.bookUrl), { chapterIndex: idx });
      renderEpisodes();
    } catch (e) {
      toast('加载失败：' + e.message, 'err');
    }
  }

  function renderEpisodes() {
    const box = $('.vp-episodes', ov);
    box.innerHTML = `<div class="vp-ep-head">选集（${chapters.length}）</div>` +
      `<div class="vp-ep-grid">` + chapters.map((c, i) =>
        `<button class="vp-ep ${i === idx ? 'on' : ''}" data-i="${i}">${esc(c.name || '第' + (i + 1) + '集')}</button>`).join('') + '</div>';
    $$('.vp-ep', box).forEach((b) => b.onclick = () => { box.classList.add('hidden'); loadEpisode(+b.dataset.i); });
  }

  function updatePlayBtn() {
    $('[data-a="play"]', ov).innerHTML = video.paused ? icon('play') : icon('pause');
  }

  // 进度记忆（每 5 秒）
  const timer = setInterval(() => {
    if (!video.paused && video.duration) {
      saveProgress(item.id || (source.id + ':' + item.bookUrl), { chapterIndex: idx, position: Math.floor(video.currentTime) });
      seek.value = Math.floor((video.currentTime / video.duration) * 1000);
      $('[data-t="cur"]', ov).textContent = fmtDuration(video.currentTime);
      $('[data-t="dur"]', ov).textContent = fmtDuration(video.duration);
    }
  }, 1000);

  seek.oninput = () => { if (video.duration) video.currentTime = (seek.value / 1000) * video.duration; };
  video.addEventListener('play', updatePlayBtn);
  video.addEventListener('pause', updatePlayBtn);
  video.addEventListener('ended', () => { if (idx < chapters.length - 1) loadEpisode(idx + 1); });
  video.addEventListener('click', () => ov.classList.toggle('ui-hidden'));

  // 手势：左右滑快进，右侧上下滑音量
  let touchX = 0, touchY = 0;
  video.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
  video.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 60) {
      video.currentTime = Math.max(0, video.currentTime + (dx > 0 ? 15 : -15));
      toast(dx > 0 ? '快进 15s' : '快退 15s');
    }
  }, { passive: true });

  $('[data-a="back"]', ov).onclick = () => { clearInterval(timer); destroyHls(); video.pause(); ov.remove(); };
  $('[data-a="play"]', ov).onclick = () => { video.paused ? video.play() : video.pause(); };
  $('[data-a="prev"]', ov).onclick = () => loadEpisode(idx - 1);
  $('[data-a="next"]', ov).onclick = () => loadEpisode(idx + 1);
  $('[data-a="episodes"]', ov).onclick = () => $('.vp-episodes', ov).classList.toggle('hidden');
  $('[data-a="fs"]', ov).onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('.vp-stage', ov).requestFullscreen().catch(() => {});
  };
  const pipBtn = $('[data-a="pip"]', ov);
  if (pipBtn) pipBtn.onclick = () => {
    document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture().catch(() => toast('画中画不可用'));
  };
  $('[data-a="speed"]', ov).onclick = async (e) => {
    const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    const v = await actionSheet('播放速度', speeds.map((s) => ({ label: s + 'x', value: s, icon: video.playbackRate === s ? 'check' : undefined })));
    if (v) { video.playbackRate = v; e.currentTarget.textContent = v + 'x'; }
  };
  $('[data-a="lines"]', ov).onclick = async () => {
    if (lines.length < 2) return toast('当前只有一个线路');
    const v = await actionSheet('切换线路', lines.map((l, i) => ({ label: l.name || '线路' + (i + 1), value: i, icon: i === lineIdx ? 'check' : undefined })));
    if (v !== null && v !== undefined) { lineIdx = v; playUrl(lines[lineIdx].url, video.currentTime); }
  };

  try {
    chapters = await getChapterList(source, item.bookUrl);
    if (!chapters.length) throw new Error('没有可播放的集数');
    const prog = await getProgress(item.id || (source.id + ':' + item.bookUrl));
    await loadEpisode(prog && prog.chapterIndex != null ? prog.chapterIndex : startChapter);
  } catch (e) {
    toast(e.message, 'err');
  }
}
