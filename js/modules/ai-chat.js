/* ===== ThirdHub js/modules/ai-chat.js — AI 对话页 ===== */
import { $, $$, el, esc, icon, toast, modal, actionSheet, openOverlay, formRow, uid, fmtDate } from '../ui.js';
import { db, kvGet, kvSet, on } from '../store.js';
import { chat, drawImage, getApiKey, setApiKey, getBaseOverride, setBaseOverride, supportsWebSearch, refreshFreeModels, getFreeModel, identifyApiKey, testProviderKey } from '../ai/ai-api.js';
import { SEARCH_SERVICES, getSearchConfig, setSearchConfig, hasSearchConfig, searchWeb, resultsToContext } from '../ai/web-search.js';
import { providerById } from '../ai/ai-models.js';
import { vendorIcon } from '../ai/vendors.js';
import { pickModel } from '../ai/model-selector.js';
import { renderMarkdown, bindCopyButtons } from '../ai/markdown.js';
import { getSessionStats, fmtTokens } from '../token-meter.js';
import { startRecognition, stopRecognition, speak, stopSpeak } from '../voice.js';
import { listMcpServers, addMcpServer, connectMcp, toggleMcpServer, removeMcpServer } from '../ai/mcp-client.js';

const MODES = [
  { id: 'single',  name: '单模型',   desc: '一对一对话' },
  { id: 'compare', name: '多模型对比', desc: '同一问题多模型并排回答' },
  { id: 'debate',  name: '辩论模式',  desc: '正反双方多轮辩论' },
  { id: 'collab',  name: '协同模式',  desc: '多模型协作修订回答' },
];

let session = null;       // {id,title,model,mode,messages[]}
let currentModel = null;  // {providerId, model}
let compareModels = [];
let currentMode = 'single';
let abortCtl = null;
let sending = false;

export async function renderAIChat(page) {
  currentModel = await kvGet('ai:last-model', { providerId: 'deepseek', model: 'deepseek-chat' });
  currentMode = await kvGet('ai:last-mode', 'single');
  compareModels = await kvGet('ai:compare-models', []);
  refreshFreeModels().catch(() => {});

  page.classList.add('ai-page');
  page.innerHTML = `
    <div class="ai-wrap">
      <div class="ai-topbar">
        <button class="icon-btn" data-a="menu" title="菜单">${icon('menu')}</button>
        <div class="ai-topbar-center">
          <button class="ai-pill" data-a="model"><span class="pill-ico"></span><span class="pill-text"></span><span class="pill-arrow">▾</span></button>
          <button class="ai-pill" data-a="mode"><span class="pill-text"></span><span class="pill-arrow">▾</span></button>
        </div>
        <button class="icon-btn" data-a="new" title="新对话">${icon('plus')}</button>
      </div>
      <div class="ai-messages" id="ai-messages"></div>
      <div class="ai-inputbar">
        <div class="ai-attach-strip" id="ai-attach-strip" hidden></div>
        <div class="ai-input-row">
          <button class="ai-plus-btn" data-a="plus" title="更多功能">${icon('plus')}</button>
          <textarea class="ai-textarea" rows="1" placeholder="输入消息…"></textarea>
          <button class="ai-tool-btn" data-a="voice" title="语音输入">${icon('mic')}</button>
          <button class="ai-send" data-a="send">${icon('send')}</button>
        </div>
        <div class="ai-token-hint" id="ai-token-hint"></div>
      </div>
    </div>
    <div class="ai-drawer-mask" data-a="drawer-mask"></div>
    <aside class="ai-drawer">
      <div class="ai-drawer-head">
        <span class="ai-drawer-logo">${icon('robot')}</span>
        <span class="ai-drawer-title">ThirdHub AI</span>
      </div>
      <button class="ai-drawer-item" data-a="d-new">${icon('plus')}<span>新对话</span></button>
      <button class="ai-drawer-item" data-a="d-models">${icon('cpu')}<span>模型</span><span class="ai-drawer-arrow">${icon('arrowR')}</span></button>
      <button class="ai-drawer-item" data-a="d-keys">${icon('key')}<span>API 设置</span><span class="ai-drawer-arrow">${icon('arrowR')}</span></button>
      <button class="ai-drawer-item" data-a="d-mcp">${icon('plug')}<span>MCP 服务</span><span class="ai-drawer-arrow">${icon('arrowR')}</span></button>
      <div class="ai-drawer-sec">历史会话</div>
      <div class="ai-drawer-sessions" id="ai-drawer-sessions"></div>
    </aside>
    <div class="ai-plus-mask" data-a="plus-mask"></div>
    <div class="ai-plus-sheet" id="ai-plus-sheet">
      <div class="ai-plus-grid">
        <button class="ai-plus-cell" data-plus="camera"><span class="ai-plus-ico">${icon('camera')}</span><span class="ai-plus-label">拍照</span></button>
        <button class="ai-plus-cell" data-plus="photos"><span class="ai-plus-ico">${icon('image')}</span><span class="ai-plus-label">照片</span></button>
        <button class="ai-plus-cell" data-plus="file"><span class="ai-plus-ico">${icon('file')}</span><span class="ai-plus-label">本地文件</span></button>
        <button class="ai-plus-cell" data-plus="draw"><span class="ai-plus-ico">${icon('brush')}</span><span class="ai-plus-label">AI 绘画</span></button>
      </div>
      <div class="ai-plus-settings">
        <div class="ai-plus-row">
          <div class="ai-plus-row-info"><div class="ai-plus-row-name">联网搜索</div><div class="ai-plus-row-sub" id="ai-web-sub"></div></div>
          <button class="ai-toggle" data-a="web-toggle" id="ai-web-toggle"></button>
        </div>
      </div>
      <input type="file" id="ai-cam-input" accept="image/*" capture="environment" hidden>
      <input type="file" id="ai-img-input" accept="image/*" multiple hidden>
      <input type="file" id="ai-file-input" hidden>
    </div>`;

  await newSession();
  renderMessages(page);
  updatePills(page);
  updateTokenHint();
  on('token:update', updateTokenHint);

  const ta = $('.ai-textarea', page);
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !/Android|iPhone/i.test(navigator.userAgent)) {
      e.preventDefault(); sendMessage(page);
    }
  });

  /* 抽屉 */
  const drawer = $('.ai-drawer', page), drawerMask = $('[data-a="drawer-mask"]', page);
  const openDrawer = () => { renderDrawerSessions(page); drawer.classList.add('open'); drawerMask.classList.add('open'); };
  const closeDrawer = () => { drawer.classList.remove('open'); drawerMask.classList.remove('open'); };
  $('[data-a="menu"]', page).onclick = openDrawer;
  drawerMask.onclick = closeDrawer;
  $('[data-a="d-new"]', drawer).onclick = () => { closeDrawer(); newSession(); renderMessages(page); toast('已开始新对话'); };
  $('[data-a="d-models"]', drawer).onclick = () => { closeDrawer(); showModelsPage(page); };
  $('[data-a="d-keys"]', drawer).onclick = () => { closeDrawer(); showKeySettings(); };
  $('[data-a="d-mcp"]', drawer).onclick = () => { closeDrawer(); showMcpPanel(); };

  /* ＋ 面板（OmniHub 式底部上滑） */
  const plusSheet = $('#ai-plus-sheet', page), plusMask = $('[data-a="plus-mask"]', page);
  const openPlus = () => { syncWebRow(); plusSheet.classList.add('open'); plusMask.classList.add('open'); };
  const closePlus = () => { plusSheet.classList.remove('open'); plusMask.classList.remove('open'); };
  $('[data-a="plus"]', page).onclick = openPlus;
  plusMask.onclick = closePlus;
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
      sub.textContent = '未配置搜索服务，请到「API 设置 → 联网搜索服务」配置';
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
    try {
      const txt = await f.text();
      ta.value = (ta.value ? ta.value + '\n' : '') + `【文件 ${f.name}】\n` + txt.slice(0, 8000);
      ta.dispatchEvent(new Event('input'));
      toast('已读取文件内容到输入框', 'ok');
    } catch (err) { toast('无法读取该文件', 'err'); }
  };
  plusSheet.addEventListener('click', (e) => {
    const cell = e.target.closest('.ai-plus-cell');
    if (!cell) return;
    const act = cell.dataset.plus;
    if (act === 'camera') $('#ai-cam-input', page).click();
    else if (act === 'photos') $('#ai-img-input', page).click();
    else if (act === 'file') $('#ai-file-input', page).click();
    else if (act === 'draw') { closePlus(); drawFlow(page); }
  });

  $('[data-a="send"]', page).onclick = () => sending ? stopSending(page) : sendMessage(page);
  $('[data-a="model"]', page).onclick = () => pickModelFlow(page);
  $('[data-a="mode"]', page).onclick = () => pickModeFlow(page);
  $('[data-a="new"]', page).onclick = () => { newSession(); renderMessages(page); toast('已开始新对话'); };
  $('[data-a="voice"]', page).onclick = (e) => voiceFlow(e.currentTarget, ta);
}

/* ---------- 模型/模式选择 ---------- */
async function pickModelFlow(page) {
  if (currentMode === 'compare' || currentMode === 'collab' || currentMode === 'debate') {
    const picked = await pickModel({ multi: true, selected: compareModels.map((m) => m.providerId + '/' + m.model) });
    if (picked && picked.length) {
      compareModels = picked.slice(0, 4);
      await kvSet('ai:compare-models', compareModels);
    }
  } else {
    const picked = await pickModel();
    if (picked) { currentModel = picked; await kvSet('ai:last-model', picked); }
  }
  updatePills(page);
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
  updatePills(page);
}

function updatePills(page) {
  const mp = $('[data-a="model"] .pill-text', page);
  const mi = $('[data-a="model"] .pill-ico', page);
  const mode = MODES.find((m) => m.id === currentMode);
  if (currentMode === 'single') {
    mp.textContent = currentModel.model;
    mi.innerHTML = vendorIcon(currentModel.providerId);
  } else {
    mp.textContent = compareModels.length ? `${compareModels.length} 个模型` : '选择模型';
    mi.innerHTML = icon('users');
  }
  $('[data-a="mode"] .pill-text', page).textContent = '模式: ' + mode.name;
}

function updateTokenHint() {
  const s = getSessionStats();
  const hint = $('#ai-token-hint');
  if (hint) hint.textContent = s.requests ? `本次会话：${s.requests} 次请求 · ${fmtTokens(s.prompt + s.completion)} tokens` : '';
}

/* ---------- 会话管理 ---------- */
async function newSession() {
  session = { id: uid(), title: '新对话', createdAt: Date.now(), messages: [] };
}
async function saveSession() {
  if (!session.messages.length) return;
  const first = session.messages.find((m) => m.role === 'user');
  session.title = first ? String(first.content).slice(0, 30) : '新对话';
  session.updatedAt = Date.now();
  session.model = currentModel;
  session.mode = currentMode;
  await db.put('chats', JSON.parse(JSON.stringify(session)));
}

async function renderDrawerSessions(page) {
  const box = $('#ai-drawer-sessions', page);
  if (!box) return;
  const list = (await db.all('chats')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="ai-drawer-empty">暂无历史会话</div>'; return; }
  list.forEach((s) => {
    const item = el(`<button class="ai-session ${s.id === session.id ? 'on' : ''}">
      <span class="ai-session-ico">${icon('robot')}</span>
      <span class="ai-session-info">
        <span class="ai-session-title ellipsis">${esc(s.title)}</span>
        <span class="ai-session-date">${fmtDate(s.updatedAt || s.createdAt, true)}</span>
      </span>
      <span class="ai-session-del" data-del>${icon('trash')}</span>
    </button>`);
    item.onclick = async (e) => {
      if (e.target.closest('[data-del]')) return;
      session = s;
      $('.ai-drawer', page).classList.remove('open');
      $('[data-a="drawer-mask"]', page).classList.remove('open');
      renderMessages(page);
    };
    $('[data-del]', item).onclick = async (e) => {
      e.stopPropagation();
      await db.del('chats', s.id);
      item.remove();
      if (!box.children.length) box.innerHTML = '<div class="ai-drawer-empty">暂无历史会话</div>';
    };
    box.appendChild(item);
  });
}

/* ---------- 图片附件 ---------- */
function addImageFiles(page, files) {
  if (!files || !files.length) return;
  const strip = $('#ai-attach-strip', page);
  [...files].slice(0, 4).forEach((f) => {
    if (!f.type.startsWith('image/')) { toast('仅支持图片文件', 'err'); return; }
    const rd = new FileReader();
    rd.onload = () => {
      strip.hidden = false;
      const chip = el(`<span class="ai-attach-chip"><img src="${rd.result}"><span class="ai-attach-x" data-x>${icon('close')}</span></span>`);
      chip.dataset.url = rd.result;
      $('[data-x]', chip).onclick = () => { chip.remove(); if (!strip.children.length) strip.hidden = true; };
      strip.appendChild(chip);
    };
    rd.readAsDataURL(f);
  });
}
function takeAttachments(page) {
  const strip = $('#ai-attach-strip', page);
  const urls = $$('.ai-attach-chip', strip).map((c) => c.dataset.url);
  strip.innerHTML = ''; strip.hidden = true;
  return urls;
}

/* ---------- 消息渲染 ---------- */
function renderMessages(page) {
  const box = $('#ai-messages', page);
  box.innerHTML = '';
  if (!session.messages.length) {
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
  session.messages.forEach((m) => appendMessage(page, m));
  scrollBottom(page);
}

function appendMessage(page, m, animate = false) {
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
    return grid;
  }

  const isUser = m.role === 'user';
  const wrap = el(`<div class="msg ${isUser ? 'user' : 'assistant'}">
    <div class="msg-avatar">${isUser ? icon('user') : vendorIcon(m.providerId || currentModel.providerId)}</div>
    <div class="msg-body">
      <div class="msg-meta">${m.debateRole ? `<span class="debate-side debate-${m.debateRole}">${m.debateRole === 'pro' ? '正方' : m.debateRole === 'con' ? '反方' : '裁判'}</span>` : ''}<span>${esc(m.model || '')}</span></div>
      <div class="msg-bubble"></div>
      ${isUser ? '' : '<div class="msg-actions"><button class="msg-act" data-act="copy" title="复制">' + icon('bookmark') + '</button><button class="msg-act" data-act="speak" title="朗读">' + icon('mic') + '</button></div>'}
    </div>
  </div>`);
  const bubble = $('.msg-bubble', wrap);
  if (m.image) bubble.innerHTML = `<div>${esc(m.content || '')}</div><img src="${m.image}" alt="生成图片">`;
  else if (isUser && m.images && m.images.length) bubble.innerHTML = `<div class="msg-imgs">${m.images.map((u) => `<img src="${u}">`).join('')}</div><div>${esc(m.content)}</div>`;
  else if (isUser) bubble.textContent = m.content;
  else bubble.innerHTML = renderMarkdown(m.content);
  bindCopyButtons(wrap);
  const copyBtn = $('[data-act="copy"]', wrap);
  if (copyBtn) copyBtn.onclick = () => { navigator.clipboard.writeText(m.content).then(() => toast('已复制')); };
  const speakBtn = $('[data-act="speak"]', wrap);
  if (speakBtn) speakBtn.onclick = () => speak(m.content);
  box.appendChild(wrap);
  scrollBottom(page);
  return { wrap, bubble };
}

function scrollBottom(page) {
  const box = $('#ai-messages', page);
  if (box) box.scrollTop = box.scrollHeight;
}

/* ---------- 发送 ---------- */
function setSendingUI(page, on) {
  const btn = $('[data-a="send"]', page);
  btn.classList.toggle('stop', on);
  btn.innerHTML = on ? icon('close') : icon('send');
}
function stopSending(page) {
  abortCtl && abortCtl.abort();
}

async function sendMessage(page) {
  const ta = $('.ai-textarea', page);
  let text = ta.value.trim();
  if (sending) return;
  if (!text && !$$('.ai-attach-chip', page).length) return;
  if (!text) text = '请描述这张图片';
  ta.value = ''; ta.style.height = 'auto';
  sending = true;
  setSendingUI(page, true);
  abortCtl = new AbortController();

  const images = takeAttachments(page);
  const userMsg = { role: 'user', content: text, images: images.length ? images : undefined, ts: Date.now() };
  session.messages.push(userMsg);
  appendMessage(page, userMsg);

  try {
    /* 联网搜索：优先使用内置搜索服务，检索后注入上下文 */
    let webCtx = null;
    const webToggle = $('#ai-web-toggle', page);
    if (webToggle && webToggle.classList.contains('on') && currentMode === 'single' && await hasSearchConfig()) {
      toast('正在联网搜索…');
      try {
        const items = await searchWeb(text.replace(/【文件.*?】\n/s, '').slice(0, 200));
        if (items.length) webCtx = resultsToContext(text, items);
        else toast('未搜索到相关内容');
      } catch (e) {
        toast('联网搜索失败：' + e.message, 'err');
      }
    }
    if (currentMode === 'single') await runSingle(page, text, webCtx);
    else if (currentMode === 'compare') await runCompare(page, text);
    else if (currentMode === 'debate') await runDebate(page, text);
    else if (currentMode === 'collab') await runCollab(page, text);
    await saveSession();
  } catch (e) {
    if (e.name !== 'AbortError') {
      if (e.needKey) { toast('请先配置 ' + providerById(e.needKey).name + ' 的 API Key'); showKeySettings(e.needKey); }
      else toast(e.message || '请求失败', 'err');
      const errMsg = { role: 'assistant', content: '⚠️ ' + (e.message || '请求失败'), ts: Date.now() };
      session.messages.push(errMsg);
      appendMessage(page, errMsg);
    }
  }
  sending = false;
  setSendingUI(page, false);
  abortCtl = null;
}

function isVisionModel(sel) {
  if (providerById(sel.providerId).type !== 'openai') return false;
  return /vl|vision|4o|4\.1|gemini|grok|pixtral|glm-4v|kimi-latest|qwen3/i.test(sel.model || '');
}

function historyMessages(limit = 20, sel = null) {
  const vision = sel && isVisionModel(sel);
  return session.messages
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.debateRole))
    .slice(-limit)
    .map((m) => {
      if (m.role === 'user' && m.images && m.images.length) {
        if (vision) {
          return { role: 'user', content: [{ type: 'text', text: m.content || '请描述这张图片' }, ...m.images.map((u) => ({ type: 'image_url', image_url: { url: u } }))] };
        }
        return { role: 'user', content: (m.content || '') + '\n[用户上传了 ' + m.images.length + ' 张图片，当前模型不支持识图]' };
      }
      return { role: m.role, content: m.content };
    });
}

async function runSingle(page, text, webCtx = null) {
  const m = { role: 'assistant', content: '', model: currentModel.model, providerId: currentModel.providerId, ts: Date.now() };
  const { wrap, bubble } = appendMessage(page, m);
  bubble.classList.add('streaming');
  try {
    let msgs = historyMessages(20, currentModel);
    if (webCtx && msgs.length) {
      const last = msgs[msgs.length - 1];
      if (last.role === 'user' && typeof last.content === 'string') {
        msgs = [...msgs.slice(0, -1), { role: 'user', content: webCtx + '\n\n用户问题：' + last.content }];
      } else if (last.role === 'user') {
        msgs = [...msgs.slice(0, -1), { role: 'user', content: [{ type: 'text', text: webCtx }, ...last.content] }];
      }
    }
    const { text: full } = await chat({
      ...currentModel,
      messages: msgs,
      signal: abortCtl.signal,
      onToken: (chunk, acc) => { bubble.innerHTML = renderMarkdown(acc); scrollBottom(page); },
    });
    m.content = full;
  } finally {
    bubble.classList.remove('streaming');
    bubble.innerHTML = renderMarkdown(m.content);
    bindCopyButtons(wrap);
  }
  session.messages.push(m);
}

async function runCompare(page, text) {
  const models = compareModels.length >= 2 ? compareModels : [currentModel];
  const m = { role: 'compare', results: models.map((x) => ({ ...x, text: '', error: null })), ts: Date.now() };
  const gridMsg = appendMessage(page, m);
  const cells = $$('.compare-content', gridMsg);
  await Promise.all(models.map(async (x, i) => {
    cells[i].classList.add('streaming');
    try {
      const { text: full } = await chat({
        ...x,
        messages: [...historyMessages(-1), { role: 'user', content: text }],
        signal: abortCtl.signal,
        onToken: (c, acc) => { cells[i].innerHTML = renderMarkdown(acc); },
      });
      m.results[i].text = full;
    } catch (e) {
      m.results[i].error = e.message;
      cells[i].innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`;
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
    // 正方
    const proMsg = { role: 'assistant', debateRole: 'pro', content: '', model: pro.model, providerId: pro.providerId, ts: Date.now() };
    let h1 = appendMessage(page, proMsg);
    h1.bubble.classList.add('streaming');
    const proPrompt = `你是辩论赛正方辩手。辩题：「${topic}」。${proArgs.length ? '你之前的论点：' + proArgs.join('；') + '。反方论点：' + conArgs.join('；') + '。请进行第 ' + (r + 1) + ' 轮陈词，反驳反方并强化己方观点' : '请进行开篇立论'}，150 字以内。`;
    const r1 = await chat({ ...pro, messages: [{ role: 'user', content: proPrompt }], signal: abortCtl.signal, onToken: (c, a) => { h1.bubble.innerHTML = renderMarkdown(a); scrollBottom(page); } });
    proMsg.content = r1.text; h1.bubble.classList.remove('streaming'); h1.bubble.innerHTML = renderMarkdown(r1.text);
    proArgs.push(r1.text);
    session.messages.push(proMsg);

    // 反方
    const conMsg = { role: 'assistant', debateRole: 'con', content: '', model: con.model, providerId: con.providerId, ts: Date.now() };
    let h2 = appendMessage(page, conMsg);
    h2.bubble.classList.add('streaming');
    const conPrompt = `你是辩论赛反方辩手。辩题：「${topic}」。正方最新论点：${r1.text}。${conArgs.length ? '你之前的论点：' + conArgs.join('；') + '。' : ''}请进行第 ${r + 1} 轮反驳陈词，150 字以内。`;
    const r2 = await chat({ ...con, messages: [{ role: 'user', content: conPrompt }], signal: abortCtl.signal, onToken: (c, a) => { h2.bubble.innerHTML = renderMarkdown(a); scrollBottom(page); } });
    conMsg.content = r2.text; h2.bubble.classList.remove('streaming'); h2.bubble.innerHTML = renderMarkdown(r2.text);
    conArgs.push(r2.text);
    session.messages.push(conMsg);
  }

  // 裁判总结
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
  // 1. 各模型独立回答
  const answers = [];
  for (const x of models) {
    const { text: full } = await chat({ ...x, messages: [...historyMessages(-1), { role: 'user', content: text }], signal: abortCtl.signal });
    answers.push({ model: x, text: full });
  }
  // 2. 汇总模型协作修订
  const editor = models[0];
  const m = { role: 'assistant', content: '', model: editor.model + '（协同汇总）', providerId: editor.providerId, ts: Date.now() };
  const { bubble } = appendMessage(page, m);
  bubble.classList.add('streaming');
  const prompt = `用户问题：「${text}」\n\n以下是 ${answers.length} 个 AI 的回答草稿：\n${answers.map((a, i) => `【草稿${i + 1}（${a.model.model}）】\n${a.text}`).join('\n\n')}\n\n请综合各草稿优点，输出一份最优的最终回答。`;
  const { text: final } = await chat({ ...editor, messages: [{ role: 'user', content: prompt }], signal: abortCtl.signal, onToken: (c, a) => { bubble.innerHTML = renderMarkdown(a); scrollBottom(page); } });
  bubble.classList.remove('streaming');
  m.content = final;
  bubble.innerHTML = renderMarkdown(final);
  session.messages.push(m);
}

/* ---------- 语音输入 ---------- */
function voiceFlow(btn, ta) {
  if (btn.classList.contains('recording')) {
    stopRecognition();
    btn.classList.remove('recording');
    return;
  }
  const r = startRecognition({
    onResult: (final, interim) => { ta.value = final || interim; },
    onEnd: () => btn.classList.remove('recording'),
    onError: (e) => { btn.classList.remove('recording'); toast(e.message === 'not-allowed' ? '请授权麦克风权限' : '语音识别不可用', 'err'); },
  });
  if (r) { btn.classList.add('recording'); toast('正在聆听…'); }
}

/* ---------- 模型列表子页面（aiBeta 式：搜索 + 同步 + 厂商分组卡片） ---------- */
function modelTags(p, m) {
  const tags = [];
  const s = (p.id + '/' + m).toLowerCase();
  if (/vl|vision|4o|4\.1|gemini|grok|pixtral|glm-4v|kimi-latest|seedream/i.test(s)) tags.push(['vision', '识图']);
  if (/reasoner|r1|thinking|qwq|o1|o3|o4|z1|think/i.test(s)) tags.push(['thinking', '深度思考']);
  if (/long|128k|256k|1m|kimi|max/i.test(s)) tags.push(['long', '长上下文']);
  tags.push(['stream', '流式输出']);
  return tags;
}

async function showModelsPage(page) {
  const { PROVIDERS } = await import('../ai/ai-models.js');
  const syncedAll = (await kvGet('ai:synced-models', {})) || {};

  const ov = openOverlay({
    title: '模型列表',
    headExtra: `<button class="icon-btn" data-a="sync" title="从已配置 Key 的厂商拉取最新模型列表">${icon('refresh')}</button>`,
    build: async (body, close) => {
      body.innerHTML = `
        <div class="models-page">
          <div class="models-search">
            <div class="models-search-box">${icon('search')}<input class="models-search-input" placeholder="搜索模型或厂商…"></div>
          </div>
          <div class="models-hint" id="models-hint">点击模型卡片直接发起对话；「同步模型」可从已配置 Key 的厂商拉取最新模型列表</div>
          <div id="models-list"></div>
        </div>`;
      const listEl = $('#models-list', body);
      const hintEl = $('#models-hint', body);

      async function render(filter = '') {
        const kw = filter.trim().toLowerCase();
        listEl.innerHTML = '';
        for (const p of PROVIDERS) {
          const staticModels = p.models || [];
          const synced = syncedAll[p.id] || [];
          const merged = [...staticModels, ...synced.filter((m) => !staticModels.includes(m))];
          const imgs = (p.image || []).map((m) => ({ id: m, img: true }));
          let items = merged.map((m) => ({ id: m, isNew: !staticModels.includes(m) })).concat(imgs.map((x) => ({ id: x.id, img: true })));
          items = items.filter((x) => !kw || x.id.toLowerCase().includes(kw) || p.name.toLowerCase().includes(kw));
          if (!items.length) continue;
          const hasKey = !!(await getApiKey(p.id));
          const sec = el(`<div class="provider-section">
            <div class="provider-head">
              <span class="provider-ico">${vendorIcon(p.id)}</span>
              <span class="provider-name">${esc(p.name)}</span>
              <span class="provider-count">${items.length} 个模型</span>
              ${hasKey ? '<span class="tag tag-green">Key 已配置</span>' : '<span class="tag tag-gray provider-key-link">Key 未配置 →</span>'}
            </div>
            <div class="model-grid"></div>
          </div>`);
          const grid = $('.model-grid', sec);
          items.forEach((x) => {
            const tags = x.img ? [['new', '绘画']] : modelTags(p, x.id);
            if (x.isNew) tags.unshift(['new', '新上线']);
            const card = el(`<button class="model-card">
              <span class="model-card-ico">${vendorIcon(p.id)}</span>
              <span class="model-card-info">
                <span class="model-card-name ellipsis">${esc(x.id)}</span>
                <span class="model-card-tags">${tags.map(([c, t]) => `<span class="mtag ${c}">${t}</span>`).join('')}</span>
              </span>
              <span class="model-card-go">${icon('arrowR')}</span>
            </button>`);
            card.onclick = async () => {
              if (!(await getApiKey(p.id))) { close(); showKeySettings(p.id); return; }
              currentModel = { providerId: p.id, model: x.id };
              await kvSet('ai:last-model', currentModel);
              if (currentMode !== 'single') { currentMode = 'single'; await kvSet('ai:last-mode', 'single'); }
              updatePills(page);
              close();
              toast('已切换到 ' + x.id, 'ok');
            };
            grid.appendChild(card);
          });
          if (!hasKey) $('.provider-key-link', sec).onclick = () => { close(); showKeySettings(p.id); };
          listEl.appendChild(sec);
        }
        if (!listEl.children.length) listEl.innerHTML = '<div class="empty"><div class="empty-title">没有找到匹配的模型</div></div>';
      }
      await render();
      $('.models-search-input', body).addEventListener('input', (e) => render(e.target.value));

      $('[data-a="sync"]', ov.ov).onclick = async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('spinning');
        let okCount = 0, tried = 0;
        for (const p of PROVIDERS) {
          const key = await getApiKey(p.id);
          const base = (await getBaseOverride(p.id)) || p.base;
          if (!key || !base || p.type !== 'openai') continue;
          tried++;
          try {
            const r = await fetch(base.replace(/\/$/, '') + '/models', { headers: { Authorization: 'Bearer ' + key } });
            if (!r.ok) continue;
            const data = await r.json();
            const ids = (data.data || []).map((m) => m.id).filter(Boolean);
            if (ids.length) { syncedAll[p.id] = ids; okCount++; }
          } catch (err) {}
        }
        btn.classList.remove('spinning');
        if (!tried) { hintEl.textContent = '还没有配置任何厂商 Key，请先在「API 设置」中配置'; toast('请先配置 API Key'); return; }
        await kvSet('ai:synced-models', syncedAll);
        await render($('.models-search-input', body).value || '');
        hintEl.textContent = okCount ? `同步完成：${okCount} 家厂商模型列表已更新（新模型已标记「新上线」）` : '同步失败：未拉取到模型列表';
        toast(okCount ? `同步完成：${okCount} 家厂商已更新` : '同步失败', okCount ? 'ok' : 'err');
      };
    },
  });
}

async function drawFlow(page) {
  const body = el(`<div>${formRow('提示词（英文效果更好）', '<textarea class="input" rows="3" data-f="prompt" placeholder="a cat sitting on the moon, digital art"></textarea>')}${formRow('尺寸', '<select class="input" data-f="size"><option>1024x1024</option><option>1024x1792</option><option>1792x1024</option></select>')}</div>`);
  const m = modal({
    title: 'AI 绘画',
    body,
    footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="go">生成</button>',
  });
  $('[data-a="cancel"]', m.mask).onclick = m.close;
  $('[data-a="go"]', m.mask).onclick = async () => {
    const prompt = $('[data-f="prompt"]', body).value.trim();
    const size = $('[data-f="size"]', body).value;
    if (!prompt) return toast('请输入提示词');
    m.close();
    const userMsg = { role: 'user', content: '🎨 绘画：' + prompt, ts: Date.now() };
    session.messages.push(userMsg);
    appendMessage(page, userMsg);
    const loading = { role: 'assistant', content: '正在生成图片…', ts: Date.now() };
    const { bubble } = appendMessage(page, loading);
    try {
      const url = await drawImage({ ...currentModel, model: (providerById(currentModel.providerId).image || [])[0] || 'dall-e-3', prompt, size });
      loading.content = prompt; loading.image = url;
      bubble.innerHTML = `<img src="${url}" alt="生成图片">`;
    } catch (e) {
      loading.content = '⚠️ 绘画失败：' + e.message;
      bubble.textContent = loading.content;
    }
    session.messages.push(loading);
    await saveSession();
  };
}

/* ---------- API Key 设置 ---------- */
export async function showKeySettings(focusProvider = null) {
  const { PROVIDERS } = await import('../ai/ai-models.js');
  const body = el('<div class="col gap8"></div>');

  /* 顶部快捷入口：自动识别 + 联网搜索服务 */
  const tools = el(`<div class="row gap8" style="margin-bottom:4px">
    <button class="btn btn-primary grow" data-a="identify">${icon('search')} 自动识别 Key</button>
    <button class="btn grow" data-a="websearch">${icon('globe')} 联网搜索服务</button>
  </div>`);
  body.appendChild(tools);
  $('[data-a="identify"]', tools).onclick = () => showIdentifyDialog();
  $('[data-a="websearch"]', tools).onclick = () => showSearchServiceDialog();

  for (const p of PROVIDERS) {
    if (!p.models.length && !p.image) continue;
    const key = await getApiKey(p.id);
    const item = el(`<button class="list-item">
      <span class="list-ico" style="background:none">${vendorIcon(p.id)}</span>
      <div class="grow" style="text-align:left;min-width:0">
        <div style="font-size:14px;font-weight:600">${esc(p.name)}</div>
        <div class="muted">${key ? '已配置 API Key' : '未配置'}</div>
      </div>
      ${key ? icon('check') : ''}
    </button>`);
    item.onclick = () => editProviderKey(p);
    body.appendChild(item);
  }
  modal({ title: 'API 密钥管理', body });
}

async function editProviderKey(p) {
  const key = await getApiKey(p.id);
  const base = await getBaseOverride(p.id);
  const body = el(`<div>
    <div class="row gap8 mb16"><span style="width:32px;height:32px">${vendorIcon(p.id)}</span><div><div style="font-weight:700">${esc(p.name)}</div><div class="muted">${esc(p.base || '需填写接口地址')}</div></div></div>
    ${formRow('API Key', `<input class="input" data-f="key" type="password" value="${esc(key)}" placeholder="sk-...">`)}
    ${formRow('自定义接口地址（可选，留空用官方）', `<input class="input" data-f="base" value="${esc(base)}" placeholder="${esc(p.base || 'https://...')}">`)}
  </div>`);
  const m = modal({
    title: '配置 ' + p.name, body,
    footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn grow" data-a="verify">对话验证</button><button class="btn btn-primary grow" data-a="save">保存</button>',
  });
  $('[data-a="cancel"]', m.mask).onclick = m.close;
  $('[data-a="verify"]', m.mask).onclick = async (e) => {
    const key = $('[data-f="key"]', body).value.trim();
    if (!key) return toast('请先输入 Key');
    e.target.disabled = true;
    e.target.textContent = '正在真实对话验证…';
    try {
      const r = await testProviderKey(p.id, key);
      toast(`验证通过：${p.name} · ${r.model} 已正常返回对话`, 'ok');
    } catch (err) {
      toast('验证失败：' + err.message, 'err');
    }
    e.target.disabled = false;
    e.target.textContent = '对话验证';
  };
  $('[data-a="save"]', m.mask).onclick = async () => {
    await setApiKey(p.id, $('[data-f="key"]', body).value);
    await setBaseOverride(p.id, $('[data-f="base"]', body).value);
    m.close();
    toast('已保存', 'ok');
  };
}

/* ---------- 自动识别 API Key（真实对话验证） ---------- */
function showIdentifyDialog() {
  const body = el(`<div>
    ${formRow('粘贴任意厂商的 API Key', '<textarea class="input" rows="3" data-f="key" placeholder="sk-... / sk-ant-... / AIza... 等"></textarea>')}
    <div class="muted" style="margin-bottom:10px;line-height:1.7">识别不靠猜前缀：程序会逐个厂商发送<b>真实对话请求</b>，哪家成功返回对话结果，Key 就属于哪家。</div>
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
      setTimeout(() => { m.close(); showKeySettings(); }, 900);
    } catch (err) {
      logEl.appendChild(el(`<div class="identify-line" style="color:var(--danger)">${esc(err.message)}</div>`));
      toast('识别失败', 'err');
    }
    e.target.disabled = false;
    e.target.textContent = '开始识别';
  };
}

/* ---------- 联网搜索服务配置 ---------- */
async function showSearchServiceDialog() {
  const cfg = await getSearchConfig();
  const body = el(`<div>
    <div class="muted" style="margin-bottom:10px;line-height:1.7">已内置主流联网搜索服务，填入对应 Key 即可在对话中使用「联网搜索」。</div>
    <div class="col gap8" data-v="list"></div>
    <div data-v="form" style="display:none;margin-top:12px">
      ${formRow('API Key', '<input class="input" data-f="key" type="password" placeholder="搜索服务的 Key">')}
      ${formRow('实例地址（仅 SearXNG 需要）', '<input class="input" data-f="url" placeholder="https://searx.example.com">')}
    </div>
  </div>`);
  const listEl = $('[data-v="list"]', body);
  const formEl = $('[data-v="form"]', body);
  let sel = cfg.service || '';
  function renderList() {
    listEl.innerHTML = '';
    SEARCH_SERVICES.forEach((s) => {
      const b = el(`<button class="list-item" style="width:100%;${sel === s.id ? 'border:1.5px solid var(--primary)' : ''}">
        <span class="list-ico">${icon('globe')}</span>
        <div class="grow" style="text-align:left;min-width:0">
          <div style="font-size:14px;font-weight:600">${s.name}</div>
          <div class="muted">${s.desc} · Key：${s.keyHint}</div>
        </div>
        ${sel === s.id ? icon('check') : ''}
      </button>`);
      b.onclick = () => {
        sel = s.id;
        formEl.style.display = 'block';
        renderList();
      };
      listEl.appendChild(b);
    });
    if (sel) formEl.style.display = 'block';
  }
  renderList();
  if (cfg.key) $('[data-f="key"]', body).value = cfg.key;
  if (cfg.url) $('[data-f="url"]', body).value = cfg.url;

  const m = modal({
    title: '联网搜索服务', body,
    footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="save">保存</button>',
  });
  $('[data-a="cancel"]', m.mask).onclick = m.close;
  $('[data-a="save"]', m.mask).onclick = async () => {
    if (!sel) return toast('请选择一个搜索服务');
    await setSearchConfig({ service: sel, key: $('[data-f="key"]', body).value, url: $('[data-f="url"]', body).value });
    m.close();
    toast('联网搜索服务已保存', 'ok');
  };
}

/* ---------- MCP 面板 ---------- */
async function showMcpPanel() {
  const servers = await listMcpServers();
  const body = el('<div class="col gap8"></div>');

  function render() {
    body.innerHTML = '';
    if (!servers.length) body.innerHTML = '<div class="empty"><div class="empty-title">还没有 MCP 服务</div><div class="muted">添加支持 SSE/HTTP 传输的远程 MCP Server</div></div>';
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
        if (s.status === 'connected') { const { disconnectMcp } = await import('../ai/mcp-client.js'); disconnectMcp(s.id); }
        else { toast('连接中…'); await connectMcp(s.id); }
        render();
      };
      $('[data-a="del"]', item).onclick = async () => { await removeMcpServer(s.id); render(); };
      body.appendChild(item);
    });
    const addBtn = el(`<button class="btn btn-block btn-primary mt8">${icon('plus')} 添加 MCP Server</button>`);
    addBtn.onclick = () => addMcpDialog(render);
    body.appendChild(addBtn);
  }
  render();
  modal({ title: 'MCP 服务管理', body });
}

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
