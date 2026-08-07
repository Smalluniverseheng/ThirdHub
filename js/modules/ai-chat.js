/* ===== ThirdHub js/modules/ai-chat.js — AI 对话页（v1.6） =====
   抽屉：历史会话(默认) / AI模型(厂商折叠) / 智能体 / 灵感广场 · 输入栏贴底 · 流式渐进渲染
   上拉钉住+回到底部 · 长文本粘贴转附件 · 附件按模型能力置灰 · 对话设置/高级设置入口 */
import { $, $$, el, esc, icon, toast, modal, actionSheet, openOverlay, confirmDialog, formRow, uid, fmtDate } from '../ui.js';
import { db, kvGet, kvSet, on } from '../store.js';
import {
  chat, drawImage, generateVideo, getApiKey, setApiKey, getBaseOverride, setBaseOverride,
  supportsWebSearch, refreshFreeModels, identifyApiKey, testProviderKey,
  fetchRemoteModels, saveSyncedModels, getSyncedModels, transcribeAudio,
} from '../ai/ai-api.js';
import { SEARCH_SERVICES, getSearchConfig, setSearchConfig, hasSearchConfig, searchWeb, resultsToContext } from '../ai/web-search.js';
import { PROVIDERS, providerById } from '../ai/ai-models.js';
import { vendorIcon } from '../ai/vendors.js';
import { pickModel } from '../ai/model-selector.js';
import { renderMarkdown, bindCopyButtons } from '../ai/markdown.js';
import { getSessionStats, fmtTokens } from '../token-meter.js';
import { startRecognition, stopRecognition, speak, stopSpeak, startRecorder } from '../voice.js';
import { listMcpServers, addMcpServer, connectMcp, disconnectMcp, removeMcpServer } from '../ai/mcp-client.js';
import { AGENTS, INSPIRATIONS } from '../ai/ai-agents.js';
import { RANK_CATEGORIES, RANKINGS, RADAR_DIMS } from '../ai/ai-rankings.js';
import { showAdvSettings, showChatSettings, getChatPrefs, getCtxConf } from './ai-settings.js';
import { openAgentStudio } from './ai-agent-studio.js';
import { showInspirePage, showInspireDetail } from './ai-inspire.js';
import { device } from '../device.js';
import { currentUser } from '../auth.js';
import { trashChat, recycleDays } from './recycle-bin.js';

/* 当前用户头像缓存（消息头像 + 抽屉头部同步） */
let __userAvatar = '';
export function userAvatarHtml(cls = '') {
  return `<img class="${cls}" src="${__userAvatar ? esc(__userAvatar) : 'icons/brand.jpg'}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
}
currentUser().then((u) => { __userAvatar = (u && u.avatar) || ''; }).catch(() => {});
on('auth:changed', () => { currentUser().then((u) => { __userAvatar = (u && u.avatar) || ''; }).catch(() => {}); });

const MODES = [
  { id: 'single',  name: '单模型',   desc: '一对一对话' },
  { id: 'compare', name: '多模型对比', desc: '同一问题多模型并排回答' },
  { id: 'debate',  name: '辩论模式',  desc: '正反双方多轮辩论' },
  { id: 'collab',  name: '协同模式',  desc: '多模型协作修订回答' },
];
const WORKSPACES = [
  { id: 'chat',  name: '聊天', ico: 'robot' },
  { id: 'image', name: '图片', ico: 'image' },
  { id: 'video', name: '视频', ico: 'film' },
];
const RATIO_SIZE = { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536', '16:9': '1792x1024', '9:16': '1024x1792' };
const IMG_RATIOS = ['1:1', '3:2', '2:3', '16:9', '9:16'];
const VID_RATIOS = ['16:9', '9:16', '1:1'];
const VID_DURS = [5, 10, 15];
const DRAWER_TABS = [
  { id: 'history', name: '历史会话' },
  { id: 'models',  name: 'AI模型' },
  { id: 'agents',  name: '智能体' },
  { id: 'inspire', name: '灵感广场' },
];
const DRAWER_FILTERS = [
  { id: 'all', name: '全部' }, { id: 'chat', name: '聊天' },
  { id: 'image', name: '图片' }, { id: 'video', name: '视频' },
];
/* 同步模型里常见的非对话模型（ embeddings / 语音 / 图像 / 审核等），在对话列表中过滤掉 */
const NON_CHAT_RE = /embed|whisper|tts|transcri|speech|audio|dall-e|image|imagen|moderation|rerank|babbage|davinci|clip|sora|veo|wanx|cogview|cogvideo|kolors|stable-diffusion|seedream|seedance|hailuo|sensemirage/i;
export function isChatModel(m) { return !NON_CHAT_RE.test(m || ''); }

let session = null;
let currentModel = null;
let imageModel = null;
let videoModel = null;
let compareModels = [];
let currentMode = 'single';
let workspace = 'chat';
let imgRatio = '1:1';
let vidRatio = '16:9';
let vidDur = 5;
let drawerTab = 'history';
let drawerFilter = 'all';
let abortCtl = null;
let sending = false;
let userPinned = false; // 流式期间用户上拉钉住
const attachTexts = new Map(); // 文本附件内容（chip ref -> {name,text}）

/* ================= 主渲染 ================= */
export async function renderAIChat(page) {
  currentModel = await kvGet('ai:last-model', { providerId: 'deepseek', model: 'deepseek-chat' });
  imageModel = await kvGet('ai:image-model', { providerId: 'openai', model: 'gpt-image-1' });
  videoModel = await kvGet('ai:video-model', { providerId: 'bytedance', model: 'doubao-seedance-1-0-pro' });
  currentMode = await kvGet('ai:last-mode', 'single');
  compareModels = await kvGet('ai:compare-models', []);
  workspace = await kvGet('ai:workspace', 'chat');
  imgRatio = await kvGet('ai:img-ratio', '1:1');
  vidRatio = await kvGet('ai:vid-ratio', '16:9');
  vidDur = await kvGet('ai:vid-dur', 5);
  refreshFreeModels().catch(() => {});
  bindPreviewCode();

  page.classList.add('ai-page');
  page.innerHTML = `
    <div class="ai-wrap" id="ai-wrap">
      <div class="ai-topbar">
        <button class="icon-btn" data-a="menu" title="菜单">${icon('menu')}</button>
        <div class="ai-topbar-center">
          <button class="ai-pill" data-a="model"><span class="pill-ico"></span><span class="pill-text"></span><span class="pill-arrow">▾</span></button>
          <button class="ai-pill" data-a="mode"><span class="pill-text"></span><span class="pill-arrow">▾</span></button>
        </div>
        <button class="icon-btn" data-a="new" title="新对话">${icon('plus')}</button>
      </div>
      <div class="ai-messages" id="ai-messages"></div>
      <button class="ai-jump-btn" id="ai-jump-btn" hidden title="回到底部">${icon('arrowR')}</button>
      <div class="ai-inputbar">
        <div class="ai-attach-strip" id="ai-attach-strip" hidden></div>
        <div class="ai-input-row" id="ai-input-row">
          <button class="ai-plus-btn" data-a="plus" title="更多功能">${icon('plus')}</button>
          <textarea class="ai-textarea" rows="1" placeholder="输入消息…"></textarea>
          <button class="ai-tool-btn" data-a="voice" title="语音输入">${icon('mic')}</button>
          <button class="ai-send" data-a="send">${icon('send')}</button>
        </div>
        <div class="ai-voicebar" id="ai-voicebar" hidden>
          <button class="ai-tool-btn" data-a="kb" title="键盘输入">${icon('edit')}</button>
          <button class="ai-hold-btn" id="ai-hold">按住 说话</button>
          <div class="ai-voice-hint" id="ai-voice-hint" hidden>松开发送 · 上滑取消</div>
        </div>
        <div class="ai-token-hint" id="ai-token-hint"></div>
      </div>
    </div>
    <div class="ai-peek-mask" id="ai-peek-mask"></div>
    <div class="ai-drawer-mask" data-a="drawer-mask"></div>
    <aside class="ai-drawer" id="ai-drawer">
      <button class="ai-drawer-head" data-a="d-adv" title="高级设置">
        <span class="ai-drawer-logo" data-role="d-avatar">${userAvatarHtml()}</span>
        <span class="ai-drawer-title">ThirdHub AI</span>
        <span class="ai-drawer-arrow">${icon('arrowR')}</span>
      </button>
      <button class="ai-drawer-item" data-a="d-models">${icon('cpu')}<span>模型</span><span class="ai-drawer-arrow">${icon('arrowR')}</span></button>
      <div class="ai-dtabs" id="ai-dtabs">
        ${DRAWER_TABS.map(t => `<button class="ai-dtab ${t.id === drawerTab ? 'on' : ''}" data-dtab="${t.id}">${t.name}</button>`).join('')}
      </div>
      <div class="ai-dfilters" id="ai-dfilters" ${drawerTab === 'models' ? '' : 'hidden'}>
        ${DRAWER_FILTERS.map(f => `<button class="ai-dfilter ${f.id === drawerFilter ? 'on' : ''}" data-dfilter="${f.id}">${f.name}</button>`).join('')}
      </div>
      <div class="ai-drawer-scroll">
        <div id="ai-dtab-content"></div>
      </div>
      <div class="ai-drawer-bottom">
        <div class="ai-dsearch">${icon('search')}<input id="ai-dsearch-input" placeholder="搜索历史对话"></div>
        <button class="ai-dnew" data-a="d-new" title="新对话">${icon('plus')}</button>
      </div>
    </aside>
    <div class="ai-plus-mask" data-a="plus-mask"></div>
    <div class="ai-plus-sheet" id="ai-plus-sheet">
      <div class="ai-plus-grid">
        <button class="ai-plus-cell" data-plus="camera" data-cap="vision"><span class="ai-plus-ico">${icon('camera')}</span><span class="ai-plus-label">拍照</span></button>
        <button class="ai-plus-cell" data-plus="photos" data-cap="vision"><span class="ai-plus-ico">${icon('image')}</span><span class="ai-plus-label">照片</span></button>
        <button class="ai-plus-cell" data-plus="file"><span class="ai-plus-ico">${icon('file')}</span><span class="ai-plus-label">本地文件</span></button>
        <button class="ai-plus-cell" data-plus="draw" data-cap="image"><span class="ai-plus-ico">${icon('brush')}</span><span class="ai-plus-label">AI绘画</span></button>
        <button class="ai-plus-cell" data-plus="video" data-cap="video"><span class="ai-plus-ico">${icon('film')}</span><span class="ai-plus-label">AI视频</span></button>
      </div>
      <div class="ai-plus-gen" id="ai-plus-gen" hidden></div>
      <div class="ai-plus-settings">
        <div class="ai-plus-row">
          <div class="ai-plus-row-info"><div class="ai-plus-row-name">联网搜索</div><div class="ai-plus-row-sub" id="ai-web-sub"></div></div>
          <button class="ai-toggle" data-a="web-toggle" id="ai-web-toggle"></button>
        </div>
        <button class="ai-plus-row" data-a="chat-settings">
          <div class="ai-plus-row-info"><div class="ai-plus-row-name">对话设置</div><div class="ai-plus-row-sub">系统提示 · 上下文 · 采样参数 · 背景</div></div>
          <span class="ai-drawer-arrow">${icon('arrowR')}</span>
        </button>
        <button class="ai-plus-row" data-a="adv-settings">
          <div class="ai-plus-row-info"><div class="ai-plus-row-name">更多设置</div><div class="ai-plus-row-sub">偏好 · 语音 · 记忆 · 用量 · 工具 · 专用模型</div></div>
          <span class="ai-drawer-arrow">${icon('arrowR')}</span>
        </button>
      </div>
      <input type="file" id="ai-cam-input" accept="image/*" capture="environment" hidden>
      <input type="file" id="ai-img-input" accept="image/*" multiple hidden>
      <input type="file" id="ai-file-input" hidden>
    </div>`;

  await newSession();
  renderMessages(page);
  updateTopbar(page);
  updatePlusGen(page);
  updateTokenHint();
  updateInputBar(page);
  on('token:update', updateTokenHint);

  /* ----- 上拉钉住 + 回到底部 ----- */
  const msgBox = $('#ai-messages', page);
  const jumpBtn = $('#ai-jump-btn', page);
  userPinned = false;
  msgBox.addEventListener('scroll', () => {
    const dist = msgBox.scrollHeight - msgBox.scrollTop - msgBox.clientHeight;
    if (dist > 120) { if (!userPinned) { userPinned = true; jumpBtn.hidden = false; } }
    else if (dist < 40) { if (userPinned) { userPinned = false; jumpBtn.hidden = true; } }
  }, { passive: true });
  jumpBtn.onclick = () => { userPinned = false; jumpBtn.hidden = true; scrollBottom(page, true); };

  const ta = $('.ai-textarea', page);
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
    updateInputBar(page);
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !/Android|iPhone/i.test(navigator.userAgent)) {
      e.preventDefault(); sendMessage(page);
    }
  });
  /* 长文本粘贴 → 自动转为文本附件，避免撑爆输入框 */
  ta.addEventListener('paste', (e) => {
    const txt = (e.clipboardData || window.clipboardData).getData('text');
    if (!txt || txt.length < 400) return;
    e.preventDefault();
    addTextAttachment(page, '粘贴的长文本.txt', txt);
    toast('长文本已转为附件（随消息一起发送）', 'ok');
  });

  /* ----- 抽屉 ----- */
  const drawer = $('#ai-drawer', page), drawerMask = $('[data-a="drawer-mask"]', page), peek = $('#ai-peek-mask', page);
  const openDrawer = () => {
    renderDrawerTab(page);
    drawer.classList.add('open'); drawerMask.classList.add('open');
    if (device.isTouch && !device.isDesktop) peek.classList.add('show');
  };
  const closeDrawer = () => {
    drawer.classList.remove('open'); drawerMask.classList.remove('open'); peek.classList.remove('show');
  };
  page.__closeDrawer = closeDrawer;
  $('[data-a="menu"]', page).onclick = openDrawer;
  drawerMask.onclick = closeDrawer;
  peek.onclick = closeDrawer;
  $('[data-a="d-new"]', drawer).onclick = () => { closeDrawer(); newSession(); renderMessages(page); toast('已开始新对话'); };
  $('[data-a="d-models"]', drawer).onclick = () => { closeDrawer(); showModelsPage(page); };
  $('[data-a="d-adv"]', drawer).onclick = () => { closeDrawer(); showAdvSettings(page); };
  /* 抽屉头部头像与账号头像实时同步 */
  currentUser().then((u) => {
    __userAvatar = (u && u.avatar) || '';
    const av = $('[data-role="d-avatar"]', drawer);
    if (av) av.innerHTML = userAvatarHtml();
  }).catch(() => {});
  $('#ai-dsearch-input', page).addEventListener('input', (e) => {
    // 搜索时自动切到「历史会话」tab
    if (drawerTab !== 'history') {
      drawerTab = 'history';
      $$('#ai-dtabs .ai-dtab', page).forEach(x => x.classList.toggle('on', x.dataset.dtab === 'history'));
      $('#ai-dfilters', page).hidden = true;
    }
    renderDrawerTab(page);
  });
  $$('#ai-dtabs .ai-dtab', page).forEach(b => b.onclick = () => {
    drawerTab = b.dataset.dtab;
    $$('#ai-dtabs .ai-dtab', page).forEach(x => x.classList.toggle('on', x === b));
    $('#ai-dfilters', page).hidden = drawerTab !== 'models';
    renderDrawerTab(page);
  });
  $$('#ai-dfilters .ai-dfilter', page).forEach(b => b.onclick = () => {
    drawerFilter = b.dataset.dfilter;
    $$('#ai-dfilters .ai-dfilter', page).forEach(x => x.classList.toggle('on', x === b));
    renderDrawerTab(page);
  });
  bindDrawerSwipe(page, drawer, openDrawer, closeDrawer);

  /* ----- ＋ 面板 ----- */
  const plusSheet = $('#ai-plus-sheet', page), plusMask = $('[data-a="plus-mask"]', page);
  const openPlus = () => { syncWebRow(); syncPlusCaps(page); updatePlusGen(page); plusSheet.classList.add('open'); plusMask.classList.add('open'); };
  const closePlus = () => { plusSheet.classList.remove('open'); plusMask.classList.remove('open'); };
  $('[data-a="plus"]', page).onclick = openPlus;
  plusMask.onclick = closePlus;
  $('[data-a="chat-settings"]', page).onclick = () => { closePlus(); showChatSettings(page, session, () => { applySessionBg(page); updateTopbar(page); }); };
  $('[data-a="adv-settings"]', page).onclick = () => { closePlus(); showAdvSettings(page); };
  const webOn = () => $('#ai-web-toggle', page).classList.contains('on');
  const webAvail = async () => (await hasSearchConfig()) || supportsWebSearch(currentModel.providerId);
  if (await kvGet('ai:web-on', false) && await webAvail()) $('#ai-web-toggle', page).classList.add('on');
  async function syncWebRow() {
    const hasSvc = await hasSearchConfig();
    const modelSide = supportsWebSearch(currentModel.providerId);
    const sub = $('#ai-web-sub', page);
    if (hasSvc) {
      const cfg = await getSearchConfig();
      const svc = SEARCH_SERVICES.find((s) => s.id === cfg.service);
      sub.textContent = (webOn() ? '已开启 · ' : '') + '使用 ' + (svc ? svc.name : '搜索服务') + ' 检索后注入上下文';
    } else if (modelSide) {
      sub.textContent = webOn() ? '已开启 · 由模型端完成搜索' : '当前模型自带联网搜索能力';
    } else {
      sub.textContent = '未配置搜索服务，请到「设置 → 联网搜索服务」配置';
    }
    $('#ai-web-toggle', page).classList.toggle('disabled', !hasSvc && !modelSide);
  }
  $('#ai-web-toggle', page).onclick = async () => {
    if (!(await webAvail())) { toast('请先配置联网搜索服务，或切换支持联网的模型'); return; }
    const t = $('#ai-web-toggle', page);
    t.classList.toggle('on');
    await kvSet('ai:web-on', t.classList.contains('on'));
    toast(t.classList.contains('on') ? '联网搜索已开启' : '联网搜索已关闭');
    syncWebRow();
  };
  $('#ai-cam-input', page).onchange = (e) => { addImageFiles(page, e.target.files); e.target.value = ''; closePlus(); };
  $('#ai-img-input', page).onchange = (e) => { addImageFiles(page, e.target.files); e.target.value = ''; closePlus(); };
  $('#ai-file-input', page).onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; closePlus();
    if (!f) return;
    if (f.type.startsWith('image/')) { addImageFiles(page, [f]); return; }
    try {
      const txt = await f.text();
      addTextAttachment(page, f.name, txt.slice(0, 20000));
      toast('文件已添加为附件', 'ok');
    } catch (err) { toast('无法读取该文件', 'err'); }
  };
  plusSheet.addEventListener('click', (e) => {
    const cell = e.target.closest('.ai-plus-cell');
    if (!cell) return;
    if (cell.classList.contains('disabled')) {
      const cap = cell.dataset.cap;
      toast(cap === 'vision' ? '当前模型不支持识图，请切换视觉模型' : cap === 'image' ? '当前厂商未配置绘画模型' : '当前厂商未配置视频模型');
      return;
    }
    const act = cell.dataset.plus;
    if (act === 'camera') $('#ai-cam-input', page).click();
    else if (act === 'photos') $('#ai-img-input', page).click();
    else if (act === 'file') $('#ai-file-input', page).click();
    else if (act === 'draw') { closePlus(); setWorkspace(page, 'image'); }
    else if (act === 'video') { closePlus(); setWorkspace(page, 'video'); }
  });

  /* ----- 发送 / 语音 ----- */
  $('[data-a="send"]', page).onclick = () => sending ? confirmStop() : sendMessage(page);
  $('[data-a="voice"]', page).onclick = () => enterVoiceBar(page);
  $('[data-a="kb"]', page).onclick = () => exitVoiceBar(page);
  bindHoldToTalk(page);
  $('[data-a="model"]', page).onclick = () => pickModelFlow(page);
  $('[data-a="mode"]', page).onclick = () => pickModeFlow(page);
  $('[data-a="new"]', page).onclick = () => { newSession(); renderMessages(page); toast('已开始新对话'); };
}

/* ================= 工作区 ================= */
function setWorkspace(page, ws) {
  workspace = ws;
  kvSet('ai:workspace', ws);
  updatePlusGen(page);
  updateTopbar(page);
  renderMessages(page);
  updateInputBar(page);
  const ta = $('.ai-textarea', page);
  ta.placeholder = ws === 'image' ? '描述想要的图片…' : ws === 'video' ? '描述想要的视频…' : '输入消息…';
}

/* ＋面板里的生成选项（图片比例 / 视频比例+时长），从顶栏迁入 */
function updatePlusGen(page) {
  const box = $('#ai-plus-gen', page);
  if (!box) return;
  if (workspace === 'image') {
    box.hidden = false;
    box.innerHTML = `<div class="ai-plus-gen-title">画面比例</div><div class="ai-plus-gen-chips">`
      + IMG_RATIOS.map(r => `<button class="ai-ws-chip sm ${r === imgRatio ? 'on' : ''}" data-ratio="${r}">${r}</button>`).join('') + `</div>`;
    $$('[data-ratio]', box).forEach(b => b.onclick = () => { imgRatio = b.dataset.ratio; kvSet('ai:img-ratio', imgRatio); updatePlusGen(page); });
  } else if (workspace === 'video') {
    box.hidden = false;
    box.innerHTML = `<div class="ai-plus-gen-title">视频比例</div><div class="ai-plus-gen-chips">`
      + VID_RATIOS.map(r => `<button class="ai-ws-chip sm ${r === vidRatio ? 'on' : ''}" data-vratio="${r}">${r}</button>`).join('')
      + `</div><div class="ai-plus-gen-title">时长</div><div class="ai-plus-gen-chips">`
      + VID_DURS.map(d => `<button class="ai-ws-chip sm ${d === vidDur ? 'on' : ''}" data-vdur="${d}">${d}s</button>`).join('') + `</div>`;
    $$('[data-vratio]', box).forEach(b => b.onclick = () => { vidRatio = b.dataset.vratio; kvSet('ai:vid-ratio', vidRatio); updatePlusGen(page); });
    $$('[data-vdur]', box).forEach(b => b.onclick = () => { vidDur = +b.dataset.vdur; kvSet('ai:vid-dur', vidDur); updatePlusGen(page); });
  } else {
    box.hidden = true;
    box.innerHTML = '';
  }
}

/* 按当前模型能力置灰＋面板按钮：拍照/照片需视觉模型，AI绘画/视频需对应模型已配置 */
async function syncPlusCaps(page) {
  const vision = workspace === 'chat' && isVisionModel(currentModel);
  const imgOk = !!(providerById(imageModel.providerId).image || []).length && !!(await getApiKey(imageModel.providerId));
  const vidOk = !!(providerById(videoModel.providerId).video || []).length && !!(await getApiKey(videoModel.providerId));
  $$('.ai-plus-cell', page).forEach((c) => {
    const cap = c.dataset.cap;
    const dis = (cap === 'vision' && !vision) || (cap === 'image' && !imgOk) || (cap === 'video' && !vidOk);
    c.classList.toggle('disabled', !!dis);
  });
}

/* 会话背景图（对话设置里上传） */
function applySessionBg(page) {
  const box = $('#ai-messages', page);
  if (!box) return;
  const bg = session && session.settings && session.settings.bgImage;
  box.style.backgroundImage = bg ? `url(${bg})` : '';
  box.classList.toggle('has-bg', !!bg);
}

function updateTopbar(page) {
  const inChat = workspace === 'chat';
  const mp = $('[data-a="model"] .pill-text', page);
  const mi = $('[data-a="model"] .pill-ico', page);
  const sel = workspace === 'image' ? imageModel : workspace === 'video' ? videoModel : currentModel;
  if (currentMode === 'single' || !inChat) {
    mp.textContent = sel.model;
    mi.innerHTML = vendorIcon(sel.providerId);
  } else {
    mp.textContent = compareModels.length ? `${compareModels.length} 个模型` : '选择模型';
    mi.innerHTML = icon('users');
  }
  $('[data-a="mode"] .pill-text', page).textContent = '模式: ' + MODES.find(m => m.id === currentMode).name;
  $('[data-a="mode"]', page).style.display = inChat ? '' : 'none';
}

function updateTokenHint() {
  const s = getSessionStats();
  const hint = $('#ai-token-hint');
  if (hint) hint.textContent = s.requests ? `本次会话：${s.requests} 次请求 · ${fmtTokens(s.prompt + s.completion)} tokens` : '';
}

/* ================= 模型 / 模式选择 ================= */
async function pickModelFlow(page) {
  if (workspace === 'image') {
    const picked = await pickModel({ type: 'image' });
    if (picked) { imageModel = picked; await kvSet('ai:image-model', picked); }
  } else if (workspace === 'video') {
    const picked = await pickModel({ type: 'video' });
    if (picked) { videoModel = picked; await kvSet('ai:video-model', picked); }
  } else if (currentMode === 'compare' || currentMode === 'collab' || currentMode === 'debate') {
    const picked = await pickModel({ multi: true, selected: compareModels.map((m) => m.providerId + '/' + m.model) });
    if (picked && picked.length) {
      compareModels = picked.slice(0, 4);
      await kvSet('ai:compare-models', compareModels);
    }
  } else {
    const picked = await pickModel();
    if (picked) { currentModel = picked; await kvSet('ai:last-model', picked); }
  }
  updateTopbar(page);
}

async function pickModeFlow(page) {
  const v = await actionSheet('对话模式', MODES.map((m) => ({ label: `${m.name} · ${m.desc}`, value: m.id, icon: m.id === currentMode ? 'check' : undefined })));
  if (!v) return;
  currentMode = v;
  await kvSet('ai:last-mode', v);
  if ((v === 'compare' || v === 'collab' || v === 'debate') && compareModels.length < 2) {
    toast('请选择 2-4 个模型');
    await pickModelFlow(page);
  }
  updateTopbar(page);
}

/* ================= 抽屉滑动手势（移动端：对话页左→右拖出，占 4/5 屏，1/5 可点回） ================= */
function bindDrawerSwipe(page, drawer, openDrawer, closeDrawer) {
  if (!device.isTouch || device.isDesktop) return; // 桌面端保持点击展开
  const wrap = $('#ai-wrap', page);
  const peek = $('#ai-peek-mask', page);
  const W = () => Math.min(window.innerWidth * 0.8, 480);
  let tracking = false, dragging = false, sx = 0, sy = 0, startOpen = false;

  const setPos = (p) => { // p: 0=全关 1=全开
    const w = W();
    drawer.style.transform = `translateX(${-100 * (1 - p)}%)`;
    wrap.style.transform = `translateX(${p * w}px)`;
  };
  const clearPos = () => { drawer.style.transform = ''; wrap.style.transform = ''; };

  wrap.addEventListener('touchstart', (e) => {
    if (e.target.closest('textarea, input, .ai-hold-btn, .ai-messages .msg-bubble')) {
      // 消息气泡上允许纵向滚动，但仍可识别明显的横向滑动；输入控件直接忽略
      if (e.target.closest('textarea, input, .ai-hold-btn')) return;
    }
    if (e.touches.length !== 1) return;
    tracking = true; dragging = false;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    startOpen = drawer.classList.contains('open');
  }, { passive: true });

  wrap.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (!dragging) {
      if (Math.abs(dx) < 12) return;
      if (Math.abs(dx) <= Math.abs(dy)) { tracking = false; return; } // 纵向滚动优先
      if (!startOpen && dx < 0) { tracking = false; return; } // 关闭态只响应右滑
      if (startOpen && dx > 0) { tracking = false; return; } // 打开态只响应左滑
      dragging = true;
      drawer.classList.add('ai-noanim'); wrap.classList.add('ai-noanim');
      if (!startOpen) { drawer.classList.add('open'); peek.classList.add('show'); }
    }
    const w = W();
    const p = startOpen ? Math.max(0, Math.min(1, 1 + dx / w)) : Math.max(0, Math.min(1, dx / w));
    setPos(p);
  }, { passive: true });

  const finish = (e) => {
    if (!tracking) return;
    tracking = false;
    if (!dragging) return;
    dragging = false;
    const dx = (e.changedTouches ? e.changedTouches[0].clientX : sx) - sx;
    const w = W();
    const p = startOpen ? Math.max(0, Math.min(1, 1 + dx / w)) : Math.max(0, Math.min(1, dx / w));
    drawer.classList.remove('ai-noanim'); wrap.classList.remove('ai-noanim');
    clearPos();
    if (p >= 0.4) { renderDrawerTab(page); drawer.classList.add('open'); peek.classList.add('show'); }
    else closeDrawer();
  };
  wrap.addEventListener('touchend', finish);
  wrap.addEventListener('touchcancel', finish);
}

/* ================= 抽屉：历史会话 / AI模型 / 智能体 / 灵感广场 ================= */
function renderDrawerTab(page) {
  const box = $('#ai-dtab-content', page);
  if (!box) return;
  if (drawerTab === 'history') renderDrawerSessions(page, box, $('#ai-dsearch-input', page).value || '');
  else if (drawerTab === 'models') renderDrawerModels(page, box);
  else if (drawerTab === 'agents') renderDrawerAgents(page, box);
  else renderDrawerInspire(page, box);
}

async function renderDrawerModels(page, box) {
  const types = drawerFilter === 'all' ? ['chat', 'image', 'video'] : [drawerFilter];
  const html = [];
  for (const p of PROVIDERS) {
    const rows = [];
    for (const t of types) {
      let ms = t === 'chat' ? (p.models || []) : t === 'image' ? (p.image || []) : (p.video || []);
      if (t === 'chat') {
        const synced = await getSyncedModels(p.id);
        // 过滤不可用/非对话的同步模型
        ms = ms.concat(synced.filter(m => !ms.includes(m) && !(p.deprecated || []).includes(m) && isChatModel(m)));
      }
      ms.forEach(m => rows.push({ t, m }));
    }
    if (!rows.length) continue;
    const hasKey = !!(await getApiKey(p.id));
    const cur = rows.find(r => (r.t === 'chat' && r.m === currentModel.model && p.id === currentModel.providerId)
      || (r.t === 'image' && r.m === imageModel.model && p.id === imageModel.providerId)
      || (r.t === 'video' && r.m === videoModel.model && p.id === videoModel.providerId));
    html.push(`
      <div class="ai-dm-vendor">
        <button class="ai-dm-vhead" data-vhead>
          ${vendorIcon(p.id)}<span class="ellipsis grow">${esc(p.name)}</span>
          <span class="ai-dm-count">${rows.length}</span>
          ${hasKey ? '<span class="tag tag-green">已配置</span>' : ''}
          <span class="ai-dm-chev">${icon('arrowR')}</span>
        </button>
        <div class="ai-dm-items" hidden>
        ${rows.map(r => `<button class="ai-dm-item ${cur === r ? 'on' : ''}" data-p="${p.id}" data-m="${esc(r.m)}" data-t="${r.t}">
          <span class="ai-dm-type ${r.t}">${r.t === 'chat' ? '聊' : r.t === 'image' ? '图' : '视'}</span>
          <span class="ellipsis">${esc(r.m)}</span>
          ${cur === r ? icon('check') : ''}
        </button>`).join('')}
        </div>
      </div>`);
  }
  box.innerHTML = html.join('') || '<div class="ai-drawer-empty">没有匹配的模型</div>';
  $$('.ai-dm-vendor', box).forEach((v) => {
    const head = $('[data-vhead]', v), items = $('.ai-dm-items', v);
    head.onclick = () => {
      const open = items.hidden;
      items.hidden = !open;
      v.classList.toggle('open', open);
    };
  });
  $$('.ai-dm-item', box).forEach(b => b.onclick = async () => {
    const sel = { providerId: b.dataset.p, model: b.dataset.m };
    const t = b.dataset.t;
    if (t === 'chat') { currentModel = sel; await kvSet('ai:last-model', sel); if (currentMode !== 'single') { currentMode = 'single'; kvSet('ai:last-mode', 'single'); } }
    else if (t === 'image') { imageModel = sel; await kvSet('ai:image-model', sel); }
    else { videoModel = sel; await kvSet('ai:video-model', sel); }
    setWorkspace(page, t);
    page.__closeDrawer && page.__closeDrawer();
    toast('已切换到 ' + sel.model, 'ok');
  });
}

/* 智能体工作室 hooks（闭包访问会话状态） */
function makeAgentHooks(page) {
  return {
    model: () => currentModel,
    begin: (agent) => {
      newSession(agent);
      if (agent.cat === 'image') setWorkspace(page, 'image');
      else if (agent.cat === 'video') setWorkspace(page, 'video');
      else setWorkspace(page, 'chat');
      renderMessages(page);
      toast('已进入智能体：' + agent.name, 'ok');
    },
    pushUser: (text) => { session.messages.push({ role: 'user', content: text, ts: Date.now() }); },
    pushAssistant: (m) => { session.messages.push(m); },
    save: () => saveSession(),
    refresh: () => renderMessages(page),
    gotoWorkspace: (ws, prompt) => {
      setWorkspace(page, ws);
      const ta = $('.ai-textarea', page);
      ta.value = prompt;
      ta.dispatchEvent(new Event('input'));
      renderMessages(page);
      toast('提示词已填入，点击发送开始创作', 'ok');
    },
  };
}

/* 灵感作品 → 切换模型/工作区并填入提示词 */
async function useInspireWork(page, work) {
  const t = work.type || 'chat';
  if (work.model) {
    const sel = { providerId: work.model.providerId, model: work.model.model };
    if (t === 'image') { imageModel = sel; await kvSet('ai:image-model', sel); }
    else if (t === 'video') { videoModel = sel; await kvSet('ai:video-model', sel); }
    else {
      currentModel = sel; await kvSet('ai:last-model', sel);
      if (currentMode !== 'single') { currentMode = 'single'; kvSet('ai:last-mode', 'single'); }
    }
  }
  page.__closeDrawer && page.__closeDrawer();
  setWorkspace(page, t);
  const ta = $('.ai-textarea', page);
  ta.value = work.p;
  ta.dispatchEvent(new Event('input'));
  renderMessages(page);
  toast(work.model ? '已切换模型并填入提示词' : '提示词已填入', 'ok');
}

function renderDrawerAgents(page, box) {
  const list = AGENTS;
  box.innerHTML = `<div class="ai-dagent-grid">${list.map(a => `
    <button class="ai-dagent" data-aid="${a.id}">
      <span class="ai-dagent-ico">${icon(a.icon)}</span>
      <span class="ai-dagent-name">${esc(a.name)}</span>
      <span class="ai-dagent-desc">${esc(a.desc)}</span>
      ${a.steps ? `<span class="ai-dagent-steps">${a.steps.length} 步工作流</span>` : ''}
    </button>`).join('')}</div>`;
  $$('.ai-dagent', box).forEach(b => b.onclick = () => {
    const agent = AGENTS.find(a => a.id === b.dataset.aid);
    if (!agent) return;
    page.__closeDrawer && page.__closeDrawer();
    openAgentStudio(page, agent, makeAgentHooks(page));
  });
}

function renderDrawerInspire(page, box) {
  const works = [];
  INSPIRATIONS.forEach((g) => {
    const type = g.image ? 'image' : g.video ? 'video' : 'chat';
    g.cards.forEach((c) => works.push({ t: c.t, p: c.p, type, model: c.model || null, self: !!c.self, source: '官方精选' }));
  });
  box.innerHTML = `
    <button class="ai-di-open" data-a="open-inspire">${icon('sparkle')}<span class="grow" style="text-align:left">打开灵感广场</span><span class="muted">成品示例 · 上传分享</span>${icon('arrowR')}</button>
    <div class="ai-di-cards">${works.map((w, i) => `
      <button class="ai-di-card" data-i="${i}">
        <span class="ai-di-t">${esc(w.t)}</span>
        <span class="ai-di-p ellipsis">${esc(w.p)}</span>
        <span class="ai-di-meta">${w.type === 'image' ? '图片' : w.type === 'video' ? '视频' : '聊天'}${w.model ? ' · ' + esc(w.model.model) : ' · 自创'}</span>
      </button>`).join('')}</div>`;
  $('[data-a="open-inspire"]', box).onclick = () => {
    page.__closeDrawer && page.__closeDrawer();
    showInspirePage(page, { useWork: (w) => useInspireWork(page, w) });
  };
  $$('.ai-di-card', box).forEach(b => b.onclick = () => {
    const w = works[+b.dataset.i];
    if (w) showInspireDetail(page, w, { useWork: (x) => useInspireWork(page, x) });
  });
}

/* ================= 会话管理 ================= */
async function newSession(agent = null) {
  session = { id: uid(), title: agent ? agent.name : '新对话', createdAt: Date.now(), messages: [] };
  if (agent) { session.system = agent.system; session.agentId = agent.id; }
  session.settings = await kvGet('ai:chat-def', {});
}

/* 供高级设置中心打开的当前会话对话设置 */
export async function openChatSettings(page) {
  showChatSettings(page, session, () => { applySessionBg(page); updateTopbar(page); });
}

async function saveSession() {
  if (!session.messages.length) return; // 空会话不保存
  if (!session.agentId) {
    const first = session.messages.find((m) => m.role === 'user');
    session.title = first ? String(first.content).slice(0, 30) : '新对话';
  }
  session.updatedAt = Date.now();
  session.model = currentModel;
  session.mode = currentMode;
  await db.put('chats', JSON.parse(JSON.stringify(session)));
}

async function renderDrawerSessions(page, box, kw = '') {
  if (!box) return;
  const key = (kw || '').trim().toLowerCase();
  let list = (await db.all('chats'))
    .filter((s) => !s.deletedAt) // 回收站中的会话不出现在历史列表
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (key) list = list.filter(s => (s.title || '').toLowerCase().includes(key) ||
    (s.messages || []).some(m => typeof m.content === 'string' && m.content.toLowerCase().includes(key)));
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = `<div class="ai-drawer-empty">${key ? '没有匹配的会话' : '暂无历史会话'}</div>`; return; }

  const rerender = () => renderDrawerSessions(page, box, kw);
  const pinned = list.filter((s) => s.pinned);
  const normal = list.filter((s) => !s.pinned);

  /* 置顶区（可折叠，默认状态可在 AI 设置中配置） */
  if (pinned.length) {
    const pinOpen = await kvGet('ai:pin-open', true);
    const open = box.__pinOpen != null ? box.__pinOpen : pinOpen;
    box.__pinOpen = open;
    const head = el(`<button class="ai-pin-head">
      ${icon('pin')}<span>置顶</span><span class="muted">${pinned.length}</span>
      <span class="ai-pin-arrow ${open ? 'open' : ''}">${icon('arrowR')}</span>
    </button>`);
    head.onclick = () => { box.__pinOpen = !box.__pinOpen; rerender(); };
    box.appendChild(head);
    if (open) pinned.forEach((s) => box.appendChild(buildSessionItem(page, s, rerender)));
  }
  normal.forEach((s) => box.appendChild(buildSessionItem(page, s, rerender)));
}

/* 单个会话条目：点击打开 · 长按/右键弹出操作菜单 · 删除进回收站 */
function buildSessionItem(page, s, rerender) {
  const item = el(`<button class="ai-session ${s.id === session.id ? 'on' : ''}">
    <span class="ai-session-ico">${icon(s.agentId ? (AGENTS.find(a => a.id === s.agentId) || {}).icon || 'robot' : 'robot')}</span>
    <span class="ai-session-info">
      <span class="ai-session-title ellipsis">${s.pinned ? icon('pin') : ''}${esc(s.title)}</span>
      <span class="ai-session-date">${fmtDate(s.updatedAt || s.createdAt, true)}</span>
    </span>
    <span class="ai-session-del" data-del>${icon('trash')}</span>
  </button>`);

  const openSession = () => {
    session = s;
    if (s.model) { currentModel = s.model; }
    if (s.mode) { currentMode = s.mode; }
    updateTopbar(page);
    page.__closeDrawer && page.__closeDrawer();
    renderMessages(page);
  };

  item.onclick = (e) => { if (e.target.closest('[data-del]')) return; openSession(); };

  const doDelete = async () => {
    if (!(await confirmDialog('删除该会话？', `将移入回收站，${await recycleDays()} 天后自动彻底清除`, '删除', true))) return;
    await trashChat(s);
    toast('已移入回收站', 'ok');
    rerender();
  };
  $('[data-del]', item).onclick = async (e) => { e.stopPropagation(); await doDelete(); };

  /* 长按（移动端）/ 右键（桌面端）→ 紧凑锚点菜单（Kimi 式小弹窗） */
  let lpTimer = null, lpFired = false, menuOpen = false;
  const showMenu = (px, py) => {
    if (menuOpen) return;   // 守卫：防止长按计时器与 contextmenu 双触发
    menuOpen = true;
    const acts = [
      { v: 'rename', ico: 'edit', name: '重命名' },
      { v: 'multi', ico: 'checkbox', name: '多选' },
      { v: 'pin', ico: s.pinned ? 'pinOff' : 'pin', name: s.pinned ? '取消置顶' : '置顶' },
      { v: 'del', ico: 'trash', name: '删除', danger: true },
    ];
    const mask = el('<div class="ctx-mask"></div>');
    const pop = el(`<div class="ctx-pop">${acts.map((a) => `<button class="ctx-item${a.danger ? ' danger' : ''}" data-v="${a.v}">${icon(a.ico)}<span>${a.name}</span></button>`).join('')}</div>`);
    document.body.appendChild(mask);
    document.body.appendChild(pop);
    /* 定位：优先条目上方，空间不足放下方 */
    const rect = item.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = (px != null ? px : rect.left + rect.width / 2) - pw / 2;
    left = Math.max(8, Math.min(left, vw - pw - 8));
    let top = rect.top - ph - 8;
    if (top < 8) top = Math.min(rect.bottom + 8, vh - ph - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    const close = (v) => {
      menuOpen = false;
      mask.remove();
      pop.remove();
      if (v) handleAction(v);
    };
    mask.onclick = () => close(null);
    $$('.ctx-item', pop).forEach((b) => b.onclick = () => close(b.dataset.v));
  };
  const handleAction = async (v) => {
    if (v === 'rename') {
      const b2 = el(`<div>${formRow('会话名称', `<input class="input" data-f="t" value="${esc(s.title || '')}" maxlength="40">`)}</div>`);
      const m2 = modal({
        title: '重命名会话', body: b2,
        footer: '<button class="btn grow" data-a="c">取消</button><button class="btn btn-primary grow" data-a="ok">保存</button>',
      });
      $('[data-a="c"]', m2.mask).onclick = m2.close;
      $('[data-a="ok"]', m2.mask).onclick = async () => {
        const t = $('[data-f="t"]', b2).value.trim();
        if (!t) { toast('名称不能为空'); return; }
        s.title = t;
        await db.put('chats', JSON.parse(JSON.stringify(s)));
        m2.close();
        if (s.id === session.id) updateTopbar(page);
        rerender();
      };
    } else if (v === 'multi') {
      page.__closeDrawer && page.__closeDrawer();
      showSessionManager(page, s.id);
    } else if (v === 'pin') {
      s.pinned = !s.pinned;
      if (s.pinned) s.pinnedAt = Date.now();
      await db.put('chats', JSON.parse(JSON.stringify(s)));
      toast(s.pinned ? '已置顶' : '已取消置顶', 'ok');
      rerender();
    } else if (v === 'del') {
      await doDelete();
    }
  };
  item.addEventListener('touchstart', (e) => {
    lpFired = false;
    const t = e.touches && e.touches[0];
    lpTimer = setTimeout(() => { lpFired = true; showMenu(t && t.clientX, t && t.clientY); }, 500);
  }, { passive: true });
  item.addEventListener('touchend', () => clearTimeout(lpTimer));
  item.addEventListener('touchmove', () => clearTimeout(lpTimer));
  item.addEventListener('click', (e) => { if (lpFired) { e.stopImmediatePropagation(); lpFired = false; } }, true);
  item.addEventListener('contextmenu', (e) => { e.preventDefault(); showMenu(e.clientX, e.clientY); });
  return item;
}

/* ================= 多选管理页（移动端 + 桌面端自适应） ================= */
function showSessionManager(page, preselectId = null) {
  openOverlay({
    title: '管理会话',
    build: async (body) => {
      body.innerHTML = `
        <div class="sm-toolbar">
          <button class="btn btn-sm" data-a="selall">全选</button>
          <span class="grow sm-count">已选择 0 条</span>
          <button class="btn btn-sm" data-a="pin" disabled>置顶</button>
          <button class="btn btn-sm btn-danger" data-a="del" disabled>删除</button>
        </div>
        <div class="col gap8" id="sm-list"></div>`;
      const listBox = $('#sm-list', body);
      const selected = new Set();
      if (preselectId) selected.add(preselectId);
      let sessions = [];

      async function renderList() {
        sessions = (await db.all('chats')).filter((s) => !s.deletedAt)
          .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
        listBox.innerHTML = sessions.length ? '' : '<div class="ai-drawer-empty" style="padding:40px 0">暂无历史会话</div>';
        sessions.forEach((s) => {
          const on = selected.has(s.id);
          const row = el(`<button class="list-item sm-row ${on ? 'sel' : ''}" style="width:100%">
            <span class="sm-check">${on ? icon('checkbox') : ''}</span>
            <span class="ai-session-ico">${icon(s.agentId ? (AGENTS.find(a => a.id === s.agentId) || {}).icon || 'robot' : 'robot')}</span>
            <div class="grow" style="text-align:left;min-width:0">
              <div style="font-size:14px;font-weight:600" class="ellipsis">${s.pinned ? icon('pin') : ''}${esc(s.title || '未命名会话')}</div>
              <div class="muted">${fmtDate(s.updatedAt || s.createdAt, true)} · ${(s.messages || []).length} 条消息</div>
            </div>
          </button>`);
          row.onclick = () => {
            if (selected.has(s.id)) selected.delete(s.id); else selected.add(s.id);
            renderList();
          };
          listBox.appendChild(row);
        });
        const n = selected.size;
        $('.sm-count', body).textContent = `已选择 ${n} 条`;
        $('[data-a="del"]', body).disabled = !n;
        $('[data-a="pin"]', body).disabled = !n;
      }

      $('[data-a="selall"]', body).onclick = () => {
        if (selected.size >= sessions.length) selected.clear();
        else sessions.forEach((s) => selected.add(s.id));
        renderList();
      };
      $('[data-a="del"]', body).onclick = async () => {
        const n = selected.size;
        if (!n) return;
        if (!(await confirmDialog(`删除选中的 ${n} 条会话？`, `将移入回收站，${await recycleDays()} 天后自动彻底清除`, '删除', true))) return;
        for (const s of sessions) if (selected.has(s.id)) await trashChat(s);
        toast(`已将 ${n} 条会话移入回收站`, 'ok');
        selected.clear();
        renderList();
      };
      $('[data-a="pin"]', body).onclick = async () => {
        for (const s of sessions) if (selected.has(s.id) && !s.pinned) { s.pinned = true; s.pinnedAt = Date.now(); await db.put('chats', JSON.parse(JSON.stringify(s))); }
        toast('已置顶所选会话', 'ok');
        selected.clear();
        renderList();
      };
      renderList();
    },
  });
}

/* ================= 附件（图片 + 文本文件，展示在输入文字上方） ================= */
function bindChipX(page, chip) {
  const strip = $('#ai-attach-strip', page);
  $('[data-x]', chip).onclick = () => {
    if (chip.dataset.ref) attachTexts.delete(chip.dataset.ref);
    chip.remove();
    if (!strip.children.length) strip.hidden = true;
    updateInputBar(page);
  };
}

function addImageFiles(page, files) {
  if (!files || !files.length) return;
  const strip = $('#ai-attach-strip', page);
  [...files].slice(0, 4).forEach((f) => {
    if (!f.type.startsWith('image/')) { toast('仅支持图片文件', 'err'); return; }
    const rd = new FileReader();
    rd.onload = () => {
      strip.hidden = false;
      const chip = el(`<span class="ai-attach-chip" data-kind="image"><img src="${rd.result}"><span class="ai-attach-x" data-x>${icon('close')}</span></span>`);
      chip.dataset.url = rd.result;
      bindChipX(page, chip);
      strip.appendChild(chip);
      updateInputBar(page);
    };
    rd.readAsDataURL(f);
  });
}

function addTextAttachment(page, name, text) {
  const strip = $('#ai-attach-strip', page);
  const ref = uid();
  attachTexts.set(ref, { name, text });
  strip.hidden = false;
  const chip = el(`<span class="ai-attach-chip text-chip" data-kind="text" data-ref="${ref}" title="${esc(name)}">
    <span class="ai-attach-file-ico">${icon('file')}</span>
    <span class="ai-attach-file-name ellipsis">${esc(name)}</span>
    <span class="ai-attach-x" data-x>${icon('close')}</span>
  </span>`);
  bindChipX(page, chip);
  strip.appendChild(chip);
  updateInputBar(page);
}

function takeAttachments(page) {
  const strip = $('#ai-attach-strip', page);
  const images = [], files = [];
  $$('.ai-attach-chip', strip).forEach((c) => {
    if (c.dataset.kind === 'text') {
      const f = attachTexts.get(c.dataset.ref);
      if (f) files.push(f);
      attachTexts.delete(c.dataset.ref);
    } else images.push(c.dataset.url);
  });
  strip.innerHTML = ''; strip.hidden = true;
  return { images, files };
}

/* ================= 输入栏状态（空→仅语音键；发送中→方形停止键） ================= */
function updateInputBar(page) {
  const ta = $('.ai-textarea', page);
  const sendBtn = $('[data-a="send"]', page);
  const voiceBtn = $('[data-a="voice"]', page);
  if (!ta || !sendBtn) return;
  if (sending) {
    sendBtn.hidden = false;
    sendBtn.classList.add('stop');
    sendBtn.innerHTML = '<span class="ai-stop-square"></span>';
    if (voiceBtn) voiceBtn.hidden = true;
    return;
  }
  sendBtn.classList.remove('stop');
  sendBtn.innerHTML = icon('send');
  const hasText = !!ta.value.trim();
  const hasAttach = !!$$('.ai-attach-chip', page).length;
  sendBtn.hidden = !(hasText || hasAttach);
  if (voiceBtn) voiceBtn.hidden = hasText || hasAttach || workspace !== 'chat';
}

/* ================= 按住说话 ================= */
function enterVoiceBar(page) {
  if (workspace !== 'chat') return;
  $('#ai-input-row', page).hidden = true;
  $('#ai-voicebar', page).hidden = false;
}
function exitVoiceBar(page) {
  stopRecognition();
  $('#ai-voicebar', page).hidden = true;
  $('#ai-input-row', page).hidden = false;
  $('#ai-voice-hint', page).hidden = true;
  const hold = $('#ai-hold', page);
  hold.classList.remove('recording', 'canceling');
  hold.textContent = '按住 说话';
}

function bindHoldToTalk(page) {
  const hold = $('#ai-hold', page);
  const hint = $('#ai-voice-hint', page);
  const ta = $('.ai-textarea', page);
  let baseText = '', recognized = '', startY = 0, canceling = false, active = false;
  let recorder = null; // 模型 ASR 模式

  const done = (txt) => {
    // 识别完成：写入输入框（可编辑）并退出语音条，露出发送键
    if (txt) {
      ta.value = baseText + txt;
      ta.dispatchEvent(new Event('input'));
    }
    exitVoiceBar(page);
    ta.focus();
  };

  hold.addEventListener('pointerdown', async (e) => {
    e.preventDefault();
    hold.setPointerCapture(e.pointerId);
    active = true; canceling = false;
    baseText = ta.value ? ta.value + ' ' : '';
    recognized = '';
    startY = e.clientY;
    const asr = await kvGet('ai:asr', { engine: 'browser' });
    if (asr.engine === 'model' && asr.providerId && asr.model) {
      // 模型 ASR：录音 → /audio/transcriptions
      recorder = await startRecorder();
      if (!recorder) {
        toast('无法访问麦克风，请授权', 'err');
        active = false; recorder = null; return;
      }
      hold.classList.add('recording');
      hold.textContent = '正在录音…';
      hint.hidden = false;
      return;
    }
    const ok = startRecognition({
      continuous: true,
      onResult: (final, interim) => {
        recognized = final || interim;
        hold.textContent = recognized ? recognized.slice(-12) : '正在聆听…';
      },
      onEnd: () => {},
      onError: (err) => {
        toast(err && err.message === 'not-allowed' ? '请授权麦克风权限' : '语音识别不可用，已取消', 'err');
        active = false;
        hold.classList.remove('recording');
        hold.textContent = '按住 说话';
        hint.hidden = true;
      },
    });
    if (!ok) { active = false; return; }
    hold.classList.add('recording');
    hint.hidden = false;
  });
  hold.addEventListener('pointermove', (e) => {
    if (!active) return;
    const dy = startY - e.clientY;
    canceling = dy > 60;
    hold.classList.toggle('canceling', canceling);
    hint.textContent = canceling ? '松开取消' : '松开发送 · 上滑取消';
  });
  const finish = async () => {
    if (!active) return;
    active = false;
    hold.classList.remove('recording', 'canceling');
    hint.hidden = true;
    if (recorder) {
      const rec = recorder; recorder = null;
      hold.textContent = '按住 说话';
      if (canceling) { rec.cancel(); return; }
      const blob = await rec.stop();
      if (!blob || !blob.size) { toast('录音为空', 'err'); return; }
      const asr = await kvGet('ai:asr', { engine: 'browser' });
      hold.textContent = '识别中…';
      try {
        const txt = await transcribeAudio({ providerId: asr.providerId, model: asr.model, blob, lang: asr.lang });
        done((txt || '').trim());
      } catch (err) {
        toast('模型识别失败：' + err.message, 'err');
        exitVoiceBar(page);
      }
      return;
    }
    stopRecognition();
    hold.textContent = '按住 说话';
    if (!canceling && recognized) done(recognized);
  };
  hold.addEventListener('pointerup', finish);
  hold.addEventListener('pointercancel', finish);
}

/* ================= 停止对话 ================= */
async function confirmStop() {
  const ok = await confirmDialog('是否停止对话', '正在生成的回答将被中断', '确认', true);
  if (ok && abortCtl) abortCtl.abort();
}

/* ================= 打字机 ================= */
function makeTypewriter(renderFn) {
  let acc = '', shown = 0, timer = null, done = false;
  const tick = () => {
    const pending = acc.length - shown;
    if (pending <= 0) { timer = null; if (done) renderFn(acc, true); return; }
    const step = Math.max(1, Math.ceil(pending / 10));
    shown += step;
    renderFn(acc.slice(0, shown), false);
    timer = setTimeout(tick, 28);
  };
  return {
    push(chunk, full) { acc = full !== undefined ? full : acc + chunk; if (!timer) timer = setTimeout(tick, 0); },
    flush() { done = true; if (timer) { clearTimeout(timer); timer = null; } shown = acc.length; renderFn(acc, true); },
    text() { return acc; },
  };
}

/* ================= 思考块（默认折叠，点击展开） ================= */
function createThink(bubble, reasoning = '') {
  const wrap = el(`<div class="think">
    <button class="think-head">${icon('sparkle')}<span class="think-title">正在深度思考…</span><span class="think-chev">${icon('arrowR')}</span></button>
    <div class="think-body">${esc(reasoning)}</div>
  </div>`);
  const content = el('<div class="msg-content"></div>');
  bubble.innerHTML = '';
  bubble.appendChild(wrap);
  bubble.appendChild(content);
  $('.think-head', wrap).onclick = () => wrap.classList.toggle('open');
  return {
    content,
    push(r) { $('.think-body', wrap).textContent += r; },
    done() { $('.think-title', wrap).textContent = '已深度思考'; },
    setReasoning(r) { $('.think-body', wrap).textContent = r; },
  };
}

/* ================= 消息渲染 ================= */
function renderMessages(page) {
  const box = $('#ai-messages', page);
  box.innerHTML = '';
  applySessionBg(page);
  if (!session.messages.length) {
    if (workspace !== 'chat') {
      const isImg = workspace === 'image';
      box.innerHTML = `<div class="ai-welcome">
        <div class="ai-welcome-logo">${icon(isImg ? 'image' : 'film')}</div>
        <div class="ai-welcome-title">${isImg ? 'AI 图片工作区' : 'AI 视频工作区'}</div>
        <div class="ai-welcome-sub">当前模型：${esc((isImg ? imageModel : videoModel).model)} · 在下方描述你想要的${isImg ? '画面' : '镜头'}</div>
      </div>`;
      return;
    }
    const SUGGESTIONS = [
      { ico: 'edit', t: '写作助手', d: '润色、改写、起标题', p: '帮我润色这段话：' },
      { ico: 'cpu', t: '代码帮手', d: '写代码、查错、讲解', p: '帮我写一段代码：' },
      { ico: 'book', t: '学习问答', d: '概念讲解、知识梳理', p: '请用通俗的语言解释：' },
      { ico: 'sparkle', t: '头脑风暴', d: '创意点子、方案对比', p: '帮我想几个点子，主题：' },
    ];
    box.innerHTML = `<div class="ai-welcome">
      <div class="ai-welcome-logo">${icon('robot')}</div>
      <div class="ai-welcome-title">有什么可以帮你？</div>
      <div class="ai-welcome-sub">当前模型：${esc(currentModel.model)} · ${esc(providerById(currentModel.providerId).name)}</div>
      <div class="ai-welcome-cards">
        ${SUGGESTIONS.map((s, i) => `<button class="ai-welcome-card" data-sug="${i}">
          <span class="ai-welcome-card-ico">${icon(s.ico)}</span>
          <span class="ai-welcome-card-t">${s.t}</span>
          <span class="ai-welcome-card-d">${s.d}</span>
        </button>`).join('')}
      </div>
    </div>`;
    $$('.ai-welcome-card', box).forEach((b) => b.onclick = () => {
      const ta = $('.ai-textarea', page);
      ta.value = SUGGESTIONS[+b.dataset.sug].p;
      ta.dispatchEvent(new Event('input'));
      ta.focus();
    });
    return;
  }
  session.messages.forEach((m, i) => appendMessage(page, m, i));
  scrollBottom(page);
}

function appendMessage(page, m, msgIndex = -1) {
  const box = $('#ai-messages', page);
  const empty = $('.empty, .ai-welcome', box);
  if (empty) empty.remove();

  if (m.role === 'compare') {
    const grid = el(`<div class="msg assistant"><div class="msg-body" style="max-width:100%"><div class="compare-grid"></div></div></div>`);
    const g = $('.compare-grid', grid);
    m.results.forEach((r) => {
      const cell = el(`<div class="compare-cell">
        <div class="compare-head">${vendorIcon(r.providerId)}<span class="ellipsis">${esc(r.model)}</span></div>
        <div class="compare-content" style="font-size:14px;line-height:1.7"></div>
      </div>`);
      $('.compare-content', cell).innerHTML = r.error ? `<span style="color:var(--danger)">${esc(r.error)}</span>` : renderMarkdown(r.text);
      g.appendChild(cell);
    });
    box.appendChild(grid);
    bindCopyButtons(grid);
    scrollBottom(page);
    return { wrap: grid, bubble: $('.compare-grid', grid) };
  }

  const isUser = m.role === 'user';
  const wrap = el(`<div class="msg ${isUser ? 'user' : 'assistant'}">
    <div class="msg-avatar">${isUser ? userAvatarHtml() : vendorIcon(m.providerId || currentModel.providerId)}</div>
    <div class="msg-body">
      <div class="msg-meta">${m.debateRole ? `<span class="debate-side debate-${m.debateRole}">${m.debateRole === 'pro' ? '正方' : m.debateRole === 'con' ? '反方' : '裁判'}</span>` : ''}<span>${esc(m.model || '')}</span>${m.ms ? `<span class="msg-ms">${m.ms}ms</span>` : ''}</div>
      <div class="msg-bubble"></div>
      ${isUser ? '' : '<div class="msg-actions"><button class="msg-act" data-act="copy" title="复制">' + icon('copy') + '</button><button class="msg-act" data-act="speak" title="朗读">' + icon('speaker') + '</button></div>'}
    </div>
  </div>`);
  const bubble = $('.msg-bubble', wrap);
  if (m.video) bubble.innerHTML = `<div>${esc(m.content || '')}</div><video src="${m.video}" controls playsinline style="max-width:100%;border-radius:10px"></video>`;
  else if (m.image) bubble.innerHTML = `<div>${esc(m.content || '')}</div><img src="${m.image}" alt="生成图片">`;
  else if (isUser && ((m.images && m.images.length) || (m.files && m.files.length))) {
    bubble.innerHTML =
      (m.images && m.images.length ? `<div class="msg-imgs">${m.images.map((u) => `<img src="${u}">`).join('')}</div>` : '')
      + (m.files && m.files.length ? m.files.map((f) => `<div class="msg-file-chip">${icon('file')}<span class="ellipsis">${esc(f.name)}</span></div>`).join('') : '')
      + `<div>${esc(m.content)}</div>`;
  }
  else if (isUser) bubble.textContent = m.content;
  else if (m.reasoning) {
    const th = createThink(bubble, m.reasoning);
    th.done();
    th.content.innerHTML = renderMarkdown(m.content);
  }
  else bubble.innerHTML = renderMarkdown(m.content);
  bindCopyButtons(wrap);
  const copyBtn = $('[data-act="copy"]', wrap);
  if (copyBtn) copyBtn.onclick = () => { navigator.clipboard.writeText(m.content).then(() => toast('已复制')); };
  const speakBtn = $('[data-act="speak"]', wrap);
  if (speakBtn) speakBtn.onclick = () => speak(m.content);

  if (isUser && msgIndex >= 0) bindLastUserEdit(page, wrap, msgIndex);
  box.appendChild(wrap);
  scrollBottom(page);
  return { wrap, bubble };
}

/* 长按最后一条用户消息 → 重新编辑（仅最近一条） */
function bindLastUserEdit(page, wrap, idx) {
  const isLastUser = (() => {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') return i === idx;
    }
    return false;
  })();
  if (!isLastUser) return;
  const bubble = $('.msg-bubble', wrap);
  bubble.classList.add('msg-editable');
  let timer = null;
  const start = (e) => {
    if (sending) return;
    timer = setTimeout(() => reEdit(), 520);
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  bubble.addEventListener('touchstart', start, { passive: true });
  bubble.addEventListener('touchend', cancel);
  bubble.addEventListener('touchmove', cancel);
  bubble.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!sending) reEdit(); });
  async function reEdit() {
    const m = session.messages[idx];
    if (!m || m.role !== 'user') return;
    const ok = await confirmDialog('重新编辑该消息？', '将删除此消息及其后的所有回复', '编辑', false);
    if (!ok) return;
    const ta = $('.ai-textarea', page);
    ta.value = m.content || '';
    ta.dispatchEvent(new Event('input'));
    if (m.images && m.images.length) {
      const strip = $('#ai-attach-strip', page);
      m.images.forEach(u => {
        strip.hidden = false;
        const chip = el(`<span class="ai-attach-chip"><img src="${u}"><span class="ai-attach-x" data-x>${icon('close')}</span></span>`);
        chip.dataset.url = u;
        $('[data-x]', chip).onclick = () => { chip.remove(); if (!strip.children.length) strip.hidden = true; };
        strip.appendChild(chip);
      });
    }
    session.messages = session.messages.slice(0, idx);
    if (session.messages.length) await db.put('chats', JSON.parse(JSON.stringify(session)));
    else await db.del('chats', session.id).catch(() => {});
    renderMessages(page);
    ta.focus();
  }
}

function scrollBottom(page, force = false) {
  const box = $('#ai-messages', page);
  if (!box) return;
  if (userPinned && !force) return; // 用户上拉后钉住，不再自动滚底
  box.scrollTop = box.scrollHeight;
}

/* ================= 发送 ================= */
async function sendMessage(page) {
  const ta = $('.ai-textarea', page);
  let text = ta.value.trim();
  if (sending) return;
  const chips = $$('.ai-attach-chip', page);
  if (!text && !chips.length) return;
  if (!text) text = chips.some((c) => c.dataset.kind === 'text') ? '请阅读附件内容并回应' : '请描述这张图片';
  ta.value = ''; ta.style.height = 'auto';
  sending = true;
  updateInputBar(page);
  abortCtl = new AbortController();

  const at = takeAttachments(page);
  // 「记住…」自动写入记忆库
  if (/^(请?记住|remember)\s*[:：，, ]?/i.test(text) && await kvGet('ai:mem-on', false) && await kvGet('ai:mem-write', true)) {
    const memText = text.replace(/^(请?记住|remember)\s*[:：，, ]?/i, '').trim();
    if (memText) {
      const mems = await kvGet('ai:memories', []);
      mems.push({ id: Date.now(), text: memText, ts: Date.now() });
      await kvSet('ai:memories', mems);
      toast('已保存到记忆库', 'ok');
    }
  }
  const userMsg = {
    role: 'user', content: text,
    images: at.images.length ? at.images : undefined,
    files: at.files.length ? at.files : undefined,
    ts: Date.now(),
  };
  session.messages.push(userMsg);
  appendMessage(page, userMsg, session.messages.length - 1);
  userPinned = false; const jb = $('#ai-jump-btn', page); if (jb) jb.hidden = true;

  try {
    if (workspace === 'image') {
      await runImage(page, text);
    } else if (workspace === 'video') {
      await runVideo(page, text);
    } else {
      let webCtx = null;
      const webToggle = $('#ai-web-toggle', page);
      if (webToggle && webToggle.classList.contains('on') && currentMode === 'single' && await hasSearchConfig()) {
        toast('正在联网搜索…');
        try {
          const items = await searchWeb(text.replace(/【文件.*?】\n/s, '').slice(0, 200));
          if (items.length) webCtx = resultsToContext(text, items);
          else toast('未搜索到相关内容');
        } catch (e) { toast('联网搜索失败：' + e.message, 'err'); }
      }
      if (currentMode === 'single') await runSingle(page, text, webCtx);
      else if (currentMode === 'compare') await runCompare(page, text);
      else if (currentMode === 'debate') await runDebate(page, text);
      else if (currentMode === 'collab') await runCollab(page, text);
    }
    await saveSession();
  } catch (e) {
    if (e.name === 'AbortError') {
      await saveSession(); // 保留已生成的部分
    } else {
      if (e.needKey) { toast('请先配置 ' + providerById(e.needKey).name + ' 的 API Key'); showAISettings(e.needKey); }
      else if (/未配置 API Key/.test(e.message || '')) {
        const sel = workspace === 'image' ? imageModel : workspace === 'video' ? videoModel : currentModel;
        toast('请先配置 ' + providerById(sel.providerId).name + ' 的 API Key');
        showAISettings(sel.providerId);
      }
      else toast(e.message || '请求失败', 'err');
      const errMsg = { role: 'assistant', content: '⚠️ ' + (e.message || '请求失败'), ts: Date.now() };
      session.messages.push(errMsg);
      appendMessage(page, errMsg);
    }
  }
  sending = false;
  abortCtl = null;
  updateInputBar(page);
}

function isVisionModel(sel) {
  if (providerById(sel.providerId).type !== 'openai') return false;
  return /vl|vision|4o|4\.1|gemini|grok|pixtral|glm-4v|kimi-latest|qwen3|omni/i.test(sel.model || '');
}

async function historyMessages(limit = 20, sel = null) {
  const vision = sel && isVisionModel(sel);
  const msgs = session.messages
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.debateRole && !m.image && !m.video))
    .slice(-limit)
    .map((m) => {
      let text = m.content || '';
      if (m.role === 'user' && m.files && m.files.length) {
        text += m.files.map((f) => `\n\n【附件 ${f.name}】\n${String(f.text || '').slice(0, 6000)}`).join('');
      }
      if (m.role === 'user' && m.images && m.images.length) {
        if (vision) {
          return { role: 'user', content: [{ type: 'text', text: text || '请描述这张图片' }, ...m.images.map((u) => ({ type: 'image_url', image_url: { url: u } }))] };
        }
        return { role: 'user', content: text + '\n[用户上传了 ' + m.images.length + ' 张图片，当前模型不支持识图]' };
      }
      return { role: m.role, content: text };
    });
  // 系统提示：智能体 / 会话自定义 + 记忆注入
  let sys = (session.settings && session.settings.system) || session.system || '';
  const memOn = await kvGet('ai:mem-on', false);
  if (memOn) {
    const mems = await kvGet('ai:memories', []);
    if (mems.length) sys += (sys ? '\n\n' : '') + '【长期记忆】以下是关于用户的已知信息，请在对话中自然参考：\n' + mems.map((x) => '- ' + x.text).join('\n');
  }
  if (sys) msgs.unshift({ role: 'system', content: sys });
  return msgs;
}

/* 汇总采样参数：会话设置覆盖全局偏好 */
async function samplingParams() {
  const prefs = await getChatPrefs();
  const s = (session && session.settings) || {};
  const params = {};
  const temp = s.temperature != null ? s.temperature : (prefs.tempOn ? prefs.temperature : null);
  const topP = s.topP != null ? s.topP : (prefs.topPOn ? prefs.topP : null);
  if (temp != null) params.temperature = temp;
  if (topP != null) params.top_p = topP;
  if (s.maxTokens != null) params.max_tokens = s.maxTokens;
  if (prefs.usageInStream) params.stream_options = { include_usage: true };
  return params;
}

async function runSingle(page, text, webCtx = null) {
  const prefs = await getChatPrefs();
  const ctx = await getCtxConf();
  const s = session.settings || {};
  const ctxLimit = s.ctxLimit || ctx.ctxLimit || 20;
  const m = { role: 'assistant', content: '', model: currentModel.model, providerId: currentModel.providerId, ts: Date.now() };
  const { wrap, bubble } = appendMessage(page, m);
  bubble.classList.add('streaming');
  let think = null;
  let contentEl = bubble;
  const tw = makeTypewriter((t) => {
    contentEl.innerHTML = renderMarkdown(t);
    scrollBottom(page);
  });
  const t0 = Date.now();
  try {
    let msgs = await historyMessages(ctxLimit, currentModel);
    if (webCtx && msgs.length) {
      const li = msgs.length - 1;
      const last = msgs[li];
      if (last.role === 'user' && typeof last.content === 'string') {
        msgs = [...msgs.slice(0, -1), { role: 'user', content: webCtx + '\n\n用户问题：' + last.content }];
      } else if (last.role === 'user') {
        msgs = [...msgs.slice(0, -1), { role: 'user', content: [{ type: 'text', text: webCtx }, ...last.content] }];
      }
    }
    const streamOn = prefs.stream !== false;
    const { text: full, reasoning } = await chat({
      ...currentModel,
      messages: msgs,
      signal: abortCtl.signal,
      params: await samplingParams(),
      onReasoning: prefs.thinkSummary === false ? null : (chunk) => {
        if (!think) { think = createThink(bubble); contentEl = think.content; }
        think.push(chunk);
      },
      onToken: streamOn ? (chunk, acc) => { tw.push(null, acc); } : null,
    });
    tw.flush();
    if (!streamOn) contentEl.innerHTML = renderMarkdown(full);
    if (think) think.done();
    m.content = full;
    if (reasoning && prefs.cotReturn !== false) m.reasoning = reasoning;
    if (prefs.speedTest) m.ms = Date.now() - t0;
    // 上下文压缩提醒
    if (ctx.compressHint && session.messages.length >= (ctx.compressThreshold || 40)) {
      toast('当前会话上下文较长，建议开启新对话以获得更稳定的回答', 'err');
    }
  } catch (e) {
    tw.flush();
    if (think) think.done();
    if (e.name === 'AbortError') {
      m.content = tw.text() + '\n\n*（已手动停止）*';
      contentEl.innerHTML = renderMarkdown(m.content);
      if (m.content.trim()) session.messages.push(m);
      throw e;
    }
    throw e;
  } finally {
    bubble.classList.remove('streaming');
    bindCopyButtons(wrap);
  }
  session.messages.push(m);
  // 回复完成后自动朗读
  if (m.content && await kvGet('ai:tts-autoread', false)) {
    const rate = await kvGet('ai:tts-rate', 1), pitch = await kvGet('ai:tts-pitch', 1);
    speak(m.content, { rate, pitch }).catch(() => {});
  }
  // 自动生成话题标题（首轮问答后）
  autoTitle().catch(() => {});
}

/* 用当前/专用标题模型自动生成会话标题 */
async function autoTitle() {
  const ctx = await getCtxConf();
  if (!ctx.autoTitle) return;
  if (!session || session.messages.length !== 2) return;
  if (session.title && session.title !== '新对话' && session.agentId) return;
  const first = session.messages.find((x) => x.role === 'user');
  const reply = session.messages.find((x) => x.role === 'assistant');
  if (!first || !reply || !reply.content) return;
  const tm = await kvGet('ai:model-title', null);
  const use = tm || currentModel;
  try {
    const { text: t } = await chat({
      ...use,
      messages: [{ role: 'user', content: `请为以下对话起一个 10 字以内的简短标题，只输出标题本身，不要标点结尾：\n用户：${String(first.content).slice(0, 200)}\n助手：${String(reply.content).slice(0, 200)}` }],
    });
    const title = (t || '').trim().replace(/[。.\n]/g, '').slice(0, 20);
    if (title) { session.title = title; await saveSession(); }
  } catch (e) {}
}

async function runCompare(page, text) {
  const models = compareModels.length >= 2 ? compareModels : [currentModel];
  const m = { role: 'compare', results: models.map((x) => ({ ...x, text: '', error: null })), ts: Date.now() };
  const gridMsg = appendMessage(page, m);
  const cells = $$('.compare-content', gridMsg.wrap);
  const ctxL = ((session.settings || {}).ctxLimit) || (await getCtxConf()).ctxLimit || 20;
  await Promise.all(models.map(async (x, i) => {
    cells[i].classList.add('streaming');
    try {
      const { text: full } = await chat({
        ...x,
        messages: [...(await historyMessages(ctxL, x)).slice(0, -1), { role: 'user', content: text }],
        signal: abortCtl.signal,
        onToken: (c, acc) => { cells[i].innerHTML = renderMarkdown(acc); },
      });
      m.results[i].text = full;
    } catch (e) {
      m.results[i].error = e.name === 'AbortError' ? '已手动停止' : e.message;
      cells[i].innerHTML = `<span style="color:var(--danger)">${esc(m.results[i].error)}</span>`;
    } finally {
      cells[i].classList.remove('streaming');
      if (!m.results[i].error) cells[i].innerHTML = renderMarkdown(m.results[i].text);
    }
  }));
  session.messages.push(m);
}

async function runDebate(page, topic) {
  const models = compareModels.length >= 2 ? compareModels : [currentModel, currentModel];
  const pro = models[0], con = models[1], judge = models[2] || models[0];
  const rounds = 2;
  let proArgs = [], conArgs = [];

  for (let r = 0; r < rounds; r++) {
    const proMsg = { role: 'assistant', debateRole: 'pro', content: '', model: pro.model, providerId: pro.providerId, ts: Date.now() };
    let h1 = appendMessage(page, proMsg);
    h1.bubble.classList.add('streaming');
    const proPrompt = `你是辩论赛正方辩手。辩题：「${topic}」。${proArgs.length ? '你之前的论点：' + proArgs.join('；') + '。反方论点：' + conArgs.join('；') + '。请进行第 ' + (r + 1) + ' 轮陈词，反驳反方并强化己方观点' : '请进行开篇立论'}，150 字以内。`;
    const r1 = await chat({ ...pro, messages: [{ role: 'user', content: proPrompt }], signal: abortCtl.signal, onToken: (c, a) => { h1.bubble.innerHTML = renderMarkdown(a); scrollBottom(page); } });
    proMsg.content = r1.text; h1.bubble.classList.remove('streaming'); h1.bubble.innerHTML = renderMarkdown(r1.text);
    proArgs.push(r1.text);
    session.messages.push(proMsg);

    const conMsg = { role: 'assistant', debateRole: 'con', content: '', model: con.model, providerId: con.providerId, ts: Date.now() };
    let h2 = appendMessage(page, conMsg);
    h2.bubble.classList.add('streaming');
    const conPrompt = `你是辩论赛反方辩手。辩题：「${topic}」。正方最新论点：${r1.text}。${conArgs.length ? '你之前的论点：' + conArgs.join('；') + '。' : ''}请进行第 ${r + 1} 轮反驳陈词，150 字以内。`;
    const r2 = await chat({ ...con, messages: [{ role: 'user', content: conPrompt }], signal: abortCtl.signal, onToken: (c, a) => { h2.bubble.innerHTML = renderMarkdown(a); scrollBottom(page); } });
    conMsg.content = r2.text; h2.bubble.classList.remove('streaming'); h2.bubble.innerHTML = renderMarkdown(r2.text);
    conArgs.push(r2.text);
    session.messages.push(conMsg);
  }

  const judgeMsg = { role: 'assistant', debateRole: 'judge', content: '', model: judge.model, providerId: judge.providerId, ts: Date.now() };
  const hj = appendMessage(page, judgeMsg);
  hj.bubble.classList.add('streaming');
  const judgePrompt = `你是辩论赛裁判。辩题：「${topic}」。正方论点：${proArgs.join('；')}。反方论点：${conArgs.join('；')}。请点评双方表现并给出裁决与总结，200 字以内。`;
  const r3 = await chat({ ...judge, messages: [{ role: 'user', content: judgePrompt }], signal: abortCtl.signal, onToken: (c, a) => { hj.bubble.innerHTML = renderMarkdown(a); scrollBottom(page); } });
  judgeMsg.content = r3.text; hj.bubble.classList.remove('streaming'); hj.bubble.innerHTML = renderMarkdown(r3.text);
  session.messages.push(judgeMsg);
}

async function runCollab(page, text) {
  const models = compareModels.length >= 2 ? compareModels : [currentModel];
  const answers = [];
  const ctxL2 = ((session.settings || {}).ctxLimit) || (await getCtxConf()).ctxLimit || 20;
  for (const x of models) {
    const { text: full } = await chat({ ...x, messages: [...(await historyMessages(ctxL2, x)).slice(0, -1), { role: 'user', content: text }], signal: abortCtl.signal });
    answers.push({ model: x, text: full });
  }
  const editor = models[0];
  const m = { role: 'assistant', content: '', model: editor.model + '（协同汇总）', providerId: editor.providerId, ts: Date.now() };
  const { bubble } = appendMessage(page, m);
  bubble.classList.add('streaming');
  const tw = makeTypewriter((t) => { bubble.innerHTML = renderMarkdown(t); scrollBottom(page); });
  const prompt = `用户问题：「${text}」\n\n以下是 ${answers.length} 个 AI 的回答草稿：\n${answers.map((a, i) => `【草稿${i + 1}（${a.model.model}）】\n${a.text}`).join('\n\n')}\n\n请综合各草稿优点，输出一份最优的最终回答。`;
  try {
    const { text: final } = await chat({ ...editor, messages: [{ role: 'user', content: prompt }], signal: abortCtl.signal, onToken: (c, a) => tw.push(null, a) });
    tw.flush();
    m.content = final;
  } catch (e) {
    tw.flush();
    if (e.name === 'AbortError') {
      m.content = tw.text() + '\n\n*（已手动停止）*';
      bubble.innerHTML = renderMarkdown(m.content);
      if (m.content.trim()) session.messages.push(m);
      throw e;
    }
    throw e;
  } finally {
    bubble.classList.remove('streaming');
  }
  session.messages.push(m);
}

/* ================= 图片 / 视频工作区 ================= */
async function runImage(page, text) {
  const loading = { role: 'assistant', content: '', model: imageModel.model, providerId: imageModel.providerId, ts: Date.now() };
  const { bubble } = appendMessage(page, loading);
  bubble.classList.add('streaming');
  bubble.innerHTML = `<div class="ai-gen-hint">${icon('brush')} 正在生成图片（${imgRatio}）…</div>`;
  try {
    const url = await drawImage({
      providerId: imageModel.providerId, model: imageModel.model,
      prompt: text, size: RATIO_SIZE[imgRatio] || '1024x1024',
    });
    loading.content = text;
    loading.image = url;
    bubble.innerHTML = `<div>${esc(text)}</div><img src="${url}" alt="生成图片">`;
    session.messages.push(loading);
  } catch (e) {
    bubble.innerHTML = `<div class="ai-gen-hint err">⚠️ 绘画失败：${esc(e.message)}</div>`;
    throw e;
  } finally {
    bubble.classList.remove('streaming');
  }
}

async function runVideo(page, text) {
  const loading = { role: 'assistant', content: '', model: videoModel.model, providerId: videoModel.providerId, ts: Date.now() };
  const { bubble } = appendMessage(page, loading);
  bubble.classList.add('streaming');
  bubble.innerHTML = `<div class="ai-gen-hint">${icon('film')} 正在提交视频任务（${vidRatio} · ${vidDur}s）…</div>`;
  try {
    const url = await generateVideo({
      providerId: videoModel.providerId, model: videoModel.model,
      prompt: text, ratio: vidRatio, duration: vidDur,
      onProgress: (t) => { bubble.innerHTML = `<div class="ai-gen-hint">${icon('film')} ${esc(t || '视频生成中…')}</div>`; },
    });
    loading.content = text;
    loading.video = url;
    bubble.innerHTML = `<div>${esc(text)}</div><video src="${url}" controls playsinline style="max-width:100%;border-radius:10px"></video>`;
    session.messages.push(loading);
  } catch (e) {
    bubble.innerHTML = `<div class="ai-gen-hint err">⚠️ 视频生成失败：${esc(e.message)}</div>`;
    throw e;
  } finally {
    bubble.classList.remove('streaming');
  }
}

/* ================= AI 生成网页 → 本地离线预览 ================= */
function bindPreviewCode() {
  if (window.__thPreviewBound) return;
  window.__thPreviewBound = true;
  document.addEventListener('th:preview-code', (e) => {
    const code = e.detail && e.detail.code;
    if (!code) return;
    openOverlay({
      title: '网页预览（本地离线渲染）',
      build: (body) => {
        body.style.padding = '0';
        body.innerHTML = `<iframe class="code-preview-frame" sandbox="allow-scripts" style="width:100%;height:100%;border:0;background:#fff"></iframe>`;
        $('iframe', body).srcdoc = code;
      },
    });
  });
}

/* ================= 模型列表页（厂商默认折叠 · 历史模型灰盒 · 实时同步 · 排行榜入口） ================= */
export async function showModelsPage(page = null, focus = null) {
  const ref = openOverlay({
    title: '模型设置',
    build: async (body) => {
      body.innerHTML = `
        <div class="mp-top"><div class="ai-dsearch mp-search">${icon('search')}<input id="mp-search" placeholder="搜索厂商或模型"></div></div>
        <button class="models-rank-entry" id="mp-rank">${icon('chart')}<span class="grow" style="text-align:left">模型排行榜</span><span class="muted">谁最强</span>${icon('arrowR')}</button>
        <div id="mp-list"></div>`;
      const listEl = $('#mp-list', body);

      const render = async () => {
        const kw = ($('#mp-search', body).value || '').trim().toLowerCase();
        listEl.innerHTML = '';
        for (const p of PROVIDERS) {
          const hasKey = !!(await getApiKey(p.id));
          const synced = await getSyncedModels(p.id);
          const fresh = synced.filter(m => !(p.models || []).includes(m) && !(p.deprecated || []).includes(m) && isChatModel(m));
          const main = [...(p.models || []), ...fresh];
          const imgs = p.image || [], vids = p.video || [], dep = p.deprecated || [];
          const matchKw = (m) => !kw || m.toLowerCase().includes(kw) || p.name.toLowerCase().includes(kw) || p.id.includes(kw);
          if (kw && !main.some(matchKw) && !imgs.some(matchKw) && !vids.some(matchKw) && !dep.some(matchKw)) continue;

          const card = el(`<div class="provider-card ${focus === p.id ? 'open' : ''}">
            <div class="provider-head">
              <span class="provider-ico">${vendorIcon(p.id)}</span>
              <div class="provider-info">
                <div class="provider-name">${esc(p.name)} ${hasKey ? '<span class="tag tag-green">已配置</span>' : ''}</div>
                <div class="provider-sub">${(p.models || []).length} 对话${imgs.length ? ' · ' + imgs.length + ' 图片' : ''}${vids.length ? ' · ' + vids.length + ' 视频' : ''}</div>
              </div>
              <button class="icon-btn mp-sync" title="从厂商接口实时同步模型列表">${icon('refresh')}</button>
              <span class="provider-chev">${icon('arrowR')}</span>
            </div>
            <div class="provider-body" ${focus === p.id ? '' : 'hidden'}></div>
          </div>`);
          const bodyEl = $('.provider-body', card);

          const row = (m, extraCls = '', tag = '') => {
            const r = el(`<div class="model-row ${extraCls}"><span class="ellipsis">${esc(m)}</span>${tag}</div>`);
            r.onclick = async () => {
              if (!(await getApiKey(p.id))) { ref.close(); showAISettings(p.id); return; }
              currentModel = { providerId: p.id, model: m };
              await kvSet('ai:last-model', currentModel);
              if (currentMode !== 'single') { currentMode = 'single'; kvSet('ai:last-mode', 'single'); }
              if (page) { setWorkspace(page, 'chat'); }
              ref.close();
              toast('已切换到 ' + m, 'ok');
            };
            return r;
          };
          main.filter(matchKw).forEach(m => bodyEl.appendChild(row(m, '', fresh.includes(m) ? '<span class="tag tag-blue">新上线</span>' : '')));
          if (imgs.some(matchKw)) {
            bodyEl.appendChild(el('<div class="mp-sub">图片模型</div>'));
            imgs.filter(matchKw).forEach(m => {
              const r = row(m, '', '<span class="tag tag-purple">图片</span>');
              r.onclick = async () => {
                if (!(await getApiKey(p.id))) { ref.close(); showAISettings(p.id); return; }
                imageModel = { providerId: p.id, model: m };
                await kvSet('ai:image-model', imageModel);
                if (page) setWorkspace(page, 'image');
                ref.close(); toast('已切换到图片模型 ' + m, 'ok');
              };
              bodyEl.appendChild(r);
            });
          }
          if (vids.some(matchKw)) {
            bodyEl.appendChild(el('<div class="mp-sub">视频模型</div>'));
            vids.filter(matchKw).forEach(m => {
              const r = row(m, '', '<span class="tag tag-orange">视频</span>');
              r.onclick = async () => {
                if (!(await getApiKey(p.id))) { ref.close(); showAISettings(p.id); return; }
                videoModel = { providerId: p.id, model: m };
                await kvSet('ai:video-model', videoModel);
                if (page) setWorkspace(page, 'video');
                ref.close(); toast('已切换到视频模型 ' + m, 'ok');
              };
              bodyEl.appendChild(r);
            });
          }
          if (dep.some(matchKw)) {
            const depBox = el(`<div class="dep-box">
              <div class="dep-head">${icon('history')} 历史模型（${dep.filter(matchKw).length}）<span class="provider-chev">${icon('arrowR')}</span></div>
              <div class="dep-list" hidden></div>
            </div>`);
            const dl = $('.dep-list', depBox);
            dep.filter(matchKw).forEach(m => dl.appendChild(row(m, 'dep')));
            $('.dep-head', depBox).onclick = () => {
              dl.hidden = !dl.hidden;
              depBox.classList.toggle('open', !dl.hidden);
            };
            bodyEl.appendChild(depBox);
          }
          const foot = el(`<div class="provider-foot"><button class="btn btn-sm">${icon('key')} ${hasKey ? '管理密钥' : '配置密钥'}</button></div>`);
          $('button', foot).onclick = () => { ref.close(); showAISettings(p.id); };
          bodyEl.appendChild(foot);

          $('.provider-head', card).onclick = (e) => {
            if (e.target.closest('.mp-sync')) return;
            bodyEl.hidden = !bodyEl.hidden;
            card.classList.toggle('open', !bodyEl.hidden);
          };
          $('.mp-sync', card).onclick = async (e) => {
            e.stopPropagation();
            if (!(await getApiKey(p.id))) { toast('请先配置 ' + p.name + ' 的密钥'); ref.close(); showAISettings(p.id); return; }
            const btn = e.currentTarget;
            btn.classList.add('spinning');
            try {
              const models = await fetchRemoteModels(p.id);
              await saveSyncedModels(p.id, models);
              toast(`已同步 ${models.length} 个模型`, 'ok');
              render();
            } catch (err) { toast('同步失败：' + err.message, 'err'); }
            btn.classList.remove('spinning');
          };
          listEl.appendChild(card);
        }
        if (!listEl.children.length) listEl.innerHTML = '<div class="empty"><div class="empty-title">没有匹配的厂商</div></div>';
      };
      await render();
      $('#mp-search', body).addEventListener('input', render);
      $('#mp-rank', body).onclick = () => showRankingsPage(page);
    },
  });
}

/* ================= 模型排行榜（雷达图仅综合榜 · 六维 · TOP3 叠加；其余榜单为普通排名） ================= */
export function showRankingsPage(page = null) {
  let curCat = RANK_CATEGORIES[0].id;
  const ref = openOverlay({
    title: '模型排行榜',
    build: (body) => {
      body.innerHTML = `
        <div class="rank-layout">
          <div class="rank-side">${RANK_CATEGORIES.map(c => `<button class="rank-cat ${c.id === curCat ? 'on' : ''}" data-c="${c.id}">${esc(c.name)}</button>`).join('')}</div>
          <div class="rank-main">
            <div class="rank-radar-wrap" id="rank-radar-wrap">
              <canvas id="rank-radar"></canvas>
              <div class="rank-radar-tip">六维能力雷达 · TOP 3 对比</div>
              <div class="rank-radar-legend" id="rank-radar-legend"></div>
            </div>
            <div class="rank-list" id="rank-list"></div>
            <div class="rank-disclaimer">评分综合公开榜单与官方基准整理（2026-08），仅供参考；点击任意模型可直接发起对话</div>
          </div>
        </div>`;
      const renderCat = () => {
        $$('.rank-cat', body).forEach(x => x.classList.toggle('on', x.dataset.c === curCat));
        const data = RANKINGS[curCat] || [];
        const isOverall = curCat === 'overall';
        $('#rank-radar-wrap', body).style.display = isOverall ? '' : 'none';
        if (isOverall) drawRadar($('#rank-radar', body), data.slice(0, 3), $('#rank-radar-legend', body));
        const list = $('#rank-list', body);
        list.innerHTML = data.map((r, i) => `
          <button class="rank-row-item" data-i="${i}">
            <span class="rank-no ${i < 3 ? 'top' : ''}">${i + 1}</span>
            <span class="rank-ico">${vendorIcon(r.p)}</span>
            <div class="rank-model"><div class="rank-mname ellipsis">${esc(r.m)}</div><div class="rank-pname">${esc((PROVIDERS.find(p => p.id === r.p) || {}).name || r.p)}</div></div>
            <div class="rank-score"><div class="rank-bar"><i style="width:${r.s}%"></i></div><span>${r.s}</span></div>
          </button>`).join('');
        $$('.rank-row-item', list).forEach(b => b.onclick = async () => {
          const r = data[+b.dataset.i];
          if (!r) return;
          const ok = await confirmDialog('使用此模型对话？', `${r.m} · ${(PROVIDERS.find(p => p.id === r.p) || {}).name || r.p}`, '开始对话', false);
          if (!ok) return;
          currentModel = { providerId: r.p, model: r.m };
          await kvSet('ai:last-model', currentModel);
          if (currentMode !== 'single') { currentMode = 'single'; kvSet('ai:last-mode', 'single'); }
          ref.close();
          if (page) { setWorkspace(page, 'chat'); renderMessages(page); updateTopbar(page); }
          toast('已切换到 ' + r.m, 'ok');
        });
      };
      $$('.rank-cat', body).forEach(x => x.onclick = () => { curCat = x.dataset.c; renderCat(); });
      renderCat();
    },
  });
}

/* 六维雷达：固定六个能力轴，叠加 TOP N 模型（不同颜色），附维度和图例 */
const RADAR_COLORS = ['#3B5BFD', '#FF7A45', '#22B07D'];
function drawRadar(canvas, data, legendEl) {
  if (!canvas) return;
  const dims = RADAR_DIMS;
  const n = dims.length;
  const dpr = window.devicePixelRatio || 1;
  const size = Math.min(300, canvas.parentElement.clientWidth || 300);
  canvas.width = size * dpr; canvas.height = size * dpr;
  canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const cx = size / 2, cy = size / 2, R = size / 2 - 46;
  const css = getComputedStyle(document.body);
  const cBorder = css.getPropertyValue('--border').trim() || '#333';
  const cText = css.getPropertyValue('--text-secondary').trim() || '#888';
  const angle = i => -Math.PI / 2 + (2 * Math.PI * i) / n;
  ctx.clearRect(0, 0, size, size);
  // 环
  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = angle(i % n), r = (R * ring) / 4;
      i ? ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)) : ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.strokeStyle = cBorder; ctx.lineWidth = 1; ctx.stroke();
  }
  // 轴 + 维度标签
  dims.forEach((d, i) => {
    const a = angle(i);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
    ctx.strokeStyle = cBorder; ctx.stroke();
    const lx = cx + (R + 18) * Math.cos(a), ly = cy + (R + 15) * Math.sin(a);
    ctx.fillStyle = cText; ctx.font = '11px sans-serif';
    ctx.textAlign = Math.abs(Math.cos(a)) < 0.35 ? 'center' : (Math.cos(a) > 0 ? 'left' : 'right');
    ctx.textBaseline = 'middle';
    ctx.fillText(d, lx, ly);
  });
  // 模型多边形叠加
  if (legendEl) legendEl.innerHTML = '';
  data.forEach((d, di) => {
    const vals = d.dims || dims.map(() => d.s);
    const color = RADAR_COLORS[di % RADAR_COLORS.length];
    ctx.beginPath();
    vals.forEach((v, i) => {
      const a = angle(i), r = R * (v / 100);
      i ? ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)) : ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    });
    ctx.closePath();
    ctx.fillStyle = color + '2E'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    vals.forEach((v, i) => {
      const a = angle(i), r = R * (v / 100);
      ctx.beginPath();
      ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    });
    if (legendEl) {
      const item = document.createElement('span');
      item.className = 'rank-legend-item';
      item.innerHTML = `<i style="background:${color}"></i>${esc(d.m.length > 16 ? d.m.slice(0, 15) + '…' : d.m)}`;
      legendEl.appendChild(item);
    }
  });
}

/* ================= 统一设置页（API 密钥 + 联网搜索 + MCP 服务） ================= */
export async function showAISettings(focusProvider = null) {
  const ref = openOverlay({
    title: '设置',
    build: async (body) => {
      body.innerHTML = `
        <div class="row gap8" style="margin-bottom:14px">
          <button class="btn btn-primary grow" id="as-identify">${icon('sparkle')} 自动识别 Key</button>
          <button class="btn grow" id="as-websearch">${icon('globe')} 联网搜索服务</button>
        </div>
        <div class="ai-drawer-sec" style="padding:0 0 8px">API 密钥</div>
        <div class="col gap8" id="as-keys"></div>
        <div class="ai-drawer-sec" style="padding:16px 0 8px">MCP 服务</div>
        <div class="muted" style="font-size:12px;margin-bottom:8px">接入 MCP 工具服务后，AI 对话可调用外部工具（仅支持 SSE / HTTP 传输）。</div>
        <div class="col gap8" id="as-mcps"></div>`;

      const renderKeys = async () => {
        const box = $('#as-keys', body);
        box.innerHTML = '';
        for (const p of PROVIDERS) {
          if (!(p.models || []).length && !(p.image || []).length && !(p.video || []).length) continue;
          const key = await getApiKey(p.id);
          const item = el(`<button class="list-item" style="width:100%">
            <span class="list-ico" style="background:none">${vendorIcon(p.id)}</span>
            <div class="grow" style="text-align:left;min-width:0">
              <div style="font-size:14px;font-weight:600">${esc(p.name)}</div>
              <div class="muted">${key ? '已配置 API Key' : '未配置'}</div>
            </div>
            ${key ? icon('check') : ''}
          </button>`);
          item.onclick = () => editProviderKey(p, renderKeys);
          box.appendChild(item);
        }
      };

      const renderMcps = () => {
        const box = $('#as-mcps', body);
        const servers = listMcpServers();
        box.innerHTML = '';
        if (!servers.length) box.innerHTML = '<div class="empty"><div class="empty-title">还没有 MCP 服务</div></div>';
        servers.forEach((s) => {
          const item = el(`<div class="list-item">
            <span class="list-ico">${icon('plug')}</span>
            <div class="grow" style="min-width:0">
              <div style="font-size:14px;font-weight:600" class="ellipsis">${esc(s.name)}</div>
              <div class="muted ellipsis">${esc(s.url)}</div>
              <div class="row gap4 mt8">
                <span class="tag ${s.status === 'connected' ? 'tag-green' : s.status === 'error' ? 'tag-red' : 'tag-gray'}">${s.status === 'connected' ? '已连接 · ' + s.tools.length + ' 工具' : s.status === 'error' ? '连接失败' : '未连接'}</span>
              </div>
            </div>
            <div class="col gap4">
              <button class="btn btn-sm" data-a="conn">${s.status === 'connected' ? '断开' : '连接'}</button>
              <button class="btn btn-sm btn-danger" data-a="del">删除</button>
            </div>
          </div>`);
          $('[data-a="conn"]', item).onclick = async () => {
            if (s.status === 'connected') { disconnectMcp(s.id); }
            else { toast('连接中…'); await connectMcp(s.id); }
            renderMcps();
          };
          $('[data-a="del"]', item).onclick = async () => {
            if (await confirmDialog('删除该 MCP 服务？', '', '删除', true)) { await removeMcpServer(s.id); renderMcps(); }
          };
          box.appendChild(item);
        });
        const addBtn = el(`<button class="btn btn-block mt8">${icon('plus')} 添加 MCP Server</button>`);
        addBtn.onclick = () => addMcpDialog(renderMcps);
        box.appendChild(addBtn);
      };

      $('#as-identify', body).onclick = () => showIdentifyDialog(renderKeys);
      $('#as-websearch', body).onclick = () => showSearchServiceDialog();
      await renderKeys();
      renderMcps();
      if (focusProvider) {
        const p = providerById(focusProvider);
        if (p) editProviderKey(p, renderKeys);
      }
    },
  });
}

/* 兼容旧入口 */
export async function showKeySettings(focusProvider = null) { return showAISettings(focusProvider); }

async function editProviderKey(p, onChange) {
  const key = await getApiKey(p.id);
  const base = await getBaseOverride(p.id);
  const kv = await import('./keyvault.js');
  const keyMode = await kv.getKeyMode(p.id);
  const body = el(`<div>
    <div class="row gap8 mb16"><span style="width:32px;height:32px">${vendorIcon(p.id)}</span><div><div style="font-weight:700">${esc(p.name)}</div><div class="muted">${esc(p.base || '需填写接口地址')}</div></div></div>
    ${formRow('API Key', `<input class="input" data-f="key" type="password" value="${esc(key)}" placeholder="sk-..." autocomplete="off">`)}
    ${formRow('自定义接口地址（可选，留空用官方）', `<input class="input" data-f="base" value="${esc(base)}" placeholder="${esc(p.base || 'https://...')}">`)}
    ${kv.keyModeRowHtml(keyMode)}
    <p class="muted" style="margin-bottom:10px">🔐 加密上传使用「我的 → 全局设置 → 二级密码」进行本地加密，丢失二级密码将无法解密。</p>
    <div data-v="result" style="margin-bottom:10px"></div>
  </div>`);
  kv.bindKeyModeRow(body, p.id, () => { afterKeySavedHook(p); });
  const result = $('[data-v="result"]', body);
  const m = modal({
    title: '配置 ' + p.name, body,
    footer: `<button class="btn grow" data-a="cancel">取消</button>${key ? '<button class="btn grow btn-danger" data-a="del">删除</button>' : ''}<button class="btn grow" data-a="sync">同步模型</button><button class="btn grow" data-a="verify">对话验证</button><button class="btn btn-primary grow" data-a="save">保存</button>`,
  });
  $('[data-a="cancel"]', m.mask).onclick = m.close;
  const delBtn = $('[data-a="del"]', m.mask);
  if (delBtn) delBtn.onclick = async () => {
    if (!(await confirmDialog(`删除 ${p.name} 的密钥？`, '', '删除', true))) return;
    await setApiKey(p.id, '');
    m.close();
    toast('已删除', 'ok');
    afterKeySavedHook(p);
    onChange && onChange();
  };
  $('[data-a="sync"]', m.mask).onclick = async (e) => {
    const k = $('[data-f="key"]', body).value.trim() || key;
    if (!k) { toast('请先输入 Key'); return; }
    await setApiKey(p.id, $('[data-f="key"]', body).value);
    await setBaseOverride(p.id, $('[data-f="base"]', body).value);
    e.target.disabled = true;
    result.innerHTML = '<div class="muted">正在从厂商接口获取模型列表…</div>';
    try {
      const models = await fetchRemoteModels(p.id);
      await saveSyncedModels(p.id, models);
      result.innerHTML = `<div style="color:var(--primary)">已同步 ${models.length} 个模型（模型设置页可见「新上线」标记）</div>`;
    } catch (err) {
      result.innerHTML = `<div style="color:var(--danger)">同步失败：${esc(err.message)}</div>`;
    }
    e.target.disabled = false;
  };
  $('[data-a="verify"]', m.mask).onclick = async (e) => {
    const k = $('[data-f="key"]', body).value.trim();
    if (!k) return toast('请先输入 Key');
    e.target.disabled = true;
    e.target.textContent = '正在真实对话验证…';
    result.innerHTML = '';
    try {
      const r = await testProviderKey(p.id, k);
      result.innerHTML = `<div style="color:var(--primary)">验证通过：${esc(p.name)} · ${esc(r.model)} 已正常返回对话</div>`;
    } catch (err) {
      result.innerHTML = `<div style="color:var(--danger)">验证失败：${esc(err.message)}${err.quota ? '（账户余额可能不足）' : ''}</div>`;
    }
    e.target.disabled = false;
    e.target.textContent = '对话验证';
  };
  $('[data-a="save"]', m.mask).onclick = async () => {
    await setApiKey(p.id, $('[data-f="key"]', body).value);
    await setBaseOverride(p.id, $('[data-f="base"]', body).value);
    m.close();
    toast('已保存', 'ok');
    afterKeySavedHook(p);
    onChange && onChange();
  };
}

/* 密钥变更后按存储方式同步到云端（密钥保险库） */
async function afterKeySavedHook(p) {
  try {
    const kv = await import('./keyvault.js');
    const base = await getBaseOverride(p.id);
    await kv.afterKeySaved(p.id, p.name, base);
  } catch (_) {}
}

/* ================= 自动识别 API Key（并行真实对话验证） ================= */
function showIdentifyDialog(onSaved) {
  const body = el(`<div>
    ${formRow('粘贴任意厂商的 API Key', '<textarea class="input" rows="3" data-f="key" placeholder="sk-... / tp-... / sk-ant-... / AIza... 等"></textarea>')}
    <div class="muted" style="margin-bottom:10px;line-height:1.7">识别不靠猜前缀：程序会对各家厂商并行发送<b>真实对话请求</b>（每批 8 家），哪家成功返回对话结果，Key 就属于哪家。</div>
    <div class="identify-log" data-v="log" style="display:none"></div>
  </div>`);
  const logEl = $('[data-v="log"]', body);
  const m = modal({
    title: '自动识别 API Key', body,
    footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="go">开始识别</button>',
  });
  $('[data-a="cancel"]', m.mask).onclick = m.close;
  $('[data-a="go"]', m.mask).onclick = async (e) => {
    const key = $('[data-f="key"]', body).value.trim();
    if (!key) return toast('请先粘贴 Key');
    e.target.disabled = true;
    e.target.textContent = '识别中…';
    logEl.style.display = 'block';
    logEl.innerHTML = '';
    try {
      const r = await identifyApiKey(key, (line) => {
        const row = el(`<div class="identify-line">${esc(line)}</div>`);
        logEl.appendChild(row);
        logEl.scrollTop = logEl.scrollHeight;
      });
      await setApiKey(r.provider.id, key);
      logEl.appendChild(el(`<div class="identify-line" style="color:var(--primary);font-weight:700">已识别为「${esc(r.provider.name)}」，Key 已自动保存，验证模型：${esc(r.model)}</div>`));
      toast('已识别并保存：' + r.provider.name, 'ok');
      setTimeout(() => { m.close(); onSaved && onSaved(); }, 900);
    } catch (err) {
      logEl.appendChild(el(`<div class="identify-line" style="color:var(--danger)">${esc(err.message)}</div>`));
      toast('识别失败', 'err');
    }
    e.target.disabled = false;
    e.target.textContent = '开始识别';
  };
}

/* ================= 联网搜索服务配置（单选卡片 + 按服务动态表单） ================= */
async function showSearchServiceDialog() {
  const cfg = await getSearchConfig();
  const body = el(`<div>
    <div class="muted" style="margin-bottom:10px;line-height:1.7">选择一个搜索服务并填入凭据，对话页「＋ → 联网搜索」即可使用。</div>
    <div class="col gap8" data-v="list"></div>
    <div data-v="form" style="display:none;margin-top:12px"></div>
  </div>`);
  const listEl = $('[data-v="list"]', body);
  const formEl = $('[data-v="form"]', body);
  let sel = cfg.service || '';

  function renderForm() {
    const s = SEARCH_SERVICES.find((x) => x.id === sel);
    if (!s) { formEl.style.display = 'none'; formEl.innerHTML = ''; return; }
    formEl.style.display = 'block';
    formEl.innerHTML =
      (s.needUrl ? formRow('实例地址', `<input class="input" data-f="url" placeholder="https://searx.example.com" value="${sel === cfg.service ? esc(cfg.url || '') : ''}">`) : '')
      + formRow(s.needUrl ? 'API Key（可留空）' : 'API Key',
        `<input class="input" data-f="key" type="password" placeholder="${esc(s.keyHint || '搜索服务的 Key')}" value="${sel === cfg.service ? esc(cfg.key || '') : ''}" autocomplete="off">`);
  }
  function renderList() {
    listEl.innerHTML = '';
    SEARCH_SERVICES.forEach((s) => {
      const on = sel === s.id;
      const b = el(`<button class="search-svc ${on ? 'sel' : ''}">
        <span class="search-svc-radio">${on ? icon('check') : ''}</span>
        <div class="grow" style="text-align:left;min-width:0">
          <div style="font-size:14px;font-weight:600">${esc(s.name)} ${cfg.service === s.id && (cfg.key || cfg.url) ? '<span class="tag tag-green">已配置</span>' : ''}</div>
          <div class="muted">${esc(s.desc)}</div>
        </div>
      </button>`);
      b.onclick = () => { sel = s.id; renderList(); renderForm(); };
      listEl.appendChild(b);
    });
  }
  renderList();
  renderForm();

  const m = modal({
    title: '联网搜索服务', body,
    footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="save">保存</button>',
  });
  $('[data-a="cancel"]', m.mask).onclick = m.close;
  $('[data-a="save"]', m.mask).onclick = async () => {
    if (!sel) return toast('请选择一个搜索服务');
    const s = SEARCH_SERVICES.find((x) => x.id === sel);
    const key = ($('[data-f="key"]', formEl) || {}).value || '';
    const url = ($('[data-f="url"]', formEl) || {}).value || '';
    if (s.needUrl && !url.trim()) return toast('请填写 SearXNG 实例地址');
    if (!s.needUrl && !key.trim()) return toast('请填写 API Key');
    await setSearchConfig({ service: sel, key, url });
    m.close();
    toast('联网搜索服务已保存', 'ok');
  };
}

/* ================= MCP 添加弹窗 ================= */
function addMcpDialog(onDone) {
  const body = el(`<div>
    ${formRow('名称', '<input class="input" data-f="name" placeholder="我的 MCP 服务">')}
    ${formRow('服务地址（SSE / Streamable HTTP）', '<input class="input" data-f="url" placeholder="https://example.com/mcp">')}
    <div class="muted">注意：浏览器环境仅支持网络传输（SSE/HTTP），不支持 stdio 本地进程。</div>
  </div>`);
  const m = modal({
    title: '添加 MCP Server', body,
    footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">添加并连接</button>',
  });
  $('[data-a="cancel"]', m.mask).onclick = m.close;
  $('[data-a="ok"]', m.mask).onclick = async () => {
    const name = $('[data-f="name"]', body).value.trim();
    const url = $('[data-f="url"]', body).value.trim();
    if (!name || !url) return toast('请填写完整');
    const s = await addMcpServer({ name, url });
    m.close();
    toast('连接中…');
    const ok = await connectMcp(s.id);
    toast(ok ? '已连接' : '连接失败', ok ? 'ok' : 'err');
    onDone && onDone();
  };
}
