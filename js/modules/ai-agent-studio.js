/* ===== ThirdHub js/modules/ai-agent-studio.js — 智能体独立工作台（v1.6） =====
   按智能体功能适配界面：多步工作流（步骤卡片 + 智能托管/逐步确认），
   无步骤的智能体回退为直接进入对话。执行记录同步写入聊天会话。 */
import { $, $$, el, esc, icon, toast, openOverlay } from '../ui.js';
import { chat } from '../ai/ai-api.js';
import { renderMarkdown, bindCopyButtons } from '../ai/markdown.js';
import { providerById } from '../ai/ai-models.js';

/* hooks（由 ai-chat.js 提供闭包）：
   model() → {providerId, model}
   begin(agent) → 重置会话
   pushUser(text) / pushAssistant(msg)
   save() / refresh()
   gotoWorkspace(ws, prompt) */
export function openAgentStudio(page, agent, hooks) {
  const hasSteps = !!(agent.steps && agent.steps.length);
  let ctl = null;
  let running = false;
  let auto = true;

  const ref = openOverlay({
    title: agent.name,
    build: (body) => {
      body.innerHTML = `<div class="set-wrap">
        <div class="agt-head">
          <span class="agt-ico">${icon(agent.icon)}</span>
          <div class="grow" style="min-width:0">
            <div class="agt-name">${esc(agent.name)}</div>
            <div class="agt-desc">${esc(agent.desc)}</div>
          </div>
          <span class="agt-model" id="agt-model"></span>
        </div>
        <div id="agt-main"></div>
      </div>`;
      const m = hooks.model();
      $('#agt-model', body).textContent = m ? m.model : '';
      const main = $('#agt-main', body);

      if (!hasSteps) {
        main.innerHTML = `
          <div class="agt-note">该智能体以自由对话方式工作，进入后直接说明你的需求即可。</div>
          <button class="btn btn-primary btn-block" id="agt-go">${icon('send')} 开始对话</button>`;
        $('#agt-go', main).onclick = () => {
          ref.close();
          hooks.begin(agent);
        };
        return;
      }

      main.innerHTML = `
        <div class="agt-note">该智能体包含 ${agent.steps.length} 步工作流：${agent.steps.map((s) => esc(s.name)).join(' → ')}</div>
        <textarea class="input agt-input" id="agt-input" rows="3" placeholder="输入你的需求，例如：${esc(agent.desc)}…"></textarea>
        <div class="agt-modes">
          <button class="search-svc sel" data-mode="auto">
            <span class="search-svc-radio">${icon('check')}</span>
            <div class="grow" style="text-align:left"><div style="font-size:14px;font-weight:600">智能托管</div><div class="muted">自动连续执行全部步骤</div></div>
          </button>
          <button class="search-svc" data-mode="step">
            <span class="search-svc-radio"></span>
            <div class="grow" style="text-align:left"><div style="font-size:14px;font-weight:600">逐步确认</div><div class="muted">每步完成后可重试或继续</div></div>
          </button>
        </div>
        <button class="btn btn-primary btn-block" id="agt-run">${icon('play')} 开始执行</button>
        <div id="agt-steps" style="margin-top:14px"></div>`;

      $$('.search-svc', main).forEach((b) => b.onclick = () => {
        auto = b.dataset.mode === 'auto';
        $$('.search-svc', main).forEach((x) => {
          const on = x === b;
          x.classList.toggle('sel', on);
          $('.search-svc-radio', x).innerHTML = on ? icon('check') : '';
        });
      });

      const stepsBox = $('#agt-steps', main);
      const runBtn = $('#agt-run', main);

      const stepCard = (i) => {
        const card = el(`<div class="agt-step" data-i="${i}">
          <div class="agt-step-head">
            <span class="agt-step-no">${i + 1}</span>
            <span class="agt-step-name">${esc(agent.steps[i].name)}</span>
            <span class="agt-step-status">等待</span>
          </div>
          <div class="agt-step-body" hidden></div>
          <div class="agt-step-actions" hidden>
            <button class="btn btn-sm" data-a="retry">重新生成</button>
            <button class="btn btn-sm btn-primary" data-a="next">确认并继续</button>
          </div>
        </div>`);
        stepsBox.appendChild(card);
        return card;
      };

      const execStep = async (i, input, prevOut) => {
        const card = stepsBox.children[i];
        const status = $('.agt-step-status', card);
        const bodyEl = $('.agt-step-body', card);
        bodyEl.hidden = false;
        bodyEl.innerHTML = '';
        bodyEl.classList.add('streaming');
        status.textContent = '执行中…';
        status.className = 'agt-step-status running';
        const prompt = (i === 0)
          ? agent.steps[i].prompt.replace(/\{input\}/g, input)
          : `用户需求：「${input}」\n\n前序步骤结果：\n${prevOut}\n\n本步任务：${agent.steps[i].prompt.replace(/\{input\}/g, input)}`;
        const m = hooks.model();
        const r = await chat({
          ...m,
          messages: [
            { role: 'system', content: agent.system },
            { role: 'user', content: prompt },
          ],
          signal: ctl.signal,
          onToken: (c, acc) => { bodyEl.innerHTML = renderMarkdown(acc); },
        });
        bodyEl.classList.remove('streaming');
        bodyEl.innerHTML = renderMarkdown(r.text);
        bindCopyButtons(card);
        status.textContent = '已完成';
        status.className = 'agt-step-status done';
        hooks.pushAssistant({ role: 'assistant', content: `【${agent.steps[i].name}】\n${r.text}`, model: m.model + ' · ' + agent.name, providerId: m.providerId, ts: Date.now() });
        return r.text;
      };

      const run = async () => {
        const input = $('#agt-input', main).value.trim();
        if (!input) return toast('请先输入需求');
        if (running) { ctl && ctl.abort(); return; }
        running = true;
        ctl = new AbortController();
        runBtn.innerHTML = '<span class="ai-stop-square"></span> 停止';
        stepsBox.innerHTML = '';
        hooks.begin(agent);
        hooks.pushUser(input);
        agent.steps.forEach((_, i) => stepCard(i));
        const outs = [];
        let prevOut = '';
        try {
          for (let i = 0; i < agent.steps.length; i++) {
            prevOut = await execStep(i, input, prevOut);
            outs[i] = prevOut;
            if (i < agent.steps.length - 1 && !auto) {
              // 逐步确认：等待用户点击
              const card = stepsBox.children[i];
              const actions = $('.agt-step-actions', card);
              actions.hidden = false;
              const decision = await new Promise((resolve) => {
                $('[data-a="next"]', actions).onclick = () => { actions.hidden = true; resolve('next'); };
                $('[data-a="retry"]', actions).onclick = () => { actions.hidden = true; resolve('retry'); };
              });
              if (decision === 'retry') {
                prevOut = i > 0 ? outs[i - 1] : '';
                i--;
                continue;
              }
            }
          }
          await hooks.save();
          // 完成动作
          const done = el(`<div class="agt-done">
            <div class="agt-done-title">${icon('check')} 全部步骤已完成</div>
            <div class="row gap8">
              <button class="btn grow" data-a="chat">在对话中继续</button>
              ${agent.cat === 'image' ? '<button class="btn btn-primary grow" data-a="gen">去生成图片</button>' : ''}
              ${agent.cat === 'video' ? '<button class="btn btn-primary grow" data-a="gen">去生成视频</button>' : ''}
            </div>
          </div>`);
          stepsBox.appendChild(done);
          $('[data-a="chat"]', done).onclick = () => { ref.close(); hooks.refresh(); };
          const genBtn = $('[data-a="gen"]', done);
          if (genBtn) genBtn.onclick = () => { ref.close(); hooks.gotoWorkspace(agent.cat, prevOut); };
        } catch (e) {
          if (e.name === 'AbortError') toast('已停止执行');
          else toast('执行失败：' + e.message, 'err');
          await hooks.save();
        }
        running = false;
        runBtn.innerHTML = `${icon('play')} 重新开始`;
      };
      runBtn.onclick = run;
    },
    onClose: () => { if (ctl) ctl.abort(); },
  });
}
