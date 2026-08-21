/* ===== ThirdHub js/modules/proxy-settings.js — 模块代理设置（v1.9） =====
   每个模块独立配置代理方式：
   · 直连（默认，使用自己的设备网络）
   · 自有代理 / 服务器（填写自己的代理地址）
   · ThirdHub 云端代理（会员专属，多设备同步输出）
   · 自动（按优先级排序依次尝试，断线自动切换下一个；顺序可自定义）
   非会员点击云端代理不会锁定：抖动提示并弹回原选项；
   自有代理 / 云端代理连接失败时自动弹回直连。
   配置云端同步，多设备一致 */
import { $, $$, el, esc, icon, toast, openOverlay, modal, formRow } from '../ui.js';
import { kvGet, kvSet } from '../store.js';
import { currentUser, levelById } from '../auth.js';

export const PROXY_MODULES = [
  { id: 'ai_chat',  name: 'AI 对话',   desc: '聊天 / 对比 / 辩论等文本生成请求' },
  { id: 'ai_image', name: 'AI 绘图',   desc: '图片生成请求' },
  { id: 'ai_video', name: 'AI 视频',   desc: '视频生成任务请求' },
  { id: 'ai_asr',   name: '语音识别',  desc: '模型 ASR 录音转文字' },
  { id: 'content',  name: '内容连接器', desc: '阅读 / 漫画等内容源的章节请求' },
  { id: 'storage',  name: '云存储同步', desc: '云端数据同步与备份' },
];

export const HOP_NAMES = { cloud: '云端代理', custom: '自有代理 / 服务器', direct: '直连' };
const DEFAULT_PRIO = ['cloud', 'custom', 'direct'];

export async function getProxyConf() { return await kvGet('proxy:mod', {}); }
export async function getProxyPrio() {
  const p = await kvGet('proxy:prio', DEFAULT_PRIO);
  // 保证三项齐全
  const full = [...p];
  DEFAULT_PRIO.forEach((h) => { if (!full.includes(h)) full.push(h); });
  return full.filter((h) => DEFAULT_PRIO.includes(h));
}

/* 自动模式优先级设置（上移 / 下移排序） */
async function showPrioSettings(onSaved) {
  let prio = await getProxyPrio();
  const b = el(`<div>
    <div class="muted" style="line-height:1.7;margin-bottom:12px">「自动」模式下按此顺序依次尝试通道；排在前面的通道断线（连接失败）时，自动切换下一个。拖动排序不适用，请使用上下箭头调整。</div>
    <div class="col gap8" id="prio-list"></div>
  </div>`);
  const render = () => {
    const box = $('#prio-list', b);
    box.innerHTML = '';
    prio.forEach((h, i) => {
      const row = el(`<div class="list-item">
        <span class="rank-no ${i === 0 ? 'top' : ''}">${i + 1}</span>
        <div class="grow" style="font-size:14px;font-weight:600">${HOP_NAMES[h]}${i === 0 ? ' <span class="tag tag-blue">优先</span>' : ''}</div>
        <button class="btn btn-sm" data-a="up" ${i === 0 ? 'disabled' : ''}>上移</button>
        <button class="btn btn-sm" data-a="down" ${i === prio.length - 1 ? 'disabled' : ''}>下移</button>
      </div>`);
      $('[data-a="up"]', row).onclick = () => { [prio[i - 1], prio[i]] = [prio[i], prio[i - 1]]; render(); };
      $('[data-a="down"]', row).onclick = () => { [prio[i], prio[i + 1]] = [prio[i + 1], prio[i]]; render(); };
      box.appendChild(row);
    });
  };
  render();
  const m = modal({
    title: '自动模式优先级', body: b,
    footer: '<button class="btn grow" data-a="c">取消</button><button class="btn btn-primary grow" data-a="ok">保存</button>',
  });
  $('[data-a="c"]', m.mask).onclick = m.close;
  $('[data-a="ok"]', m.mask).onclick = async () => {
    await kvSet('proxy:prio', prio);
    m.close();
    toast('优先级已保存');
    onSaved && onSaved();
  };
}

export async function showProxySettings() {
  const conf = await getProxyConf();
  const u = await currentUser();
  const lv = levelById(u ? u.level : 'guest');
  const member = !!(u && lv.price > 0 && (!u.expireAt || new Date(u.expireAt).getTime() > Date.now()));
  openOverlay({
    title: '模块代理设置',
    build: (body) => {
      body.innerHTML = `<div class="set-wrap">
        <div class="row" style="align-items:flex-start;margin-bottom:14px">
          <div class="muted grow" style="line-height:1.7">免费用户与游客默认使用自己的设备（直连）或自有服务器代理；会员可为任意模块启用 ThirdHub 云端代理。选择「自动」将按优先级依次尝试，断线自动切换。</div>
          <button class="icon-btn" id="px-prio" title="自动模式优先级" style="flex-shrink:0">${icon('settings')}</button>
        </div>
        <div class="col gap16" id="px-list"></div>
      </div>`;
      $('#px-prio', body).onclick = () => showPrioSettings();
      const list = $('#px-list', body);
      const save = () => kvSet('proxy:mod', conf);

      PROXY_MODULES.forEach((m) => {
        const c = conf[m.id] || { mode: 'direct', url: '' };
        conf[m.id] = c;
        if (c.mode === 'cloud' && !member) c.mode = 'direct'; // 过期会员残留状态自动纠正
        const box = el(`<div>
          <div class="row gap8" style="align-items:baseline"><span style="font-size:14px;font-weight:700">${m.name}</span><span class="muted" style="font-size:12px">${m.desc}</span></div>
          <div class="nr-chip-row mt8" data-g="${m.id}">
            <button class="ai-chip ${c.mode === 'direct' ? 'on' : ''}" data-v="direct">直连</button>
            <button class="ai-chip ${c.mode === 'custom' ? 'on' : ''}" data-v="custom">自有代理 / 服务器</button>
            <button class="ai-chip ${c.mode === 'cloud' ? 'on' : ''}" data-v="cloud">云端代理${member ? '' : ' 🔒'}</button>
            <button class="ai-chip ${c.mode === 'auto' ? 'on' : ''}" data-v="auto">自动</button>
          </div>
          <div data-url="${m.id}" style="display:${c.mode === 'custom' ? '' : 'none'};margin-top:8px">
            <input class="input" placeholder="代理地址，例如 https://your-server.com/proxy" value="${esc(c.url || '')}">
            <div class="muted mt8" style="font-size:12px">请求将以 <code>?url=目标地址</code> 形式转发到该代理（需支持 CORS）。连接失败会自动弹回直连。</div>
          </div>
          <div data-hint="${m.id}" class="muted" style="font-size:12px;margin-top:6px;display:${c.mode === 'auto' ? '' : 'none'}"></div>
        </div>`);

        const hintBox = $(`[data-hint="${m.id}"]`, box);
        const syncHint = async () => {
          if (c.mode !== 'auto') return;
          const prio = await getProxyPrio();
          hintBox.textContent = '尝试顺序：' + prio.map((h) => HOP_NAMES[h]).join(' → ');
        };
        syncHint();

        $$('.ai-chip', box).forEach((b) => b.onclick = async () => {
          const v = b.dataset.v;
          if (v === 'cloud' && !member) {
            // 非会员：不选中，抖动 + 弹回动画
            b.classList.remove('shake');
            void b.offsetWidth; // 重启动画
            b.classList.add('shake');
            setTimeout(() => b.classList.remove('shake'), 450);
            const cur = $$('.ai-chip', box).find((x) => x.classList.contains('on'));
            if (cur) {
              cur.classList.remove('bounce-back');
              void cur.offsetWidth;
              cur.classList.add('bounce-back');
              setTimeout(() => cur.classList.remove('bounce-back'), 500);
            }
            toast('云端代理是会员专属能力，开通会员后可使用', 'err');
            return;
          }
          c.mode = v;
          $$('.ai-chip', box).forEach((x) => x.classList.toggle('on', x === b));
          $(`[data-url="${m.id}"]`, box).style.display = v === 'custom' ? '' : 'none';
          hintBox.style.display = v === 'auto' ? '' : 'none';
          if (v === 'auto') syncHint();
          await save();
        });
        const inp = $('input', box);
        if (inp) inp.addEventListener('change', () => { c.url = inp.value.trim(); save(); toast('已保存'); });
        list.appendChild(box);
      });
    },
  });
}
