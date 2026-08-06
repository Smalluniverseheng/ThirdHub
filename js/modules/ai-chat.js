/* ===== ThirdHub js/modules/ai-chat.js — AI 对话页 ===== */
import { $, $$, el, esc, icon, toast, modal, actionSheet, openOverlay, formRow, uid, fmtDate } from '../ui.js';
import { db, kvGet, kvSet, on } from '../store.js';
import { chat, drawImage, getApiKey, setApiKey, getBaseOverride, setBaseOverride, supportsWebSearch, refreshFreeModels, getFreeModel } from '../ai/ai-api.js';
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

  page.innerHTML = `
    <div class="page-head">
      <div class="page-title">AI</div>
      <div class="spacer"></div>
      <button class="icon-btn" data-a="history" title="历史会话">${icon('history')}</button>
      <button class="icon-btn" data-a="mcp" title="MCP 服务">${icon('plug')}</button>
      <button class="icon-btn" data-a="keys" title="API 设置">${icon('key')}</button>
      <button class="icon-btn" data-a="new" title="新对话">${icon('plus')}</button>
    </div>
    <div class="ai-wrap" style="height:calc(100% - 66px)">
      <div class="ai-toolbar">
        <button class="ai-pill" data-a="model"><span class="pill-ico"></span><span class="pill-text"></span><span class="pill-arrow">▾</span></button>
        <button class="ai-pill" data-a="mode"><span class="pill-text"></span><span class="pill-arrow">▾</span></button>
      </div>
      <div class="ai-messages" id="ai-messages"></div>
      <div class="ai-inputbar">
        <div class="ai-input-row">
          <button class="ai-tool-btn" data-a="attach" title="文件/绘画">${icon('attach')}</button>
          <button class="ai-tool-btn" data-a="voice" title="语音输入">${icon('mic')}</button>
          <button class="ai-tool-btn" data-a="web" title="联网搜索">${icon('globe')}</button>
          <textarea class="ai-textarea" rows="1" placeholder="输入消息…"></textarea>
          <button class="ai-send" data-a="send">${icon('send')}</button>
        </div>
        <div class="ai-token-hint" id="ai-token-hint"></div>
      </div>
    </div>`;

  await newSession();
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

  $('[data-a="send"]', page).onclick = () => sending ? stopSending(page) : sendMessage(page);
  $('[data-a="model"]', page).onclick = () => pickModelFlow(page);
  $('[data-a="mode"]', page).onclick = () => pickModeFlow(page);
  $('[data-a="new"]', page).onclick = () => { newSession(); renderMessages(page); toast('已开始新对话'); };
  $('[data-a="history"]', page).onclick = () => showSessions(page);
  $('[data-a="keys"]', page).onclick = () => showKeySettings();
  $('[data-a="mcp"]', page).onclick = () => showMcpPanel();
  $('[data-a="web"]', page).onclick = (e) => {
    if (!supportsWebSearch(currentModel.providerId)) { toast('当前模型不支持联网搜索，可切换 Perplexity / 智谱 / 通义 / Grok / Gemini'); return; }
    e.currentTarget.classList.toggle('on');
    toast(e.currentTarget.classList.contains('on') ? '联网搜索已开启' : '联网搜索已关闭');
  };
  $('[data-a="voice"]', page).onclick = (e) => voiceFlow(e.currentTarget, ta);
  $('[data-a="attach"]', page).onclick = () => attachFlow(page);
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

async function showSessions(page) {
  const list = (await db.all('chats')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const body = el('<div class="col gap8"></div>');
  if (!list.length) body.innerHTML = '<div class="empty"><div class="empty-title">暂无历史会话</div></div>';
  list.forEach((s) => {
    const item = el(`<button class="chat-session ${s.id === session.id ? 'on' : ''}">
      <span class="list-ico">${icon('robot')}</span>
      <div class="grow" style="text-align:left;min-width:0">
        <div class="ellipsis" style="font-size:14px;font-weight:600">${esc(s.title)}</div>
        <div class="muted">${fmtDate(s.updatedAt || s.createdAt, true)}</div>
      </div>
      <button class="msg-act" data-del>${icon('trash')}</button>
    </button>`);
    item.onclick = async (e) => {
      if (e.target.closest('[data-del]')) return;
      session = s; m.close(); renderMessages(page);
    };
    $('[data-del]', item).onclick = async () => { await db.del('chats', s.id); item.remove(); };
    body.appendChild(item);
  });
  const m = modal({ title: '历史会话', body });
}

/* ---------- 消息渲染 ---------- */
function renderMessages(page) {
  const box = $('#ai-messages', page);
  box.innerHTML = '';
  if (!session.messages.length) {
    box.innerHTML = `<div class="empty" style="margin-top:40px">
      <div class="empty-ico" style="width:88px;height:88px">${vendorIcon(currentModel.providerId)}</div>
      <div class="empty-title">有什么可以帮你？</div>
      <div class="muted">已选模型：${esc(currentModel.model)}</div>
    </div>`;
    return;
  }
  session.messages.forEach((m) => appendMessage(page, m));
  scrollBottom(page);
}

function appendMessage(page, m, animate = false) {
  const box = $('#ai-messages', page);
  const empty = $('.empty', box);
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
  const text = ta.value.trim();
  if (!text || sending) return;
  ta.value = ''; ta.style.height = 'auto';
  sending = true;
  setSendingUI(page, true);
  abortCtl = new AbortController();

  const userMsg = { role: 'user', content: text, ts: Date.now() };
  session.messages.push(userMsg);
  appendMessage(page, userMsg);

  try {
    if (currentMode === 'single') await runSingle(page, text);
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

function historyMessages(limit = 20) {
  return session.messages
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.debateRole))
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content }));
}

async function runSingle(page, text) {
  const m = { role: 'assistant', content: '', model: currentModel.model, providerId: currentModel.providerId, ts: Date.now() };
  const { wrap, bubble } = appendMessage(page, m);
  bubble.classList.add('streaming');
  try {
    const { text: full } = await chat({
      ...currentModel,
      messages: historyMessages(),
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

/* ---------- 附件/绘画 ---------- */
async function attachFlow(page) {
  const v = await actionSheet('更多功能', [
    { label: 'AI 绘画（文生图）', icon: 'image', value: 'draw' },
    { label: '上传图片对话（视觉模型）', icon: 'attach', value: 'img' },
  ]);
  if (v === 'draw') drawFlow(page);
  else if (v === 'img') toast('请在输入框直接粘贴图片链接，或选择支持视觉的模型');
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
    footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="save">保存</button>',
  });
  $('[data-a="cancel"]', m.mask).onclick = m.close;
  $('[data-a="save"]', m.mask).onclick = async () => {
    await setApiKey(p.id, $('[data-f="key"]', body).value);
    await setBaseOverride(p.id, $('[data-f="base"]', body).value);
    m.close();
    toast('已保存', 'ok');
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
