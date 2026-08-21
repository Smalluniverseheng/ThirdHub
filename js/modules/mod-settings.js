/* ===== ThirdHub js/modules/mod-settings.js — 模块内设置（v1.7 设置分级） =====
   阅读设置归属于「小说」模块，漫画设置归属于「漫画」模块；
   全局设置（主题 / 语言 / 导航）仍保留在「我的」中 */
import { $$, openOverlay as openOv } from '../ui.js';
import { getSetting, setSetting } from '../store.js';

function chipRow(S, label, key, opts) {
  return `
    <div class="muted mb8">${label}</div>
    <div class="nr-chip-row mb16" data-g="${key}">
      ${opts.map(([v, name]) => `<button class="ai-chip ${String(S[key]) === String(v) ? 'on' : ''}" data-v="${v}">${name}</button>`).join('')}
    </div>`;
}
function tog(S, label, key) {
  return `<div class="nr-set-row"><span>${label}</span><button class="ai-toggle ${S[key] ? 'on' : ''}" data-tog="${key}"></button></div>`;
}

async function bind(body, S) {
  $$('[data-g]', body).forEach((g) => {
    const key = g.dataset.g;
    $$('.ai-chip', g).forEach((b) => b.onclick = async () => {
      S[key] = b.dataset.v;
      await setSetting(key, S[key]);
      $$('.ai-chip', g).forEach((x) => x.classList.toggle('on', x === b));
    });
  });
  $$('[data-tog]', body).forEach((t) => t.onclick = async () => {
    const key = t.dataset.tog;
    S[key] = !S[key];
    t.classList.toggle('on', S[key]);
    await setSetting(key, S[key]);
  });
}

/* ================= 小说阅读设置（小说模块） ================= */
export async function showNovelSettings() {
  const keys = ['readerFlip', 'readerFont', 'readerTheme', 'readerIllust', 'readerTapFlip', 'readerVolumeFlip', 'readerInfoBar'];
  const S = {};
  for (const k of keys) S[k] = await getSetting(k);
  openOv({
    title: '阅读设置',
    build: async (body) => {
      body.innerHTML = `
        ${chipRow(S, '默认翻页方式', 'readerFlip', [['scroll', '滚动'], ['slide', '左右滑动'], ['cover', '覆盖'], ['sim', '仿真'], ['none', '无动画']])}
        ${chipRow(S, '字体', 'readerFont', [['system', '系统默认'], ['serif', '衬线'], ['sans', '无衬线'], ['kai', '楷体']])}
        ${chipRow(S, '背景主题', 'readerTheme', [['day', '白天'], ['night', '夜间'], ['eye', '护眼'], ['paper', '羊皮纸'], ['blue', '浅蓝'], ['green', '竹绿']])}
        ${tog(S, '显示正文插图（插图小说）', 'readerIllust')}
        ${tog(S, '点按翻页', 'readerTapFlip')}
        ${tog(S, '音量键翻页', 'readerVolumeFlip')}
        ${tog(S, '底部信息栏', 'readerInfoBar')}
        <div class="muted" style="font-size:12px;margin:6px 0 16px">字号 / 行距 / 段距 / 边距 / 亮度 / 自动滚动等细项可在阅读器内「设置」中实时调整。设置云端同步，多设备一致。</div>`;
      bind(body, S);
    },
  });
}

/* ================= 漫画阅读设置（漫画模块） ================= */
export async function showComicSettings() {
  const keys = ['comicLayout', 'comicDir', 'comicFit', 'comicGap', 'comicCropBorder', 'comicPreload'];
  const S = {};
  for (const k of keys) S[k] = await getSetting(k);
  openOv({
    title: '漫画设置',
    build: async (body) => {
      body.innerHTML = `
        ${chipRow(S, '默认布局', 'comicLayout', [['paged', '单页'], ['double', '双页'], ['webtoon', '条漫（上下滚动）']])}
        ${chipRow(S, '翻页方向', 'comicDir', [['ltr', '左翻（国漫）'], ['rtl', '右翻（日漫）']])}
        ${chipRow(S, '图片适配', 'comicFit', [['width', '适应宽度'], ['height', '适应高度'], ['original', '原始大小']])}
        ${tog(S, '页间留白', 'comicGap')}
        ${tog(S, '切除白边', 'comicCropBorder')}
        <div class="muted" style="font-size:12px;margin:6px 0 16px">缩放 / 分页提示等细项可在漫画阅读器内实时调整。设置云端同步，多设备一致。</div>`;
      bind(body, S);
    },
  });
}
