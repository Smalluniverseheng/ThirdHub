/* ===== ThirdHub js/modules/proxy-settings.js — 模块代理设置（v1.7，设置分级） =====
   每个模块独立配置代理方式：
   · 直连（默认，使用自己的设备网络）
   · 自有代理 / 服务器（填写自己的代理地址）
   · ThirdHub 云端代理（会员专属，多设备同步输出）
   配置云端同步，多设备一致 */
import { $, $$, el, esc, icon, toast, openOverlay, formRow } from '../ui.js';
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

export async function getProxyConf() { return await kvGet('proxy:mod', {}); }

export async function showProxySettings() {
  const conf = await getProxyConf();
  const u = await currentUser();
  const lv = levelById(u ? u.level : 'guest');
  const member = !!(u && lv.price > 0 && (!u.expireAt || new Date(u.expireAt).getTime() > Date.now()));
  openOverlay({
    title: '模块代理设置',
    build: (body) => {
      body.innerHTML = `<div class="set-wrap">
        <div class="muted" style="line-height:1.7;margin-bottom:14px">免费用户与游客默认使用自己的设备（直连）或自有服务器代理；会员可为任意模块启用 ThirdHub 云端代理，获得多设备同步输出效果。</div>
        <div class="col gap16" id="px-list"></div>
      </div>`;
      const list = $('#px-list', body);
      const save = () => kvSet('proxy:mod', conf);

      PROXY_MODULES.forEach((m) => {
        const c = conf[m.id] || { mode: 'direct', url: '' };
        conf[m.id] = c;
        const box = el(`<div>
          <div class="row gap8" style="align-items:baseline"><span style="font-size:14px;font-weight:700">${m.name}</span><span class="muted" style="font-size:12px">${m.desc}</span></div>
          <div class="nr-chip-row mt8" data-g="${m.id}">
            <button class="ai-chip ${c.mode === 'direct' ? 'on' : ''}" data-v="direct">直连</button>
            <button class="ai-chip ${c.mode === 'custom' ? 'on' : ''}" data-v="custom">自有代理 / 服务器</button>
            <button class="ai-chip ${c.mode === 'cloud' ? 'on' : ''}" data-v="cloud">云端代理${member ? '' : ' 🔒'}</button>
          </div>
          <div data-url="${m.id}" style="display:${c.mode === 'custom' ? '' : 'none'};margin-top:8px">
            <input class="input" placeholder="代理地址，例如 https://your-server.com/proxy" value="${esc(c.url || '')}">
            <div class="muted mt8" style="font-size:12px">请求将以 <code>?url=目标地址</code> 形式转发到该代理（需支持 CORS）。</div>
          </div>
          ${c.mode === 'cloud' && !member ? '<div class="muted" style="font-size:12px;color:#e6a23c;margin-top:6px">云端代理为会员能力，当前未生效（请求将直连）</div>' : ''}
        </div>`);
        $$('.ai-chip', box).forEach((b) => b.onclick = () => {
          if (b.dataset.v === 'cloud' && !member) {
            toast('云端代理是会员专属能力，开通会员后可使用', 'err');
          }
          c.mode = b.dataset.v;
          $$('.ai-chip', box).forEach((x) => x.classList.toggle('on', x === b));
          $(`[data-url="${m.id}"]`, box).style.display = c.mode === 'custom' ? '' : 'none';
          save();
        });
        const inp = $('input', box);
        if (inp) inp.addEventListener('change', () => { c.url = inp.value.trim(); save(); toast('已保存'); });
        list.appendChild(box);
      });
    },
  });
}
