/* ===== ThirdHub js/modules/ai-settings.js — 对话设置 + 更多设置中心（v1.6） =====
   对话设置：名称 / 系统提示 / 上下文上限 / 温度 / TopP / 最大输出Token / 背景图
   更多设置：偏好设置 · 会话与上下文 · 语音输入(ASR) · 语音合成(TTS) · 记忆系统 · 用量统计 · 工具中心 · 提供商与模型管理 */
import { $, $$, el, esc, icon, toast, openOverlay, confirmDialog, formRow, modal, actionSheet } from '../ui.js';
import { kvGet, kvSet, getSetting, setSetting, db } from '../store.js';
import { PROVIDERS, providerById } from '../ai/ai-models.js';
import { vendorIcon } from '../ai/vendors.js';
import { pickModel } from '../ai/model-selector.js';
import { getApiKey } from '../ai/ai-api.js';
import { TTS_ENGINES } from '../voice.js';
import { listMcpServers } from '../ai/mcp-client.js';
import { getTotalStats, getDailyStats, getModelStats, getCostBreakdown, fmtTokens } from '../token-meter.js';
import { fmtUsd, usdToCnyRate } from '../ai/ai-pricing.js';

/* ================= 配置读写（带默认值） ================= */
const PREF_DEF = {
  tempOn: false, temperature: 0.7, topPOn: false, topP: 0.9,
  stream: true, thinkSummary: true, cotReturn: true,
  speedTest: false, usageInStream: false,
};
const CTX_DEF = { autoTitle: false, ctxLimit: 20, compressHint: false, compressThreshold: 40 };

export async function getChatPrefs() { return { ...PREF_DEF, ...(await kvGet('ai:prefs', {})) }; }
export async function getCtxConf() { return { ...CTX_DEF, ...(await kvGet('ai:ctx', {})) }; }

/* ================= 通用小部件 ================= */
function secTitle(t) { return `<div class="set-sec">${esc(t)}</div>`; }

function toggleRow(name, sub, on, onChange) {
  const row = el(`<div class="set-row">
    <div class="set-row-info"><div class="set-row-name">${esc(name)}</div>${sub ? `<div class="set-row-sub">${esc(sub)}</div>` : ''}</div>
    <button class="ai-toggle ${on ? 'on' : ''}"></button>
  </div>`);
  const t = $('.ai-toggle', row);
  t.onclick = () => { t.classList.toggle('on'); onChange(t.classList.contains('on')); };
  return row;
}

function sliderRow(name, sub, { min, max, step, val, fmt }) {
  const row = el(`<div class="set-row col" style="align-items:stretch">
    <div class="row" style="justify-content:space-between">
      <div class="set-row-info"><div class="set-row-name">${esc(name)}</div>${sub ? `<div class="set-row-sub">${esc(sub)}</div>` : ''}</div>
      <span class="set-slider-val"></span>
    </div>
    <input type="range" class="set-slider" min="${min}" max="${max}" step="${step}" value="${val}">
  </div>`);
  const slider = $('.set-slider', row), out = $('.set-slider-val', row);
  const show = () => { out.textContent = fmt(+slider.value); };
  slider.addEventListener('input', show);
  show();
  return { row, get: () => +slider.value };
}

/* 数字输入行（替代滑条，支持任意大数值，如百万级上下文 / Token 上限） */
function numRow(name, sub, { min = 0, max = null, step = 1, val = 0, unit = '', placeholder = '' }) {
  const row = el(`<div class="set-row">
    <div class="set-row-info"><div class="set-row-name">${esc(name)}</div>${sub ? `<div class="set-row-sub">${esc(sub)}</div>` : ''}</div>
    <div class="row gap8" style="align-items:center;flex-shrink:0">
      <input type="number" class="input set-num" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} step="${step}" value="${val}" placeholder="${esc(placeholder || String(min))}">
      ${unit ? `<span class="muted" style="font-size:12px">${esc(unit)}</span>` : ''}
    </div>
  </div>`);
  const inp = $('input', row);
  const clamp = (v) => {
    if (min != null && v < min) v = min;
    if (max != null && v > max) v = max;
    return v;
  };
  inp.addEventListener('change', () => { const v = clamp(parseFloat(inp.value)); inp.value = isNaN(v) ? min : v; inp.dispatchEvent(new Event('numchange')); });
  return { row, input: inp, get: () => { const v = parseFloat(inp.value); return isNaN(v) ? null : clamp(v); } };
}

function entryRow(ic, name, sub) {
  return el(`<button class="list-item" style="width:100%">
    <span class="list-ico">${icon(ic)}</span>
    <div class="grow" style="text-align:left;min-width:0">
      <div style="font-size:14px;font-weight:600">${esc(name)}</div>
      ${sub ? `<div class="muted">${esc(sub)}</div>` : ''}
    </div>
    ${icon('arrowR')}
  </button>`);
}

/* ================= 对话设置（当前会话，保存为默认模板） ================= */
export async function showChatSettings(page, session, onChange) {
  const s = { ...(await kvGet('ai:chat-def', {})), ...((session && session.settings) || {}) };
  let bgImage = s.bgImage || '';
  openOverlay({
    title: '对话设置',
    build: (body) => {
      body.innerHTML = `<div class="set-wrap">
        ${secTitle('基础')}
        ${formRow('会话名称', `<input class="input" data-f="name" value="${esc(session && session.title !== '新对话' ? session.title : (s.name || ''))}" placeholder="新对话">`)}
        ${formRow('系统提示（System Prompt）', `<textarea class="input" rows="4" data-f="system" placeholder="例如：你是一名资深前端工程师，回答简洁专业">${esc(s.system || '')}</textarea>`)}
        ${secTitle('生成')}
        <div data-v="ctx"></div><div data-v="temp"></div><div data-v="topp"></div><div data-v="maxtok"></div>
        ${secTitle('外观')}
        <div class="set-row">
          <div class="set-row-info"><div class="set-row-name">对话背景图片</div><div class="set-row-sub">上传后作为消息区背景</div></div>
          <div class="row gap8">
            <button class="btn btn-sm" data-a="bg">${bgImage ? '更换' : '上传'}</button>
            ${bgImage ? '<button class="btn btn-sm btn-danger" data-a="bgclear">清除</button>' : ''}
          </div>
          <input type="file" accept="image/*" data-f="bgfile" hidden>
        </div>
        <div class="row gap8" style="margin-top:18px">
          <button class="btn grow" data-a="reset">恢复默认</button>
          <button class="btn btn-primary grow" data-a="save">保存</button>
        </div>
      </div>`;

      const ctxS = numRow('上下文消息数量上限', '每次请求携带的最大历史消息数（长文本场景可调至数千甚至更高）', { min: 1, max: null, step: 1, val: s.ctxLimit || 20, unit: '条' });
      const tempS = numRow('温度 Temperature', '越高越发散，越低越严谨（常见 0 ~ 2）', { min: 0, max: 5, step: 0.01, val: s.temperature != null ? s.temperature : 0.7 });
      const topPS = numRow('Top P', '核采样比例（0 ~ 1）', { min: 0, max: 1, step: 0.01, val: s.topP != null ? s.topP : 0.9 });
      const maxS = numRow('最大输出 Token 数', '0 = 不限制；可自定义任意数值（如 8192 / 65536）', { min: 0, max: null, step: 1, val: s.maxTokens || 0, unit: 'tokens' });
      $('[data-v="ctx"]', body).appendChild(toggleRow('自定义上下文上限', '', s.ctxLimit != null, (on) => { ctxS.row.style.display = on ? '' : 'none'; }));
      $('[data-v="ctx"]', body).appendChild(ctxS.row);
      ctxS.row.style.display = s.ctxLimit != null ? '' : 'none';
      $('[data-v="temp"]', body).appendChild(toggleRow('自定义温度', '', s.temperature != null, (on) => { tempS.row.style.display = on ? '' : 'none'; }));
      $('[data-v="temp"]', body).appendChild(tempS.row);
      tempS.row.style.display = s.temperature != null ? '' : 'none';
      $('[data-v="topp"]', body).appendChild(toggleRow('自定义 Top P', '', s.topP != null, (on) => { topPS.row.style.display = on ? '' : 'none'; }));
      $('[data-v="topp"]', body).appendChild(topPS.row);
      topPS.row.style.display = s.topP != null ? '' : 'none';
      $('[data-v="maxtok"]', body).appendChild(maxS.row);

      $('[data-a="bg"]', body).onclick = () => $('[data-f="bgfile"]', body).click();
      $('[data-f="bgfile"]', body).onchange = (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => { bgImage = rd.result; toast('背景已选择，保存后生效', 'ok'); };
        rd.readAsDataURL(f);
      };
      const bgClear = $('[data-a="bgclear"]', body);
      if (bgClear) bgClear.onclick = () => { bgImage = ''; toast('已清除背景，保存后生效'); };

      const toggles = $$('.ai-toggle', body);
      $('[data-a="save"]', body).onclick = async () => {
        const ns = {
          system: $('[data-f="system"]', body).value.trim(),
          ctxLimit: toggles[0].classList.contains('on') ? ctxS.get() : null,
          temperature: toggles[1].classList.contains('on') ? tempS.get() : null,
          topP: toggles[2].classList.contains('on') ? topPS.get() : null,
          maxTokens: maxS.get() || null,
          bgImage: bgImage || '',
        };
        Object.keys(ns).forEach((k) => (ns[k] == null || ns[k] === '') && delete ns[k]);
        if (session) {
          session.settings = ns;
          const name = $('[data-f="name"]', body).value.trim();
          if (name) session.title = name;
          if (session.messages && session.messages.length) await db.put('chats', JSON.parse(JSON.stringify(session)));
        }
        await kvSet('ai:chat-def', ns);
        toast('对话设置已保存', 'ok');
        onChange && onChange();
      };
      $('[data-a="reset"]', body).onclick = async () => {
        if (!(await confirmDialog('恢复默认对话设置？', '将清空系统提示、采样参数与背景图', '恢复', true))) return;
        if (session) session.settings = {};
        await kvSet('ai:chat-def', {});
        toast('已恢复默认', 'ok');
        onChange && onChange();
      };
    },
  });
}

/* ================= 更多设置中心 ================= */
export function showAdvSettings(page) {
  openOverlay({
    title: '更多设置',
    build: (body) => {
      body.innerHTML = `<div class="set-wrap col gap8" id="adv-list"></div>`;
      const list = $('#adv-list', body);
      const add = (ic, name, sub, fn) => { const r = entryRow(ic, name, sub); r.onclick = fn; list.appendChild(r); };
      add('edit', '对话设置', '当前会话的系统提示 / 采样 / 背景', async () => { const m = await import('./ai-chat.js'); m.openChatSettings(page); });
      add('palette', '偏好设置', '采样参数 · 流式输出 · 思考摘要 · 测速', () => subPrefs());
      add('history', '会话与上下文', '话题标题 · 上下文窗口 · 压缩提醒', () => subCtx());
      add('mic', '语音输入', '浏览器识别或模型 ASR（Whisper 兼容）', () => subASR());
      add('headphone', '语音合成 TTS', '播放模式 · 引擎 · 音色 · 语速音调', () => subTTS());
      add('bookmark', '记忆系统', '跨对话长期记忆与记忆库管理', () => subMemory());
      add('chart', '用量统计', 'Token 总览 · 活跃热图 · 模型榜单', () => subUsage());
      add('plug', '工具中心', '内置工具与 MCP 工具的暴露开关', () => subTools());
      add('globe', '模块代理设置', '各模块独立选择直连 / 自有代理 / 云端代理', async () => { const px = await import('./proxy-settings.js'); px.showProxySettings(); });
      add('cpu', '提供商与模型管理', '密钥 · 模型列表 · 专用模型', () => subProviders(page));
    },
  });
}

/* ---------- 偏好设置 ---------- */
function subPrefs() {
  openOverlay({
    title: '偏好设置',
    build: async (body) => {
      const p = await getChatPrefs();
      body.innerHTML = `<div class="set-wrap">
        ${secTitle('采样参数（全局默认，对话设置可覆盖）')}
        <div data-v="temp"></div><div data-v="topp"></div>
        ${secTitle('生成与输出')}
        <div data-v="flags"></div>
      </div>`;
      const save = () => kvSet('ai:prefs', p);
      const tempS = numRow('温度 Temperature', '常见 0 ~ 2，可精确到小数点后两位', { min: 0, max: 5, step: 0.01, val: p.temperature });
      const topPS = numRow('Top P', '0 ~ 1，可精确到小数点后两位', { min: 0, max: 1, step: 0.01, val: p.topP });
      $('[data-v="temp"]', body).appendChild(toggleRow('启用温度调节', '关闭时使用厂商默认值', p.tempOn, (on) => { p.tempOn = on; tempS.row.style.display = on ? '' : 'none'; save(); }));
      $('[data-v="temp"]', body).appendChild(tempS.row);
      tempS.row.style.display = p.tempOn ? '' : 'none';
      tempS.input.addEventListener('numchange', () => { p.temperature = tempS.get(); save(); });
      $('[data-v="topp"]', body).appendChild(toggleRow('启用 Top P 调节', '关闭时使用厂商默认值', p.topPOn, (on) => { p.topPOn = on; topPS.row.style.display = on ? '' : 'none'; save(); }));
      $('[data-v="topp"]', body).appendChild(topPS.row);
      topPS.row.style.display = p.topPOn ? '' : 'none';
      topPS.input.addEventListener('numchange', () => { p.topP = topPS.get(); save(); });

      const flags = $('[data-v="flags"]', body);
      flags.appendChild(toggleRow('启用流式输出', '逐字显示回答；关闭则等待完整结果', p.stream, (on) => { p.stream = on; save(); }));
      flags.appendChild(toggleRow('启用思考摘要', '展示模型的深度思考过程（如支持）', p.thinkSummary, (on) => { p.thinkSummary = on; save(); }));
      flags.appendChild(toggleRow('思维链回传', '将会话中的思考过程保存到历史', p.cotReturn, (on) => { p.cotReturn = on; save(); }));
      flags.appendChild(toggleRow('启用响应测速', '在回答下方显示耗时（ms）', p.speedTest, (on) => { p.speedTest = on; save(); }));
      flags.appendChild(toggleRow('流式附带官方 Token 用量', '请求 stream_options.include_usage（需厂商支持）', p.usageInStream, (on) => { p.usageInStream = on; save(); }));
    },
  });
}

/* ---------- 会话与上下文 ---------- */
function subCtx() {
  openOverlay({
    title: '会话与上下文',
    build: async (body) => {
      const c = await getCtxConf();
      body.innerHTML = `<div class="set-wrap">
        ${secTitle('会话')}
        <div data-v="title"></div>
        ${secTitle('上下文')}
        <div data-v="limit"></div><div data-v="compress"></div>
      </div>`;
      const save = () => kvSet('ai:ctx', c);
      $('[data-v="title"]', body).appendChild(toggleRow('自动生成话题标题', '首轮问答后用 AI 概括会话标题', c.autoTitle, (on) => { c.autoTitle = on; save(); }));
      const pinOpen = await kvGet('ai:pin-open', true);
      $('[data-v="title"]', body).appendChild(toggleRow('置顶区默认展开', '历史会话抽屉中置顶分组的默认展开 / 折叠状态', pinOpen, (on) => kvSet('ai:pin-open', on)));
      const limS = numRow('上下文窗口数量', '默认携带的历史消息条数（对话设置可覆盖；长文本可设数千条）', { min: 1, max: null, step: 1, val: c.ctxLimit, unit: '条' });
      limS.input.addEventListener('numchange', () => { c.ctxLimit = limS.get(); save(); });
      $('[data-v="limit"]', body).appendChild(limS.row);
      const thS = numRow('压缩提醒阈值', '会话消息超过该数量时提醒开启新对话', { min: 2, max: null, step: 1, val: c.compressThreshold, unit: '条' });
      thS.input.addEventListener('numchange', () => { c.compressThreshold = thS.get(); save(); });
      $('[data-v="compress"]', body).appendChild(toggleRow('上下文压缩提醒', '', c.compressHint, (on) => { c.compressHint = on; thS.row.style.display = on ? '' : 'none'; save(); }));
      $('[data-v="compress"]', body).appendChild(thS.row);
      thS.row.style.display = c.compressHint ? '' : 'none';
    },
  });
}

/* ---------- 语音输入（ASR） ---------- */
function subASR() {
  openOverlay({
    title: '语音输入',
    build: async (body) => {
      const asr = await kvGet('ai:asr', { engine: 'browser', providerId: '', model: '', lang: 'zh-CN' });
      body.innerHTML = `<div class="set-wrap">
        ${secTitle('识别引擎')}
        <div class="col gap8" data-v="engines"></div>
        <div data-v="modelcfg" style="display:none">
          ${secTitle('模型 ASR（OpenAI 兼容 /audio/transcriptions）')}
          <div data-v="prov"></div>
          ${formRow('识别模型', '<input class="input" data-f="model" placeholder="whisper-1">')}
          <div class="muted" style="margin-bottom:10px">将录音上传到所选厂商的语音识别接口，例如 OpenAI whisper-1、小米 MiMo ASR 等。</div>
        </div>
        ${secTitle('识别语言')}
        ${formRow('', '<input class="input" data-f="lang" placeholder="zh-CN">')}
      </div>`;
      const save = () => kvSet('ai:asr', asr);
      const cfgBox = $('[data-v="modelcfg"]', body);
      const listBox = $('[data-v="engines"]', body);
      const engines = [
        { id: 'browser', name: '浏览器默认语音识别', desc: '无需配置，使用系统/Web Speech 识别（推荐）' },
        { id: 'model', name: '模型 ASR', desc: '录音后调用厂商语音模型识别，跨端表现一致' },
      ];
      engines.forEach((e) => {
        const on = asr.engine === e.id;
        const b = el(`<button class="search-svc ${on ? 'sel' : ''}">
          <span class="search-svc-radio">${on ? icon('check') : ''}</span>
          <div class="grow" style="text-align:left;min-width:0">
            <div style="font-size:14px;font-weight:600">${esc(e.name)}</div>
            <div class="muted">${esc(e.desc)}</div>
          </div>
        </button>`);
        b.onclick = () => { asr.engine = e.id; save(); rebuild(); };
        listBox.appendChild(b);
      });
      function renderProv() {
        const box = $('[data-v="prov"]', body);
        box.innerHTML = '';
        const usable = PROVIDERS.filter((p) => p.type === 'openai');
        const sel = usable.find((p) => p.id === asr.providerId);
        const btn = entryRow('cpu', sel ? sel.name : '选择识别厂商', sel ? (getApiKeyLabel(sel.id)) : '任意 OpenAI 兼容厂商');
        btn.onclick = async () => {
          const v = await actionSheet('选择识别厂商', await Promise.all(usable.map(async (p) => ({
            label: p.name + ((await getApiKey(p.id)) ? '' : '（未配置 Key）'), value: p.id, icon: p.id === asr.providerId ? 'check' : undefined,
          }))));
          if (!v) return;
          asr.providerId = v; save(); renderProv();
        };
        box.appendChild(btn);
      }
      async function getApiKeyLabel(pid) { return (await getApiKey(pid)) ? '已配置 Key' : '未配置 Key'; }
      renderProv();
      cfgBox.style.display = asr.engine === 'model' ? '' : 'none';
      $('[data-f="model"]', body).value = asr.model || '';
      $('[data-f="model"]', body).addEventListener('change', (e) => { asr.model = e.target.value.trim(); save(); });
      $('[data-f="lang"]', body).value = asr.lang || 'zh-CN';
      $('[data-f="lang"]', body).addEventListener('change', (e) => { asr.lang = e.target.value.trim() || 'zh-CN'; save(); });
      function rebuild() {
        $$('.search-svc', listBox).forEach((b, i) => {
          const on = asr.engine === engines[i].id;
          b.classList.toggle('sel', on);
          $('.search-svc-radio', b).innerHTML = on ? icon('check') : '';
        });
        cfgBox.style.display = asr.engine === 'model' ? '' : 'none';
      }
    },
  });
}

/* ---------- 语音合成（TTS） ---------- */
function subTTS() {
  openOverlay({
    title: '语音合成 TTS',
    build: async (body) => {
      const engine = await getSetting('ttsEngine');
      const mode = await kvGet('ai:tts-mode', 'auto');
      const voice = await kvGet('ai:tts-voice', '');
      const ttsModel = await kvGet('ai:tts-model', '');
      const autoread = await kvGet('ai:tts-autoread', false);
      const rate = await kvGet('ai:tts-rate', 1);
      const pitch = await kvGet('ai:tts-pitch', 1);
      body.innerHTML = `<div class="set-wrap">
        ${secTitle('播放模式')}
        <div class="col gap8" data-v="modes"></div>
        ${secTitle('TTS 引擎')}
        <div class="col gap8" data-v="engines"></div>
        <div data-v="edgeurl" style="display:none">${formRow('自定义 TTS 接口地址', '<input class="input" data-f="edgeurl" placeholder="https://your-tts.example.com/v1">')}</div>
        ${secTitle('手动覆盖参数（可留空）')}
        ${formRow('音色 Voice', '<input class="input" data-f="voice" placeholder="如 zh-CN-XiaoxiaoNeural / mimo_default">')}
        ${formRow('模型 Model', '<input class="input" data-f="model" placeholder="如 tts-1 / mimo-v2-tts">')}
        ${secTitle('系统语音参数')}
        <div data-v="rate"></div><div data-v="pitch"></div>
        ${secTitle('行为')}
        <div data-v="auto"></div>
      </div>`;
      const modeDefs = [
        { id: 'system', name: '仅系统语音', desc: '只使用浏览器/系统自带合成，离线可用' },
        { id: 'cloud', name: '仅云端语音', desc: '只使用下方配置的 TTS 引擎' },
        { id: 'auto', name: '自动', desc: '优先云端，失败后回退系统语音（推荐）' },
      ];
      const modeBox = $('[data-v="modes"]', body);
      modeDefs.forEach((d) => {
        const on = mode === d.id;
        const b = el(`<button class="search-svc ${on ? 'sel' : ''}">
          <span class="search-svc-radio">${on ? icon('check') : ''}</span>
          <div class="grow" style="text-align:left;min-width:0">
            <div style="font-size:14px;font-weight:600">${esc(d.name)}</div>
            <div class="muted">${esc(d.desc)}</div>
          </div>
        </button>`);
        b.onclick = async () => {
          await kvSet('ai:tts-mode', d.id);
          $$('.search-svc', modeBox).forEach((x, i) => {
            const o = modeDefs[i].id === d.id;
            x.classList.toggle('sel', o);
            $('.search-svc-radio', x).innerHTML = o ? icon('check') : '';
          });
        };
        modeBox.appendChild(b);
      });
      const engBox = $('[data-v="engines"]', body);
      TTS_ENGINES.forEach((e) => {
        const on = engine === e.id;
        const b = el(`<button class="search-svc ${on ? 'sel' : ''}">
          <span class="search-svc-radio">${on ? icon('check') : ''}</span>
          <div class="grow" style="text-align:left;min-width:0">
            <div style="font-size:14px;font-weight:600">${esc(e.name)}</div>
            <div class="muted">${esc(e.desc)}</div>
          </div>
        </button>`);
        b.onclick = async () => {
          await setSetting('ttsEngine', e.id);
          $$('.search-svc', engBox).forEach((x, i) => {
            const o = TTS_ENGINES[i].id === e.id;
            x.classList.toggle('sel', o);
            $('.search-svc-radio', x).innerHTML = o ? icon('check') : '';
          });
          $('[data-v="edgeurl"]', body).style.display = e.id === 'edge' ? '' : 'none';
        };
        engBox.appendChild(b);
      });
      $('[data-v="edgeurl"]', body).style.display = engine === 'edge' ? '' : 'none';
      $('[data-f="edgeurl"]', body).value = await getSetting('ttsCustomUrl');
      $('[data-f="edgeurl"]', body).addEventListener('change', (e) => setSetting('ttsCustomUrl', e.target.value.trim()));
      $('[data-f="voice"]', body).value = voice;
      $('[data-f="voice"]', body).addEventListener('change', (e) => kvSet('ai:tts-voice', e.target.value.trim()));
      $('[data-f="model"]', body).value = ttsModel;
      $('[data-f="model"]', body).addEventListener('change', (e) => kvSet('ai:tts-model', e.target.value.trim()));
      const rateS = sliderRow('系统语速', '', { min: 0.5, max: 2, step: 0.1, val: rate, fmt: (v) => v.toFixed(1) + 'x' });
      rateS.row.querySelector('.set-slider').addEventListener('change', () => kvSet('ai:tts-rate', rateS.get()));
      $('[data-v="rate"]', body).appendChild(rateS.row);
      const pitchS = sliderRow('系统音调', '', { min: 0.5, max: 2, step: 0.1, val: pitch, fmt: (v) => v.toFixed(1) });
      pitchS.row.querySelector('.set-slider').addEventListener('change', () => kvSet('ai:tts-pitch', pitchS.get()));
      $('[data-v="pitch"]', body).appendChild(pitchS.row);
      $('[data-v="auto"]', body).appendChild(toggleRow('回复完成后自动朗读', '', autoread, (on) => kvSet('ai:tts-autoread', on)));
    },
  });
}

/* ---------- 记忆系统 ---------- */
function subMemory() {
  openOverlay({
    title: '记忆系统',
    build: async (body) => {
      const memOn = await kvGet('ai:mem-on', false);
      const memWrite = await kvGet('ai:mem-write', true);
      body.innerHTML = `<div class="set-wrap">
        ${secTitle('记忆功能')}
        <div data-v="toggles"></div>
        ${secTitle('记忆库')}
        <div class="muted" style="margin-bottom:8px">记忆会在每次对话时注入系统提示，帮助 AI 记住你的偏好与背景。</div>
        <div class="col gap8" data-v="list"></div>
        <button class="btn btn-block" data-a="add">${icon('plus')} 添加记忆</button>
      </div>`;
      const tg = $('[data-v="toggles"]', body);
      tg.appendChild(toggleRow('启用记忆功能', '在对话中注入长期记忆', memOn, (on) => kvSet('ai:mem-on', on)));
      tg.appendChild(toggleRow('允许写入新的记忆', '说「记住…」时自动保存到记忆库', memWrite, (on) => kvSet('ai:mem-write', on)));
      const render = async () => {
        const mems = await kvGet('ai:memories', []);
        const box = $('[data-v="list"]', body);
        box.innerHTML = mems.length ? '' : '<div class="empty"><div class="empty-title">记忆库为空</div></div>';
        mems.forEach((m, i) => {
          const row = el(`<div class="list-item">
            <span class="list-ico">${icon('bookmark')}</span>
            <div class="grow" style="min-width:0"><div style="font-size:13.5px;line-height:1.6">${esc(m.text)}</div></div>
            <button class="btn btn-sm btn-danger" data-a="del">删除</button>
          </div>`);
          $('[data-a="del"]', row).onclick = async () => {
            mems.splice(i, 1);
            await kvSet('ai:memories', mems);
            render();
          };
          box.appendChild(row);
        });
      };
      await render();
      $('[data-a="add"]', body).onclick = () => {
        const mbody = el(`<div>${formRow('记忆内容', '<textarea class="input" rows="3" data-f="text" placeholder="例如：我是设计师，偏好深色主题和简洁回答"></textarea>')}</div>`);
        const m = modal({
          title: '添加记忆', body: mbody,
          footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">保存</button>',
        });
        $('[data-a="cancel"]', m.mask).onclick = m.close;
        $('[data-a="ok"]', m.mask).onclick = async () => {
          const text = $('[data-f="text"]', mbody).value.trim();
          if (!text) return toast('请输入内容');
          const mems = await kvGet('ai:memories', []);
          mems.push({ id: Date.now(), text, ts: Date.now() });
          await kvSet('ai:memories', mems);
          m.close();
          render();
          toast('已保存到记忆库', 'ok');
        };
      };
    },
  });
}

/* ---------- 用量统计 ---------- */
function subUsage() {
  openOverlay({
    title: '用量统计',
    build: async (body) => {
      const total = await getTotalStats();
      const daily = await getDailyStats();
      const byModel = await getModelStats();
      const days = Object.keys(daily).sort();
      const activeDays = days.filter((d) => (daily[d].requests || 0) > 0).length;
      const today = new Date().toISOString().slice(0, 10);
      const todayStat = daily[today] || { prompt: 0, completion: 0, requests: 0 };
      body.innerHTML = `<div class="set-wrap">
        ${secTitle('总览')}
        <div class="usage-grid">
          <div class="usage-card"><div class="usage-num">${fmtTokens(total.prompt + total.completion)}</div><div class="usage-label">总 Token</div></div>
          <div class="usage-card"><div class="usage-num">${total.requests || 0}</div><div class="usage-label">总请求数</div></div>
          <div class="usage-card"><div class="usage-num">${fmtTokens(todayStat.prompt + todayStat.completion)}</div><div class="usage-label">今日 Token</div></div>
          <div class="usage-card"><div class="usage-num">${activeDays}</div><div class="usage-label">活跃天数</div></div>
        </div>
        ${secTitle('花费估算（按厂商刊例价）')}
        <div class="card" data-v="cost"><div class="muted">计算中…</div></div>
        ${secTitle('最近 8 周活跃热图')}
        <div class="usage-heat" data-v="heat"></div>
        ${secTitle('模型榜单（按 Token 消耗）')}
        <div class="col gap8" data-v="models"></div>
        ${secTitle('来源分布')}
        <div class="col gap8" data-v="providers"></div>
      </div>`;
      // 花费估算：总价 + 各模型明细（价格为云端维护的刊例价，仅供参考）
      (async () => {
        const box = $('[data-v="cost"]', body);
        try {
          const { usd, rows } = await getCostBreakdown();
          const rate = await usdToCnyRate();
          const cny = usd * rate;
          const priced = rows.filter((r) => r.priced);
          if (!rows.length) { box.innerHTML = '<div class="muted">还没有用量记录，开始对话后这里会显示花费估算。</div>'; return; }
          box.innerHTML = `
            <div class="row gap8" style="align-items:baseline">
              <span style="font-size:20px;font-weight:800;color:var(--primary)">${fmtUsd(usd)}</span>
              <span class="muted">≈ ¥${cny >= 100 ? cny.toFixed(0) : cny.toFixed(2)}</span>
              <span class="muted" style="font-size:11px">累计估算</span>
            </div>
            <div class="col gap8 mt8">
              ${priced.slice(0, 8).map((r) => `
                <div class="row gap8" style="align-items:center;font-size:12.5px">
                  <span class="rank-ico">${vendorIcon(r.key.split('/')[0])}</span>
                  <span class="grow ellipsis">${esc(r.key.split('/').slice(1).join('/'))}</span>
                  <span class="muted">${fmtUsd(r.cost)}</span>
                </div>`).join('')}
              ${rows.some((r) => !r.priced) ? '<div class="muted" style="font-size:11px">部分模型暂无刊例价，未计入估算。</div>' : ''}
            </div>
            <div class="muted mt8" style="font-size:11px">价格为厂商刊例价的约值（云端维护，管理员可随时更新），实际以厂商账单为准。</div>`;
        } catch (e) { box.innerHTML = '<div class="muted">花费估算暂不可用</div>'; }
      })();
      // 热图：最近 56 天，7 列
      const heat = $('[data-v="heat"]', body);
      const maxTok = Math.max(1, ...days.map((d) => (daily[d].prompt || 0) + (daily[d].completion || 0)));
      const cells = [];
      for (let i = 55; i >= 0; i--) {
        const dt = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        const st = daily[dt];
        const tok = st ? (st.prompt || 0) + (st.completion || 0) : 0;
        const lv = tok === 0 ? 0 : Math.min(4, 1 + Math.floor((tok / maxTok) * 3.99));
        cells.push(`<span class="heat-cell lv${lv}" title="${dt} · ${fmtTokens(tok)} tokens${st ? ' · ' + (st.requests || 0) + ' 次' : ''}"></span>`);
      }
      heat.innerHTML = cells.join('');
      // 模型榜
      const mrows = Object.entries(byModel).map(([k, v]) => ({ k, tok: (v.prompt || 0) + (v.completion || 0), req: v.requests || 0 }))
        .sort((a, b) => b.tok - a.tok).slice(0, 10);
      const mbox = $('[data-v="models"]', body);
      mbox.innerHTML = mrows.length ? '' : '<div class="empty"><div class="empty-title">还没有用量记录</div></div>';
      const mMax = Math.max(1, ...mrows.map((r) => r.tok));
      mrows.forEach((r, i) => {
        const [pid, ...rest] = r.k.split('/');
        mbox.appendChild(el(`<div class="usage-row">
          <span class="rank-no ${i < 3 ? 'top' : ''}">${i + 1}</span>
          <span class="rank-ico">${vendorIcon(pid)}</span>
          <div class="grow" style="min-width:0">
            <div class="ellipsis" style="font-size:13px;font-weight:600">${esc(rest.join('/'))}</div>
            <div class="rank-bar" style="margin-top:4px"><i style="width:${Math.round((r.tok / mMax) * 100)}%"></i></div>
          </div>
          <span class="muted" style="flex-shrink:0">${fmtTokens(r.tok)}</span>
        </div>`));
      });
      // 来源分布
      const agg = {};
      Object.entries(byModel).forEach(([k, v]) => {
        const pid = k.split('/')[0];
        agg[pid] = (agg[pid] || 0) + (v.prompt || 0) + (v.completion || 0);
      });
      const prows = Object.entries(agg).sort((a, b) => b[1] - a[1]);
      const pTotal = Math.max(1, prows.reduce((n, r) => n + r[1], 0));
      const pbox = $('[data-v="providers"]', body);
      pbox.innerHTML = prows.length ? '' : '<div class="empty"><div class="empty-title">还没有用量记录</div></div>';
      prows.forEach(([pid, tok]) => {
        const p = providerById(pid);
        pbox.appendChild(el(`<div class="usage-row">
          <span class="rank-ico">${vendorIcon(pid)}</span>
          <div class="grow" style="min-width:0">
            <div style="font-size:13px;font-weight:600">${esc(p ? p.name : pid)}</div>
            <div class="rank-bar" style="margin-top:4px"><i style="width:${Math.round((tok / pTotal) * 100)}%"></i></div>
          </div>
          <span class="muted" style="flex-shrink:0">${Math.round((tok / pTotal) * 100)}%</span>
        </div>`));
      });
    },
  });
}

/* ---------- 工具中心 ---------- */
function subTools() {
  openOverlay({
    title: '工具中心',
    build: async (body) => {
      const onlyOn = await kvGet('ai:tools-only-on', false);
      const exposed = await kvGet('ai:mcp-exposed', {});
      body.innerHTML = `<div class="set-wrap">
        <div data-v="only"></div>
        ${secTitle('内置工具')}
        <div class="col gap8" data-v="builtin"></div>
        ${secTitle('MCP 工具')}
        <div class="col gap8" data-v="mcp"></div>
      </div>`;
      $('[data-v="only"]', body).appendChild(toggleRow('仅显示已启用', '', onlyOn, (on) => { kvSet('ai:tools-only-on', on); render(); }));
      const builtin = [
        { id: 'websearch', name: '联网搜索', desc: '对话前检索网页并注入上下文（在＋面板开关）' },
        { id: 'codepreview', name: '代码网页预览', desc: 'AI 生成的 HTML 代码可本地离线预览' },
        { id: 'tts', name: '语音朗读', desc: '朗读 AI 回复（系统或云端 TTS）' },
        { id: 'asr', name: '语音输入', desc: '按住说话转文字（浏览器或模型 ASR）' },
      ];
      const render = () => {
        const bb = $('[data-v="builtin"]', body);
        bb.innerHTML = '';
        builtin.forEach((t) => {
          const on = exposed['b:' + t.id] !== false;
          if (onlyOn && !on) return;
          bb.appendChild(toggleRow(t.name, t.desc, on, (v) => { exposed['b:' + t.id] = v; kvSet('ai:mcp-exposed', exposed); }));
        });
        const servers = listMcpServers();
        const mb = $('[data-v="mcp"]', body);
        mb.innerHTML = '';
        let shown = 0;
        servers.forEach((s) => {
          const st = s.status === 'connected' ? `已连接 · ${s.tools.length} 工具` : s.status === 'error' ? '连接失败' : '未连接';
          const on = exposed[s.id] !== false && s.status === 'connected';
          if (onlyOn && !on) return;
          shown++;
          const row = el(`<div class="set-row">
            <div class="set-row-info">
              <div class="set-row-name ellipsis">${esc(s.name)}</div>
              <div class="set-row-sub ellipsis">来源：${esc(s.url)} · ${st}</div>
            </div>
            <button class="ai-toggle ${on ? 'on' : ''} ${s.status !== 'connected' ? 'disabled' : ''}"></button>
          </div>`);
          $('.ai-toggle', row).onclick = (e) => {
            if (s.status !== 'connected') return toast('请先连接该 MCP 服务');
            const t = e.currentTarget;
            t.classList.toggle('on');
            exposed[s.id] = t.classList.contains('on');
            kvSet('ai:mcp-exposed', exposed);
          };
          mb.appendChild(row);
        });
        if (!shown) mb.innerHTML = `<div class="empty"><div class="empty-title">${servers.length ? '没有已启用的工具' : '还没有 MCP 服务'}</div><div class="empty-sub">可到抽屉「设置」中添加 MCP Server</div></div>`;
      };
      render();
    },
  });
}

/* ---------- 提供商与模型管理 ---------- */
function subProviders(page) {
  openOverlay({
    title: '提供商与模型管理',
    build: (body) => {
      body.innerHTML = `<div class="set-wrap col gap8" id="prov-list"></div>`;
      const list = $('#prov-list', body);
      const add = (ic, name, sub, fn) => { const r = entryRow(ic, name, sub); r.onclick = fn; list.appendChild(r); };
      add('cpu', '模型设置', '厂商模型列表 · 实时同步 · 排行榜', async () => { const m = await import('./ai-chat.js'); m.showModelsPage(page); });
      add('key', 'API 密钥 / 联网搜索 / MCP', '厂商凭据与搜索服务配置', async () => { const m = await import('./ai-chat.js'); m.showAISettings(); });
      // 专用模型
      const special = [
        { key: 'ai:model-title', name: '标题生成模型', desc: '自动生成话题标题所用模型（默认跟随当前模型）' },
        { key: 'ai:model-think', name: '思考摘要模型', desc: '预留：深度思考摘要所用模型' },
      ];
      special.forEach((sp) => {
        const r = entryRow('sparkle', sp.name, sp.desc);
        const refresh = async () => {
          const cur = await kvGet(sp.key, null);
          $('.muted', r).textContent = cur ? `${cur.model} · ${providerById(cur.providerId).name}` : sp.desc;
        };
        refresh();
        r.onclick = async () => {
          const picked = await pickModel();
          if (!picked) return;
          await kvSet(sp.key, picked);
          refresh();
          toast('已设置：' + picked.model, 'ok');
        };
        list.appendChild(r);
      });
      const asrRow = entryRow('mic', '语音识别模型', '模型 ASR 所用的厂商与模型');
      asrRow.onclick = () => subASR();
      list.appendChild(asrRow);
      const ttsRow = entryRow('headphone', 'TTS 模型', '语音合成引擎与音色参数');
      ttsRow.onclick = () => subTTS();
      list.appendChild(ttsRow);
    },
  });
}
