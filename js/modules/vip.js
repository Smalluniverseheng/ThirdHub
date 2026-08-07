/* ===== ThirdHub js/modules/vip.js — 会员中心（v1.7，仿 Kimi 版式） =====
   横向滑动套餐卡片（卫星 Andante / 行星 Moderato / 恒星 Allegretto / 星系 Allegro）
   每个卡片内权益内容竖向滚动 · 月付/年付切换 · 右上角 额度 / 发票
   套餐定价存云端 th_vip_plans，管理员后台可随时修改 */
import { $, $$, el, esc, icon, toast, openOverlay, modal, formRow, fmtBytes, fmtDate } from '../ui.js';
import { hasCloud, getSupabase } from '../supabase.js';
import { currentUser, redeemCard, levelById } from '../auth.js';
import { addFeedback } from './feedback.js';

/* 本地兜底定价（云端不可用时） */
const FALLBACK_PLANS = [
  { id: 'satellite', name: '卫星版 Andante', level: 'satellite', monthly: 0, yearly: 0, storage: '100MB', tagline: '轻装起步', benefits: ['100MB 云存储空间', '云端同步书架 / 历史 / 收藏', '设置多端同步', '多设备管理'] },
  { id: 'planet', name: '行星版 Moderato', level: 'planet', monthly: 12, yearly: 118, storage: '1GB', tagline: '稳步前行', benefits: ['1GB 云存储空间', '云端同步全部数据', '设置多端同步', '多设备管理', '会员云端代理（多设备同步输出）', '意见反馈优先处理'] },
  { id: 'star', name: '恒星版 Allegretto', level: 'star', monthly: 30, yearly: 298, storage: '5GB', tagline: '明亮闪耀', benefits: ['5GB 云存储空间', '云端同步全部数据', '设置多端同步', '多设备管理', '会员云端代理（多设备同步输出）', '专属客服通道', '新功能优先体验'] },
  { id: 'galaxy', name: '星系版 Allegro', level: 'galaxy', monthly: 68, yearly: 668, storage: '20GB', tagline: '浩瀚无垠', benefits: ['20GB 云存储空间', '云端同步全部数据', '设置多端同步', '多设备管理', '会员云端代理（多设备同步输出）', '专属客服通道', '新功能优先体验', '定制化支持'] },
];

export async function getVipPlans() {
  if (hasCloud()) {
    try {
      const { data, error } = await getSupabase().from('th_vip_plans').select('*');
      if (!error && data && data.length) {
        const order = ['satellite', 'planet', 'star', 'galaxy'];
        return data.map((r) => ({ id: r.id, ...(r.data || {}) }))
          .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      }
    } catch (e) {}
  }
  return FALLBACK_PLANS;
}

/* 是否为有效会员（付费等级且未过期） */
export async function isMember() {
  const u = await currentUser();
  if (!u) return false;
  const lv = levelById(u.level);
  if (!lv || lv.price <= 0) return false;
  if (u.expireAt && new Date(u.expireAt).getTime() < Date.now()) return false;
  return true;
}

/* ================= 会员中心页面 ================= */
export async function showVipCenter() {
  const u = await currentUser();
  const plans = await getVipPlans();
  let cycle = 'monthly'; // monthly | yearly
  openOverlay({
    title: '会员中心',
    headExtra: `
      <button class="vip-head-btn" id="vip-quota">额度</button>
      <button class="vip-head-btn" id="vip-invoice">发票</button>`,
    build: async (body) => {
      const curLevel = u ? u.level : 'guest';
      body.innerHTML = `
        <div class="vip-hero">
          <div class="vip-hero-name">${u ? esc(u.nickname || '用户') : '游客'}</div>
          <div class="vip-hero-sub">${u ? `当前：${levelById(curLevel).name}${u.expireAt ? ' · ' + fmtDate(new Date(u.expireAt).getTime()) + ' 到期' : ''}` : '登录后可开通会员'}</div>
        </div>
        <div class="vip-cycle">
          <button class="vip-cycle-btn on" data-c="monthly">按月付费</button>
          <button class="vip-cycle-btn" data-c="yearly">按年付费 <span class="vip-save">省约 2 个月</span></button>
        </div>
        <div class="vip-slider" id="vip-slider"></div>
        <div class="vip-dots" id="vip-dots"></div>
        <div class="muted" style="text-align:center;font-size:12px;margin-top:14px;line-height:1.7">
          会员扩容云存储并解锁云端代理等能力；AI 对话始终使用你自己的 API Key，不额外计费。<br>
          支持支付宝 / 微信支付，也可以使用卡密激活。
        </div>
        <div class="row gap8" style="margin-top:12px;justify-content:center">
          <button class="btn btn-sm" id="vip-orders">${icon('receipt')} 我的订单</button>
          <button class="btn btn-sm" id="vip-redeem">${icon('key')} 卡密激活</button>
        </div>`;

      const slider = $('#vip-slider', body);
      const dots = $('#vip-dots', body);
      $('#vip-orders', body).onclick = async () => (await import('./pay.js')).showMyOrders();
      $('#vip-redeem', body).onclick = () => redeemFlow(plans.find((p) => p.level !== 'satellite') || plans[1] || plans[0]);

      function renderPlans() {
        slider.innerHTML = '';
        dots.innerHTML = '';
        plans.forEach((p, i) => {
          const price = cycle === 'monthly' ? p.monthly : p.yearly;
          const mine = curLevel === p.level;
          const card = el(`<div class="vip-card ${i === 1 ? 'vip-hot' : ''}">
            ${i === 1 ? '<div class="vip-hot-badge">最受欢迎</div>' : ''}
            <div class="vip-card-name">${esc(p.name)}</div>
            <div class="vip-card-tagline">${esc(p.tagline || '')}</div>
            <div class="vip-card-price">${price > 0 ? `<span class="vip-cny">¥</span><span class="vip-num">${price}</span><span class="vip-per">/${cycle === 'monthly' ? '月' : '年'}</span>` : '<span class="vip-num">免费</span>'}</div>
            <div class="vip-card-storage">${icon('cloud')} ${esc(p.storage || '')} 云存储</div>
            <div class="vip-benefits">${(p.benefits || []).map((b) => `<div class="vip-benefit">${icon('check')}<span>${esc(b)}</span></div>`).join('')}</div>
            <button class="btn ${mine ? '' : 'btn-primary'} btn-block vip-buy" data-i="${i}" ${mine ? 'disabled' : ''}>${mine ? '当前套餐' : (price > 0 ? '立即开通' : '免费激活')}</button>
          </div>`);
          slider.appendChild(card);
          const dot = el(`<span class="vip-dot ${i === 0 ? 'on' : ''}"></span>`);
          dot.onclick = () => slider.scrollTo({ left: i * (slider.scrollWidth / plans.length), behavior: 'smooth' });
          dots.appendChild(dot);
        });
        $$('.vip-buy', slider).forEach((b) => b.onclick = () => buy(plans[+b.dataset.i]));
      }

      slider.addEventListener('scroll', () => {
        const w = slider.scrollWidth / plans.length;
        const idx = Math.round(slider.scrollLeft / w);
        $$('.vip-dot', dots).forEach((d, i) => d.classList.toggle('on', i === idx));
      }, { passive: true });

      $$('.vip-cycle-btn', body).forEach((b) => b.onclick = () => {
        cycle = b.dataset.c;
        $$('.vip-cycle-btn', body).forEach((x) => x.classList.toggle('on', x === b));
        renderPlans();
      });

      async function buy(plan) {
        if (!u) { toast('请先登录'); return; }
        const price = cycle === 'monthly' ? plan.monthly : plan.yearly;
        if (price > 0) {
          // 在线支付（预接支付宝 / 微信）
          const { showPayMethods } = await import('./pay.js');
          showPayMethods(plan, cycle, () => setTimeout(() => location.reload(), 600));
          return;
        }
        redeemFlow(plan);
      }

      async function redeemFlow(plan) {
        const price = cycle === 'monthly' ? plan.monthly : plan.yearly;
        const b2 = el(`<div>
          <div class="muted" style="margin-bottom:12px;line-height:1.7">开通 <b>${esc(plan.name)}</b>（${cycle === 'monthly' ? '月付' : '年付'} ¥${price}）。请输入对应面额的卡密完成激活：</div>
          ${formRow('卡密', '<input class="input" data-f="card" placeholder="TP-XXXXXXXX-XXXXXXXX-..." style="font-family:monospace">')}
        </div>`);
        const m = modal({
          title: '卡密激活', body: b2,
          footer: '<button class="btn grow" data-a="c">取消</button><button class="btn btn-primary grow" data-a="ok">激活</button>',
        });
        $('[data-a="c"]', m.mask).onclick = m.close;
        $('[data-a="ok"]', m.mask).onclick = async () => {
          try {
            const r = await redeemCard($('[data-f="card"]', b2).value);
            m.close();
            toast('开通成功' + (r && r.level ? '：' + levelById(r.level).name : ''), 'ok');
            setTimeout(() => location.reload(), 800);
          } catch (e) { toast(e.message, 'err'); }
        };
      }

      /* 额度 */
      $('#vip-quota', body.closest('.overlay')).onclick = async () => {
        const uu = await currentUser();
        const lv = levelById(uu ? uu.level : 'guest');
        const used = (uu && uu.storageUsed) || 0;
        const pct = lv.storage === Infinity ? 0 : Math.min(100, (used / lv.storage) * 100);
        openOverlay({
          title: '我的额度',
          build: (b2) => {
            b2.innerHTML = `<div class="set-wrap">
              <div class="section-title">存储额度</div>
              <div class="card mb16">
                <div class="row gap8" style="align-items:baseline">
                  <span style="font-size:20px;font-weight:800;color:var(--primary)">${fmtBytes(used)}</span>
                  <span class="muted">/ ${lv.storage === Infinity ? '无限' : fmtBytes(lv.storage)}</span>
                </div>
                <div class="storage-bar mt8"><div class="storage-fill" style="width:${pct}%"></div></div>
                <div class="muted mt8" style="font-size:12px">当前等级「${lv.name}」包含的云存储空间，用于云端备份与同步数据。</div>
              </div>
              <div class="section-title">API 代理额度</div>
              <div class="card">
                <div class="row gap8" style="align-items:center"><span class="tag ${lv.price > 0 ? 'tag-green' : 'tag-gray'}">${lv.price > 0 ? '已解锁' : '未解锁'}</span><span style="font-weight:700">会员云端代理</span></div>
                <div class="muted mt8" style="font-size:12px;line-height:1.7">${lv.price > 0
                  ? '你的会员已解锁云端代理：各模块可选择使用 ThirdHub 后端代理转发请求，实现多设备同步输出。在各模块的「代理设置」中启用。'
                  : '免费用户与游客默认使用自己的设备或自有服务器代理请求。开通任意付费会员后，即可在各模块的「代理设置」中选择使用 ThirdHub 云端代理，实现多设备同步输出。'}</div>
              </div>
            </div>`;
          },
        });
      };

      /* 发票 */
      $('#vip-invoice', body.closest('.overlay')).onclick = () => {
        const b2 = el(`<div>
          <div class="muted" style="margin-bottom:12px;line-height:1.7">提交开票申请后，管理员团队会在 7 个工作日内处理并发送至你的邮箱。</div>
          ${formRow('发票抬头', '<input class="input" data-f="t" placeholder="个人姓名或公司全称">')}
          ${formRow('税号（公司必填）', '<input class="input" data-f="tax" placeholder="统一社会信用代码">')}
          ${formRow('接收邮箱', `<input class="input" type="email" data-f="mail" value="${esc((u && u.email) || '')}">`)}
          ${formRow('订单 / 卡密信息', '<input class="input" data-f="order" placeholder="购买时间或卡密前 8 位">')}
        </div>`);
        const m = modal({
          title: '申请发票', body: b2,
          footer: '<button class="btn grow" data-a="c">取消</button><button class="btn btn-primary grow" data-a="ok">提交申请</button>',
        });
        $('[data-a="c"]', m.mask).onclick = m.close;
        $('[data-a="ok"]', m.mask).onclick = async () => {
          const t = $('[data-f="t"]', b2).value.trim();
          const mail = $('[data-f="mail"]', b2).value.trim();
          if (!t || !mail) { toast('请填写抬头和邮箱'); return; }
          try {
            await addFeedback({
              title: '【发票申请】' + t,
              content: `抬头：${t}\n税号：${$('[data-f="tax"]', b2).value.trim() || '无'}\n接收邮箱：${mail}\n订单信息：${$('[data-f="order"]', b2).value.trim() || '未提供'}`,
              visibility: 'admin',
            });
            m.close();
            toast('开票申请已提交', 'ok');
          } catch (e) { toast('提交失败：' + e.message, 'err'); }
        };
      };

      renderPlans();
    },
  });
}
