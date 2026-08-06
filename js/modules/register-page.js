/* ===== ThirdHub js/modules/register-page.js — 注册子页面（昵称 + 真实邮箱验证码） =====
   登录弹窗与首次引导共用。邮箱验证码经 Cloudflare Worker（163 SMTP）发送并校验。
   若发送失败（可能触发封控），允许用户跳过验证码直接注册。 */
import { $, el, esc, icon, toast, openOverlay, confirmDialog } from '../ui.js';
import { signUp } from '../auth.js';
import { sendEmailCode, verifyEmailCode } from '../email-code.js';

export function showRegisterPage({ onDone = null, title = '注册账号' } = {}) {
  const ref = openOverlay({
    title,
    build: (body) => {
      let verified = false;
      let ticket = null; // {expiry, sig}
      let countdown = 0, timer = null;

      body.innerHTML = `
        <div class="reg-page">
          <div class="reg-hero">${icon('robot')}</div>
          <div class="reg-title">创建你的 ThirdHub 账号</div>
          <div class="muted" style="margin-bottom:18px">注册后可使用云端同步、会员存储等功能</div>
          <div class="form-item"><label class="form-label">昵称</label>
            <input class="input" id="reg-nick" placeholder="给自己起个名字" maxlength="20"></div>
          <div class="form-item"><label class="form-label">邮箱</label>
            <input class="input" id="reg-email" type="email" placeholder="you@example.com" autocomplete="email"></div>
          <div class="form-item"><label class="form-label">邮箱验证码</label>
            <div class="row gap8">
              <input class="input grow" id="reg-code" placeholder="6 位验证码" maxlength="6" inputmode="numeric">
              <button class="btn" id="reg-send" style="flex-shrink:0">发送验证码</button>
            </div>
            <div class="muted" id="reg-code-hint" style="margin-top:6px;font-size:12px">验证码 10 分钟内有效</div>
          </div>
          <div class="form-item"><label class="form-label">密码</label>
            <input class="input" id="reg-pwd" type="password" placeholder="至少 6 位" autocomplete="new-password"></div>
          <button class="btn btn-primary btn-block" id="reg-verify" disabled>验证邮箱</button>
          <button class="btn btn-block mt8" id="reg-submit" disabled>完成注册</button>
          <button class="ob-skip" id="reg-skip" style="margin-top:14px">验证码收不到？跳过验证注册</button>
        </div>`;

      const emailEl = $('#reg-email', body), codeEl = $('#reg-code', body),
        sendBtn = $('#reg-send', body), verifyBtn = $('#reg-verify', body),
        submitBtn = $('#reg-submit', body), hint = $('#reg-code-hint', body);

      const emailOk = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim());
      const refresh = () => {
        verifyBtn.disabled = !(emailOk() && codeEl.value.trim().length === 6 && ticket) || verified;
        submitBtn.disabled = !verified;
        verifyBtn.textContent = verified ? '✓ 已验证' : '验证邮箱';
      };
      emailEl.addEventListener('input', refresh);
      codeEl.addEventListener('input', refresh);

      sendBtn.onclick = async () => {
        if (!emailOk()) { toast('请先填写正确的邮箱'); return; }
        sendBtn.disabled = true;
        hint.textContent = '正在发送验证码…';
        try {
          const r = await sendEmailCode(emailEl.value.trim());
          ticket = { expiry: r.expiry, sig: r.sig };
          hint.textContent = '验证码已发送，请查收（10 分钟内有效）';
          toast('验证码已发送', 'ok');
          countdown = 60;
          timer = setInterval(() => {
            countdown--;
            sendBtn.textContent = countdown > 0 ? `重新发送（${countdown}s）` : '发送验证码';
            sendBtn.disabled = countdown > 0;
            if (countdown <= 0) clearInterval(timer);
          }, 1000);
        } catch (e) {
          hint.textContent = '发送失败：' + e.message + '（可能触发邮件服务封控，可选择跳过验证）';
          toast('验证码发送失败，可跳过', 'err');
          sendBtn.disabled = false;
        }
        refresh();
      };

      verifyBtn.onclick = async () => {
        verifyBtn.disabled = true;
        verifyBtn.textContent = '验证中…';
        try {
          await verifyEmailCode(emailEl.value.trim(), codeEl.value.trim(), ticket.expiry, ticket.sig);
          verified = true;
          toast('邮箱验证成功', 'ok');
        } catch (e) {
          toast('验证失败：' + e.message, 'err');
        }
        refresh();
      };

      submitBtn.onclick = async () => {
        const nick = $('#reg-nick', body).value.trim();
        const pwd = $('#reg-pwd', body).value;
        if (!nick) { toast('请填写昵称'); return; }
        if (pwd.length < 6) { toast('密码至少 6 位'); return; }
        submitBtn.disabled = true;
        submitBtn.textContent = '注册中…';
        try {
          await signUp(emailEl.value.trim(), pwd, nick);
          toast('注册成功', 'ok');
          ref.close();
          onDone && onDone();
        } catch (e) {
          toast(e.message, 'err');
          submitBtn.disabled = false;
          submitBtn.textContent = '完成注册';
        }
      };

      $('#reg-skip', body).onclick = async () => {
        const ok = await confirmDialog('跳过邮箱验证？', '邮件服务可能触发了封控。跳过后可直接注册，但账号邮箱未经核实。', '跳过并注册');
        if (!ok) return;
        verified = true;
        refresh();
        toast('已跳过验证，请直接完成注册');
      };
    },
  });
  ref.ov.style.zIndex = 9800; // 盖过引导页（.ob z-index 9500）
  return ref;
}
