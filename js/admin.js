/* ===== ThirdHub js/admin.js — 管理后台（v1.9） =====
   入口 admin.html · 账号 admin · 密码 123456
   仪表盘 / 用户管理（等级分组·关注星标）/ 用户数据（书源·API 密钥）/ 订单管理 / 发票管理 / 会员定价 /
   模型定价（花费估算价目·支持文件导入）/ 排行榜（综合榜云端维护）/ 意见反馈 / 收款设置
   所有写操作经 Supabase RPC 口令校验，无需暴露 service key */
(function () {
'use strict';

var CLOUD = {
  url: 'https://mxvxlgjzeboktufumxbp.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14dnhsZ2p6ZWJva3R1ZnVteGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzODM5OTcsImV4cCI6MjA5OTk1OTk5N30.QjSLfYAFhwX72YSeAcbTN5O2_PDLaNcv76HhdGJsqpo',
};

var LEVELS = [
  { id: 'guest', name: '游客', color: '#9aa3b2' },
  { id: 'satellite', name: '卫星', color: '#60a5fa' },
  { id: 'planet', name: '行星', color: '#34d399' },
  { id: 'star', name: '恒星', color: '#fbbf24' },
  { id: 'galaxy', name: '星系', color: '#f472b6' },
  { id: 'universe', name: '宇宙', color: '#a78bfa' },
];
var TABS = [
  { id: 'dashboard', name: '仪表盘' },
  { id: 'users', name: '用户管理' },
  { id: 'userdata', name: '用户数据' },
  { id: 'orders', name: '订单管理' },
  { id: 'invoices', name: '发票管理' },
  { id: 'plans', name: '会员定价' },
  { id: 'prices', name: '模型定价' },
  { id: 'rank', name: '排行榜' },
  { id: 'feedback', name: '意见反馈' },
  { id: 'paycfg', name: '收款设置' },
];

function $(s, el) { return (el || document).querySelector(s); }
function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmtDate(s) {
  if (!s) return '-';
  var d = new Date(s);
  if (isNaN(d)) return '-';
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function levelName(id) { var l = LEVELS.find(function (x) { return x.id === id; }); return l ? l.name : (id || '游客'); }
function levelColor(id) { var l = LEVELS.find(function (x) { return x.id === id; }); return l ? l.color : '#9aa3b2'; }

var sb = null;
var PWD = sessionStorage.getItem('th-admin-pwd') || '';
var state = {
  tab: 'dashboard',
  users: null,          // 缓存用户列表
  userTab: '',          // 用户管理等级分组
  userSearch: '',
  dataUid: '',
  orders: null,
};

/* 关注列表（本机存储） */
function getFollowed() { try { return JSON.parse(localStorage.getItem('th_admin_followed') || '[]'); } catch (e) { return []; } }
function setFollowed(v) { localStorage.setItem('th_admin_followed', JSON.stringify(v)); }
function isFollowed(uid) { return getFollowed().indexOf(uid) >= 0; }
function toggleFollow(uid) {
  var f = getFollowed();
  var i = f.indexOf(uid);
  if (i >= 0) f.splice(i, 1); else f.push(uid);
  setFollowed(f);
}

function loadSb() {
  if (sb) return Promise.resolve(sb);
  return new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    s.onload = function () {
      sb = window.supabase.createClient(CLOUD.url, CLOUD.anon);
      resolve(sb);
    };
    s.onerror = function () { reject(new Error('网络异常，Supabase 组件加载失败')); };
    document.head.appendChild(s);
  });
}

function toast(msg, ok) {
  var t = document.createElement('div');
  t.className = 'adm-toast ' + (ok === false ? 'err' : 'ok');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 2400);
}

/* ---------- 登录门 ---------- */
function renderGate() {
  $('#app').innerHTML =
    '<div class="adm-login">' +
      '<img src="icons/brand.jpg" alt="ThirdHub">' +
      '<h2 style="margin:0 0 4px">ThirdHub 管理后台</h2>' +
      '<p class="adm-muted" style="margin:0 0 18px">第三方科技 · 运营管理</p>' +
      '<input class="adm-input" id="g-user" placeholder="账号" value="admin">' +
      '<input class="adm-input" id="g-pwd" type="password" placeholder="密码">' +
      '<button class="adm-btn adm-btn-primary adm-btn-block" id="g-login">登录</button>' +
      '<p id="g-err" style="color:#ef4444;font-size:13px;margin-top:10px"></p>' +
    '</div>';
  function doLogin() {
    var user = $('#g-user').value.trim();
    var pwd = $('#g-pwd').value;
    var err = $('#g-err');
    if (user !== 'admin') { err.textContent = '账号不存在'; return; }
    err.textContent = '验证中…';
    loadSb().then(function (cli) {
      return cli.rpc('admin_list_feedback', { pwd: pwd });
    }).then(function (r) {
      if (r.error) throw r.error;
      PWD = pwd;
      sessionStorage.setItem('th-admin-pwd', pwd);
      renderHome();
    }).catch(function () { err.textContent = '密码错误或云端不可用'; });
  }
  $('#g-login').onclick = doLogin;
  $('#g-pwd').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
}

/* ---------- 主框架 ---------- */
function renderHome() {
  var html = '<div class="adm-wrap">' +
    '<div class="adm-head">' +
      '<img src="icons/brand.jpg" alt="">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:18px;font-weight:800">ThirdHub 管理后台</div>' +
        '<div class="adm-muted">第三方科技 · 运营管理端</div>' +
      '</div>' +
      '<button class="adm-btn adm-btn-sm" data-act="logout">退出</button>' +
    '</div>' +
    '<div class="adm-tabs">' +
      TABS.map(function (t) {
        return '<button class="adm-tab' + (state.tab === t.id ? ' on' : '') + '" data-act="tab" data-t="' + t.id + '">' + t.name + '</button>';
      }).join('') +
    '</div>' +
    '<div id="adm-body"></div>' +
  '</div>';
  $('#app').innerHTML = html;
  renderBody();
}

function renderBody() {
  var body = $('#adm-body');
  if (!body) return;
  if (state.tab === 'dashboard') renderDashboard(body);
  else if (state.tab === 'users') renderUsers(body);
  else if (state.tab === 'userdata') renderUserData(body);
  else if (state.tab === 'orders') renderOrders(body);
  else if (state.tab === 'invoices') renderInvoices(body);
  else if (state.tab === 'plans') renderPlans(body);
  else if (state.tab === 'prices') renderPrices(body);
  else if (state.tab === 'rank') renderRank(body);
  else if (state.tab === 'feedback') renderFeedback(body);
  else if (state.tab === 'paycfg') renderPayCfg(body);
}

/* ---------- 数据加载 ---------- */
function fetchUsers(force) {
  if (state.users && !force) return Promise.resolve(state.users);
  return loadSb().then(function (cli) {
    return cli.rpc('admin_list_users', { pwd: PWD });
  }).then(function (r) {
    if (r.error) throw r.error;
    state.users = r.data || [];
    return state.users;
  });
}

/* ---------- 仪表盘 ---------- */
function renderDashboard(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  Promise.all([
    fetchUsers(),
    loadSb().then(function (cli) { return cli.rpc('admin_list_orders', { pwd: PWD }); }),
    loadSb().then(function (cli) { return cli.rpc('admin_list_feedback', { pwd: PWD }); }),
  ]).then(function (rs) {
    var users = rs[0];
    var orders = rs[1].error ? [] : (rs[1].data || []);
    var fb = rs[2].error ? [] : (rs[2].data || []);
    var byLevel = {};
    LEVELS.forEach(function (l) { byLevel[l.id] = 0; });
    users.forEach(function (u) { var k = u.level || 'guest'; byLevel[k] = (byLevel[k] || 0) + 1; });
    var maxLv = Math.max.apply(null, LEVELS.map(function (l) { return byLevel[l.id] || 0; }).concat([1]));
    var pending = orders.filter(function (o) { return o.status === 'pending'; }).length;
    var paidSum = orders.filter(function (o) { return o.status === 'paid'; }).reduce(function (s, o) { return s + (Number(o.amount) || 0); }, 0);
    var openFb = fb.filter(function (f) { var d = f.data || {}; return d.status !== 'done'; }).length;
    body.innerHTML =
      '<div class="adm-stat-grid">' +
        '<div class="adm-card adm-stat" data-act="go" data-t="users"><div class="adm-stat-num">' + users.length + '</div><div class="adm-muted">注册用户</div></div>' +
        '<div class="adm-card adm-stat" data-act="go" data-t="orders"><div class="adm-stat-num" style="color:#fbbf24">' + pending + '</div><div class="adm-muted">待确认订单</div></div>' +
        '<div class="adm-card adm-stat" data-act="go" data-t="orders"><div class="adm-stat-num" style="color:#34d399">¥' + paidSum.toFixed(0) + '</div><div class="adm-muted">已收款金额</div></div>' +
        '<div class="adm-card adm-stat" data-act="go" data-t="feedback"><div class="adm-stat-num" style="color:#60a5fa">' + openFb + '</div><div class="adm-muted">待处理反馈</div></div>' +
      '</div>' +
      '<div class="adm-card" style="margin-top:14px">' +
        '<div style="font-weight:700;margin-bottom:12px">会员等级分布</div>' +
        LEVELS.map(function (l) {
          var n = byLevel[l.id] || 0;
          var w = Math.round(n / maxLv * 100);
          return '<div class="adm-bar-row"><span class="adm-bar-label">' + l.name + '</span>' +
            '<div class="adm-bar-track"><div class="adm-bar-fill" style="width:' + Math.max(w, n ? 6 : 0) + '%;background:' + l.color + '"></div></div>' +
            '<span class="adm-bar-num">' + n + '</span></div>';
        }).join('') +
      '</div>' +
      '<div class="adm-card" style="margin-top:14px"><div style="font-weight:700;margin-bottom:8px">快捷入口</div>' +
        '<div class="adm-row">' +
          '<button class="adm-btn" data-act="go" data-t="users">用户管理</button>' +
          '<button class="adm-btn" data-act="go" data-t="userdata">查看用户数据</button>' +
          '<button class="adm-btn" data-act="go" data-t="orders">订单管理</button>' +
          '<button class="adm-btn" data-act="go" data-t="paycfg">收款设置</button>' +
        '</div></div>';
  }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

/* ---------- 用户管理 ---------- */
function renderUsers(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  fetchUsers().then(function (users) {
    var tabs = [{ id: '', name: '全部' }, { id: '__followed', name: '⭐ 关注' }].concat(LEVELS);
    var html = '<div class="adm-subtabs">' +
      tabs.map(function (t) {
        return '<button class="adm-tab adm-tab-sm' + (state.userTab === t.id ? ' on' : '') + '" data-act="usertab" data-t="' + t.id + '">' + t.name + '</button>';
      }).join('') + '</div>' +
      '<input class="adm-input" id="u-search" placeholder="搜索昵称 / 邮箱…" value="' + esc(state.userSearch) + '" style="margin-bottom:12px">' +
      '<div id="u-list"></div>';
    body.innerHTML = html;
    $('#u-search').addEventListener('input', function () {
      state.userSearch = this.value;
      renderUserList(users);
    });
    renderUserList(users);
  }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

function renderUserList(allUsers) {
  var box = $('#u-list');
  if (!box) return;
  var kw = state.userSearch.trim().toLowerCase();
  var list = allUsers.slice();
  if (state.userTab === '__followed') list = list.filter(function (u) { return isFollowed(u.id); });
  else if (state.userTab) list = list.filter(function (u) { return (u.level || 'guest') === state.userTab; });
  if (kw) list = list.filter(function (u) {
    return (String(u.nickname || '').toLowerCase().indexOf(kw) >= 0) || (String(u.email || '').toLowerCase().indexOf(kw) >= 0);
  });
  list.sort(function (a, b) { return (isFollowed(b.id) ? 1 : 0) - (isFollowed(a.id) ? 1 : 0); });
  if (!list.length) {
    box.innerHTML = '<p class="adm-muted" style="text-align:center;padding:24px 0">' +
      (state.userTab === '__followed' ? '还没有关注的用户，点击用户卡片上的 ☆ 关注他们' : '暂无用户') + '</p>';
    return;
  }
  box.innerHTML = list.map(function (u) {
    var lv = u.level || 'guest';
    var expired = u.expire_at && new Date(u.expire_at) < new Date();
    return '<div class="adm-card adm-user" data-uid="' + u.id + '">' +
      '<button class="adm-star" data-act="follow" data-uid="' + u.id + '" title="关注/取消关注">' + (isFollowed(u.id) ? '⭐' : '☆') + '</button>' +
      '<div class="adm-avatar">' + esc((u.nickname || u.email || 'U').charAt(0).toUpperCase()) + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:600;font-size:14px">' + esc(u.nickname || '未命名') + '</div>' +
        '<div class="adm-muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(u.email || '') + '</div>' +
        '<div class="adm-muted">注册 ' + fmtDate(u.created_at) + (u.expire_at ? ' · 会员' + (expired ? '已过期 ' : '至 ') + fmtDate(u.expire_at).slice(0, 10) : '') + '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
        '<span class="adm-badge" style="background:' + levelColor(lv) + '22;color:' + levelColor(lv) + '">' + levelName(lv) + '</span>' +
        '<div style="margin-top:6px"><button class="adm-btn adm-btn-sm" data-act="setlevel" data-uid="' + u.id + '">调整等级</button></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function setUserLevel(uid) {
  var u = (state.users || []).find(function (x) { return x.id === uid; });
  if (!u) return;
  var opts = LEVELS.map(function (l) { return l.id + '（' + l.name + '）'; }).join('\n');
  var lv = prompt('设置用户「' + (u.nickname || u.email) + '」的会员等级，输入等级 ID：\n' + opts, u.level || 'guest');
  if (!lv) return;
  lv = lv.trim();
  if (!LEVELS.find(function (l) { return l.id === lv; })) { toast('等级 ID 无效', false); return; }
  var days = 0;
  if (lv !== 'guest') {
    var d = prompt('会员有效期天数（0 = 永久，30/365 常用）', '365');
    if (d === null) return;
    days = parseInt(d, 10) || 0;
  }
  var expire = null;
  if (lv !== 'guest' && days > 0) expire = new Date(Date.now() + days * 864e5).toISOString();
  loadSb().then(function (cli) {
    return cli.rpc('admin_set_user_level', { pwd: PWD, uid: uid, p_level: lv, p_expire: expire });
  }).then(function (r) {
    if (r.error) throw r.error;
    toast('已更新等级');
    state.users = null;
    renderBody();
  }).catch(function (e) { toast('失败：' + e.message, false); });
}

/* ---------- 用户数据（书源 / API 密钥） ---------- */
function renderUserData(body) {
  body.innerHTML = '<p class="adm-muted">加载用户列表…</p>';
  fetchUsers().then(function (users) {
    body.innerHTML =
      '<p class="adm-muted" style="margin-bottom:10px">选择一个用户，查看他上传到云端的书源与 API 密钥。加密上传的密钥管理员不可见，明文上传的可以直接查看。</p>' +
      '<select class="adm-input" id="ud-user" style="margin-bottom:14px">' +
        '<option value="">— 选择用户 —</option>' +
        users.map(function (u) {
          return '<option value="' + u.id + '"' + (state.dataUid === u.id ? ' selected' : '') + '>' +
            esc((u.nickname || '未命名') + ' · ' + (u.email || '')) + '</option>';
        }).join('') +
      '</select>' +
      '<div id="ud-body">' + (state.dataUid ? '' : '<p class="adm-muted" style="text-align:center;padding:20px 0">请先选择用户</p>') + '</div>';
    $('#ud-user').addEventListener('change', function () {
      state.dataUid = this.value;
      if (state.dataUid) loadUserDataDetail();
      else $('#ud-body').innerHTML = '<p class="adm-muted" style="text-align:center;padding:20px 0">请先选择用户</p>';
    });
    if (state.dataUid) loadUserDataDetail();
  }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

function loadUserDataDetail() {
  var box = $('#ud-body');
  if (!box) return;
  var uid = state.dataUid;
  box.innerHTML = '<p class="adm-muted">加载中…</p>';
  loadSb().then(function (cli) {
    return Promise.all([
      cli.rpc('admin_get_user_keys', { pwd: PWD, uid: uid }),
      cli.rpc('admin_get_user_sources', { pwd: PWD, uid: uid }),
    ]);
  }).then(function (rs) {
    var keys = rs[0].error ? [] : (rs[0].data || []);
    var sources = rs[1].error ? [] : (rs[1].data || []);
    var typeName = { novel: '小说', comic: '漫画', video: '影视', audio: '听书', music: '音乐' };
    var html = '<div class="adm-sec-title">API 密钥（' + keys.length + '）</div>';
    if (!keys.length) html += '<p class="adm-muted">该用户未上传任何密钥（密钥可选择仅保存本机）</p>';
    else html += keys.map(function (k) {
      var enc = k.mode === 'enc' || (k.payload || '').indexOf('enc1:') === 0;
      return '<div class="adm-card" style="padding:10px 12px;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<b style="font-size:14px;flex:1">' + esc(k.name || k.key_id) + '</b>' +
          (enc ? '<span class="adm-badge" style="background:#fbbf2422;color:#fbbf24">🔒 已加密 · 不可见</span>'
               : '<span class="adm-badge" style="background:#34d39922;color:#34d399">明文 · 可见</span>') +
        '</div>' +
        (k.base ? '<div class="adm-muted" style="margin-top:4px;word-break:break-all">' + esc(k.base) + '</div>' : '') +
        '<div class="adm-mono" style="margin-top:4px">' + (enc ? '（本地密码加密，无法查看）' : esc(k.payload || '（空）')) + '</div>' +
        '<div class="adm-muted" style="margin-top:4px">更新于 ' + fmtDate(k.updated_at) + '</div>' +
      '</div>';
    }).join('');
    html += '<div class="adm-sec-title" style="margin-top:18px">书源 / 连接器（' + sources.length + '）</div>';
    if (!sources.length) html += '<p class="adm-muted">该用户未同步书源到云端</p>';
    else html += sources.map(function (s) {
      var d = s.data || {};
      return '<div class="adm-card" style="padding:10px 12px;margin-bottom:8px;display:flex;align-items:center;gap:8px">' +
        '<div style="flex:1;min-width:0"><b style="font-size:14px">' + esc(d.name || s.id) + '</b>' +
        '<div class="adm-muted">' + esc(typeName[d.type] || d.type || '-') + (d.author ? ' · ' + esc(d.author) : '') + (d.url ? ' · ' + esc(d.url) : '') + '</div></div>' +
        '<span class="adm-badge" style="background:' + (d.enabled !== false ? '#34d39922;color:#34d399' : '#9aa3b222;color:#9aa3b2') + '">' + (d.enabled !== false ? '启用' : '停用') + '</span>' +
      '</div>';
    }).join('');
    box.innerHTML = html;
  }).catch(function (e) { box.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

/* ---------- 订单管理 ---------- */
function renderOrders(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  loadSb().then(function (cli) { return cli.rpc('admin_list_orders', { pwd: PWD }); })
    .then(function (r) {
      if (r.error) throw r.error;
      var orders = r.data || [];
      state.orders = orders;
      if (!orders.length) { body.innerHTML = '<p class="adm-muted" style="text-align:center;padding:24px 0">暂无订单</p>'; return; }
      var mName = { alipay: '支付宝', wechat: '微信' };
      var sName = { pending: '待确认', paid: '已收款', cancelled: '已取消' };
      var sColor = { pending: '#fbbf24', paid: '#34d399', cancelled: '#9aa3b2' };
      body.innerHTML = '<p class="adm-muted" style="margin-bottom:12px">用户支付后订单出现在这里，核对收款后点击「确认收款」，系统会自动开通对应会员。</p>' +
        orders.map(function (o) {
          return '<div class="adm-card" style="margin-bottom:10px">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<b class="adm-mono" style="font-size:13px;flex:1">' + esc(o.order_no) + '</b>' +
              '<span class="adm-badge" style="background:' + sColor[o.status] + '22;color:' + sColor[o.status] + '">' + (sName[o.status] || o.status) + '</span>' +
            '</div>' +
            '<div style="margin-top:6px;font-size:14px">' + esc(o.plan_name || o.plan || '-') + ' · ' + (o.period === 'yearly' ? '年付' : '月付') + ' · <b style="color:#34d399">¥' + Number(o.amount || 0).toFixed(2) + '</b> · ' + (mName[o.pay_method] || o.pay_method || '-') + '</div>' +
            '<div class="adm-muted" style="margin-top:4px">用户 ' + esc(String(o.user_id || '').slice(0, 8)) + '… · ' + fmtDate(o.created_at) + (o.paid_at ? ' · 收款 ' + fmtDate(o.paid_at) : '') + '</div>' +
            (o.status === 'pending' ?
              '<div class="adm-row" style="margin-top:8px">' +
                '<button class="adm-btn adm-btn-sm adm-btn-primary" data-act="confirm-order" data-no="' + esc(o.order_no) + '">确认收款</button>' +
                '<button class="adm-btn adm-btn-sm" data-act="cancel-order" data-no="' + esc(o.order_no) + '">取消订单</button>' +
              '</div>' : '') +
          '</div>';
        }).join('');
    }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

/* ---------- 发票管理 ---------- */
function renderInvoices(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  Promise.all([
    loadSb().then(function (cli) { return cli.rpc('admin_list_invoices', { pwd: PWD }); }),
    fetchUsers(),
  ]).then(function (rs) {
    var r = rs[0], users = rs[1];
    if (r.error) throw r.error;
    var emailOf = {};
    users.forEach(function (u) { emailOf[u.id] = u.email || ''; });
    var list = r.data || [];
    if (!list.length) { body.innerHTML = '<p class="adm-muted" style="text-align:center;padding:24px 0">暂无发票申请</p>'; return; }
    body.innerHTML = '<p class="adm-muted" style="margin-bottom:12px">用户在 App「会员中心 → 发票」对购买记录提交的开票申请。开具并发往用户邮箱后，点击「标记已开具」。</p>' +
      list.map(function (iv) {
        var done = iv.status === 'done';
        return '<div class="adm-card" data-iv="' + esc(iv.id) + '" style="margin-bottom:10px">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<b style="flex:1;font-size:14px">' + esc(iv.title) + '</b>' +
            '<span class="adm-badge" style="background:' + (done ? '#34d39922;color:#34d399' : '#fbbf2422;color:#fbbf24') + '">' + (done ? '已开具' : '待处理') + '</span>' +
          '</div>' +
          '<div style="margin-top:6px;font-size:14px">金额 <b style="color:#34d399">¥' + Number(iv.amount || 0).toFixed(2) + '</b>' +
            (iv.tax_no ? ' · 税号 ' + esc(iv.tax_no) : ' · 个人') + '</div>' +
          '<div class="adm-muted" style="margin-top:4px">接收邮箱 ' + esc(iv.email) + '</div>' +
          '<div class="adm-muted adm-mono" style="margin-top:2px;font-size:12px">订单号 ' + esc(iv.order_no) + '</div>' +
          '<div class="adm-muted" style="margin-top:2px">用户 ' + esc(emailOf[iv.user_id] || String(iv.user_id).slice(0, 8) + '…') + ' · ' + fmtDate(iv.created_at) + '</div>' +
          '<div class="adm-row" style="margin-top:8px">' +
            '<button class="adm-btn adm-btn-sm ' + (done ? '' : 'adm-btn-primary') + '" data-act="toggle-invoice">' + (done ? '标记待处理' : '标记已开具') + '</button>' +
          '</div>' +
        '</div>';
      }).join('');
  }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

/* ---------- 模型定价（花费估算价目，USD / 1M tokens） ---------- */
function renderPrices(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  loadSb().then(function (cli) { return cli.from('th_model_prices').select('*').order('model'); })
    .then(function (r) {
      if (r.error) throw r.error;
      var rows = r.data || [];
      body.innerHTML =
        '<p class="adm-muted" style="margin-bottom:12px">这里维护 App「用量统计 → 花费估算」使用的模型刊例价（<b>美元 / 1M tokens</b>）。云端价目优先于 App 内置价目；键可写「厂商/模型」（如 openai/gpt-5）或裸模型名。修改后用户端下次启动生效。</p>' +
        '<div class="adm-card" style="margin-bottom:12px">' +
          '<b>' + (state.priceEdit ? '编辑：' + esc(state.priceEdit) : '新增 / 更新价格') + '</b>' +
          '<div class="adm-form-grid" style="margin-top:8px">' +
            '<label class="adm-muted">模型键<input class="adm-input" data-f="p-model" value="' + esc(state.priceEdit || '') + '" placeholder="openai/gpt-5"></label>' +
            '<label class="adm-muted">输入价（USD/1M）<input class="adm-input" type="number" step="0.001" min="0" data-f="p-in" value="' + (state.priceIn || '') + '"></label>' +
            '<label class="adm-muted">输出价（USD/1M）<input class="adm-input" type="number" step="0.001" min="0" data-f="p-out" value="' + (state.priceOut || '') + '"></label>' +
          '</div>' +
          '<div class="adm-row" style="margin-top:10px;flex-wrap:wrap">' +
            '<button class="adm-btn adm-btn-primary adm-btn-sm" data-act="save-price">保存价格</button>' +
            '<button class="adm-btn adm-btn-sm" data-act="import-prices">导入内置价目</button>' +
            '<label class="adm-btn adm-btn-sm" style="cursor:pointer">从文件导入<input type="file" accept=".json,.csv,.txt" data-act-file="prices" style="display:none"></label>' +
          '</div>' +
          '<p class="adm-muted" style="margin-top:8px;font-size:12px">文件格式：JSON 数组 [{"model":"openai/gpt-5","in":1.25,"out":10}]，或每行一条「模型,输入价,输出价」。</p>' +
        '</div>' +
        (rows.length ?
          rows.map(function (p) {
            return '<div class="adm-card" style="margin-bottom:8px" data-model="' + esc(p.model) + '">' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                '<b class="adm-mono" style="flex:1;font-size:13px">' + esc(p.model) + '</b>' +
                '<span class="adm-badge" style="background:#3b5bfd22;color:#7da2ff">in $' + Number(p.input_price) + ' / out $' + Number(p.output_price) + '</span>' +
                '<button class="adm-btn adm-btn-sm" data-act="edit-price">编辑</button>' +
                '<button class="adm-btn adm-btn-sm" data-act="del-price">删除</button>' +
              '</div>' +
              '<div class="adm-muted" style="margin-top:4px;font-size:12px">更新于 ' + fmtDate(p.updated_at) + '</div>' +
            '</div>';
          }).join('')
          : '<p class="adm-muted" style="text-align:center;padding:16px 0">云端还没有自定义价目（App 暂用内置价目）</p>');
    }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

function importPrices(rows, doneMsg) {
  var i = 0, fail = 0;
  toast('开始导入 ' + rows.length + ' 条价格…');
  function next() {
    if (i >= rows.length) { toast('导入完成：成功 ' + (rows.length - fail) + ' 条' + (fail ? '，失败 ' + fail + ' 条' : '')); renderBody(); return; }
    var p = rows[i++];
    loadSb().then(function (cli) {
      return cli.rpc('admin_set_model_price', { pwd: PWD, p_model: p.model, p_in: p.in, p_out: p.out });
    }).then(function (r) { if (r.error) fail++; next(); })
      .catch(function () { fail++; next(); });
  }
  next();
}

/* ---------- 排行榜（云端综合榜） ---------- */
function renderRank(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  loadSb().then(function (cli) { return cli.from('th_leaderboard').select('*').order('rank'); })
    .then(function (r) {
      if (r.error) throw r.error;
      var rows = r.data || [];
      body.innerHTML =
        '<p class="adm-muted" style="margin-bottom:12px">这里维护 App「模型排行榜 → 综合榜」的展示数据。云端有数据时覆盖内置榜单；其余分类榜仍用内置快照。厂商 ID 用于显示图标（openai / anthropic / google / xai / moonshot / deepseek / aliyun / zhipu / minimax / bytedance / xiaomi / tencent / mistral…）。</p>' +
        '<div class="adm-card" style="margin-bottom:12px">' +
          '<b>' + (state.rankEdit != null ? '编辑名次 ' + state.rankEdit : '新增名次') + '</b>' +
          '<div class="adm-form-grid" style="margin-top:8px">' +
            '<label class="adm-muted">名次<input class="adm-input" type="number" min="1" data-f="r-rank" value="' + (state.rankEdit != null ? state.rankEdit : (rows.length + 1)) + '"></label>' +
            '<label class="adm-muted">模型名<input class="adm-input" data-f="r-model" value="' + esc(state.rankModel || '') + '" placeholder="GPT-5.1"></label>' +
            '<label class="adm-muted">厂商 ID<input class="adm-input" data-f="r-org" value="' + esc(state.rankOrg || '') + '" placeholder="openai"></label>' +
            '<label class="adm-muted">综合分（0-100）<input class="adm-input" type="number" step="0.5" min="0" max="100" data-f="r-score" value="' + (state.rankScore || '') + '"></label>' +
          '</div>' +
          '<div class="adm-row" style="margin-top:10px;flex-wrap:wrap">' +
            '<button class="adm-btn adm-btn-primary adm-btn-sm" data-act="save-rank">保存</button>' +
            '<button class="adm-btn adm-btn-sm" data-act="import-rank">导入内置综合榜</button>' +
          '</div>' +
        '</div>' +
        (rows.length ?
          rows.map(function (x) {
            return '<div class="adm-card" style="margin-bottom:8px" data-rank="' + x.rank + '">' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                '<b style="width:28px">#' + x.rank + '</b>' +
                '<b style="flex:1;font-size:14px">' + esc(x.model) + '</b>' +
                '<span class="adm-badge" style="background:#3b5bfd22;color:#7da2ff">' + esc(x.org || '-') + ' · ' + Number(x.score) + ' 分</span>' +
                '<button class="adm-btn adm-btn-sm" data-act="edit-rank">编辑</button>' +
                '<button class="adm-btn adm-btn-sm" data-act="del-rank">删除</button>' +
              '</div>' +
            '</div>';
          }).join('')
          : '<p class="adm-muted" style="text-align:center;padding:16px 0">云端还没有排行榜数据（App 暂用内置榜单）</p>');
    }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

/* ---------- 会员定价 ---------- */
function renderPlans(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  loadSb().then(function (cli) { return cli.from('th_vip_plans').select('*'); })
    .then(function (r) {
      if (r.error) throw r.error;
      var order = ['satellite', 'planet', 'star', 'galaxy'];
      var plans = (r.data || []).sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
      body.innerHTML =
        '<p class="adm-muted" style="margin-bottom:14px">修改后点击「保存」，用户端会员中心立即生效。价格单位：人民币元。</p>' +
        plans.map(function (p) {
          var d = p.data || {};
          return '<div class="adm-card" data-pid="' + esc(p.id) + '" style="margin-bottom:12px">' +
            '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><b style="font-size:15px">' + esc(d.name || p.id) + '</b>' +
            '<span class="adm-badge" style="background:#3b5bfd22;color:#7da2ff">' + esc(d.storage || '') + '</span></div>' +
            '<div class="adm-form-grid">' +
              '<label class="adm-muted">套餐名称<input class="adm-input" data-f="name" value="' + esc(d.name || '') + '"></label>' +
              '<label class="adm-muted">副标题<input class="adm-input" data-f="tagline" value="' + esc(d.tagline || '') + '"></label>' +
              '<label class="adm-muted">月付价格（元）<input class="adm-input" type="number" min="0" data-f="monthly" value="' + (d.monthly || 0) + '"></label>' +
              '<label class="adm-muted">年付价格（元）<input class="adm-input" type="number" min="0" data-f="yearly" value="' + (d.yearly || 0) + '"></label>' +
              '<label class="adm-muted">存储额度<input class="adm-input" data-f="storage" value="' + esc(d.storage || '') + '"></label>' +
              '<label class="adm-muted">会员等级 ID<input class="adm-input" data-f="level" value="' + esc(d.level || p.id) + '"></label>' +
            '</div>' +
            '<label class="adm-muted" style="display:block;margin-top:10px">权益列表（每行一条）' +
              '<textarea class="adm-input" rows="4" data-f="benefits">' + esc((d.benefits || []).join('\n')) + '</textarea></label>' +
            '<button class="adm-btn adm-btn-primary adm-btn-sm" data-act="save-plan" style="margin-top:10px">保存</button>' +
          '</div>';
        }).join('');
    }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

function savePlan(btn) {
  var card = btn.closest('[data-pid]');
  var pid = card.getAttribute('data-pid');
  var d = {
    name: $('[data-f="name"]', card).value.trim(),
    tagline: $('[data-f="tagline"]', card).value.trim(),
    monthly: parseFloat($('[data-f="monthly"]', card).value) || 0,
    yearly: parseFloat($('[data-f="yearly"]', card).value) || 0,
    storage: $('[data-f="storage"]', card).value.trim(),
    level: $('[data-f="level"]', card).value.trim() || pid,
    benefits: $('[data-f="benefits"]', card).value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
  };
  btn.disabled = true;
  loadSb().then(function (cli) {
    return cli.rpc('admin_upsert_vip_plan', { pwd: PWD, pid: pid, pdata: d });
  }).then(function (r) {
    if (r.error) throw r.error;
    toast('已保存');
  }).catch(function (e) { toast('保存失败：' + e.message, false); })
    .finally(function () { btn.disabled = false; });
}

/* ---------- 意见反馈 ---------- */
function renderFeedback(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  loadSb().then(function (cli) { return cli.rpc('admin_list_feedback', { pwd: PWD }); })
    .then(function (r) {
      if (r.error) throw r.error;
      var list = r.data || [];
      if (!list.length) { body.innerHTML = '<p class="adm-muted" style="text-align:center;padding:24px 0">暂无反馈</p>'; return; }
      body.innerHTML = list.map(function (f) {
        var d = f.data || {};
        var done = d.status === 'done';
        return '<div class="adm-card" data-fid="' + esc(f.id) + '" style="margin-bottom:10px">' +
          '<div style="display:flex;gap:8px;align-items:center">' +
            '<b style="flex:1;font-size:14px">' + esc(d.title || '反馈') + '</b>' +
            '<span class="adm-badge" style="background:' + (done ? '#34d39922;color:#34d399' : '#fbbf2422;color:#fbbf24') + '">' + (done ? '已处理' : '待处理') + '</span>' +
          '</div>' +
          '<div style="margin-top:6px;font-size:14px;white-space:pre-wrap">' + esc(d.content || '') + '</div>' +
          '<div class="adm-muted" style="margin-top:6px">' + esc(d.contact || '匿名') + ' · ' + fmtDate(f.updated_at) + (d.visibility === 'admin' ? ' · 仅管理员可见' : '') + '</div>' +
          (d.reply ? '<div class="adm-reply">官方回复：' + esc(d.reply) + '</div>' : '') +
          '<div class="adm-row" style="margin-top:8px">' +
            '<button class="adm-btn adm-btn-sm" data-act="reply-fb">回复</button>' +
            '<button class="adm-btn adm-btn-sm" data-act="toggle-fb">' + (done ? '标记待处理' : '标记已处理') + '</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

/* ---------- 收款设置 ---------- */
function renderPayCfg(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  loadSb().then(function (cli) { return cli.from('th_pay_config').select('*').eq('key', 'payment'); })
    .then(function (r) {
      if (r.error) throw r.error;
      var v = (r.data && r.data[0] && r.data[0].value) || {};
      var ali = v.alipay || {}, wx = v.wechat || {};
      body.innerHTML =
        '<p class="adm-muted" style="margin-bottom:14px">预接支付：填写收款账号与收款码图片地址（可上传到任意图床）。用户下单后按此信息转账，你在「订单管理」确认收款后系统自动开通会员。后续接入官方支付网关时此处换成商户参数即可。</p>' +
        '<div class="adm-card" style="margin-bottom:12px"><b>支付宝</b>' +
          '<div class="adm-form-grid" style="margin-top:8px">' +
            '<label class="adm-muted">收款账号<input class="adm-input" data-f="ali-account" value="' + esc(ali.account || '') + '" placeholder="手机号 / 邮箱"></label>' +
            '<label class="adm-muted">收款码图片 URL<input class="adm-input" data-f="ali-qr" value="' + esc(ali.qr || '') + '" placeholder="https://…"></label>' +
          '</div>' +
          '<label class="adm-muted" style="display:block;margin-top:8px">备注说明<input class="adm-input" data-f="ali-note" value="' + esc(ali.note || '') + '" placeholder="如：请备注订单号"></label>' +
          '<label class="adm-muted" style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" data-f="ali-enabled"' + (ali.enabled !== false ? ' checked' : '') + '> 启用支付宝支付</label>' +
        '</div>' +
        '<div class="adm-card" style="margin-bottom:12px"><b>微信支付</b>' +
          '<div class="adm-form-grid" style="margin-top:8px">' +
            '<label class="adm-muted">收款账号<input class="adm-input" data-f="wx-account" value="' + esc(wx.account || '') + '" placeholder="微信号"></label>' +
            '<label class="adm-muted">收款码图片 URL<input class="adm-input" data-f="wx-qr" value="' + esc(wx.qr || '') + '" placeholder="https://…"></label>' +
          '</div>' +
          '<label class="adm-muted" style="display:block;margin-top:8px">备注说明<input class="adm-input" data-f="wx-note" value="' + esc(wx.note || '') + '" placeholder="如：请备注订单号"></label>' +
          '<label class="adm-muted" style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" data-f="wx-enabled"' + (wx.enabled !== false ? ' checked' : '') + '> 启用微信支付</label>' +
        '</div>' +
        '<div class="adm-card" style="margin-bottom:12px"><b>通用提示语</b>' +
          '<textarea class="adm-input" rows="3" data-f="tip" style="margin-top:8px">' + esc(v.tip || '') + '</textarea>' +
        '</div>' +
        '<button class="adm-btn adm-btn-primary" data-act="save-paycfg">保存收款设置</button>';
    }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

function savePayCfg() {
  var val = {
    alipay: {
      enabled: $('[data-f="ali-enabled"]').checked,
      label: '支付宝',
      account: $('[data-f="ali-account"]').value.trim(),
      qr: $('[data-f="ali-qr"]').value.trim(),
      note: $('[data-f="ali-note"]').value.trim(),
    },
    wechat: {
      enabled: $('[data-f="wx-enabled"]').checked,
      label: '微信支付',
      account: $('[data-f="wx-account"]').value.trim(),
      qr: $('[data-f="wx-qr"]').value.trim(),
      note: $('[data-f="wx-note"]').value.trim(),
    },
    tip: $('[data-f="tip"]').value.trim(),
  };
  loadSb().then(function (cli) {
    return cli.rpc('admin_set_pay_config', { pwd: PWD, val: val });
  }).then(function (r) {
    if (r.error) throw r.error;
    toast('收款设置已保存');
  }).catch(function (e) { toast('保存失败：' + e.message, false); });
}

/* ---------- 全局事件委托（一次绑定，永不失效） ---------- */
document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-act]');
  if (!t) return;
  var act = t.getAttribute('data-act');
  if (act === 'logout') {
    sessionStorage.removeItem('th-admin-pwd'); PWD = ''; state.users = null; renderGate();
  } else if (act === 'tab') {
    state.tab = t.getAttribute('data-t');
    $$('.adm-tabs .adm-tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-t') === state.tab); });
    renderBody();
  } else if (act === 'go') {
    state.tab = t.getAttribute('data-t');
    renderHome();
  } else if (act === 'usertab') {
    state.userTab = t.getAttribute('data-t');
    renderBody();
  } else if (act === 'follow') {
    toggleFollow(t.getAttribute('data-uid'));
    fetchUsers().then(function (users) { renderUserList(users); });
  } else if (act === 'setlevel') {
    setUserLevel(t.getAttribute('data-uid'));
  } else if (act === 'save-plan') {
    savePlan(t);
  } else if (act === 'confirm-order' || act === 'cancel-order') {
    var no = t.getAttribute('data-no');
    var rpc = act === 'confirm-order' ? 'admin_confirm_order' : 'admin_cancel_order';
    if (act === 'confirm-order' && !confirm('确认已收到订单 ' + no + ' 的款项？确认后将自动开通会员。')) return;
    t.disabled = true;
    loadSb().then(function (cli) { return cli.rpc(rpc, { pwd: PWD, p_order_no: no }); })
      .then(function (r) {
        if (r.error) throw r.error;
        toast(act === 'confirm-order' ? '已确认收款，会员已开通' : '订单已取消');
        renderBody();
      }).catch(function (err) { toast('操作失败：' + err.message, false); t.disabled = false; });
  } else if (act === 'reply-fb') {
    var card = t.closest('[data-fid]');
    var fid = card.getAttribute('data-fid');
    var content = prompt('输入官方回复内容：');
    if (!content) return;
    loadSb().then(function (cli) { return cli.rpc('admin_reply_feedback', { pwd: PWD, fid: fid, content: content }); })
      .then(function (r) {
        if (r.error) throw r.error;
        toast('已回复'); renderBody();
      }).catch(function (err) { toast('回复失败：' + err.message, false); });
  } else if (act === 'toggle-fb') {
    var card2 = t.closest('[data-fid]');
    var fid2 = card2.getAttribute('data-fid');
    var isDone = t.textContent.indexOf('待处理') >= 0;
    loadSb().then(function (cli) { return cli.rpc('admin_set_feedback_status', { pwd: PWD, fid: fid2, status: isDone ? 'open' : 'done' }); })
      .then(function (r) {
        if (r.error) throw r.error;
        renderBody();
      }).catch(function (err) { toast('操作失败：' + err.message, false); });
  } else if (act === 'save-paycfg') {
    savePayCfg();
  } else if (act === 'toggle-invoice') {
    var ivCard = t.closest('[data-iv]');
    var ivId = ivCard.getAttribute('data-iv');
    var nowDone = t.textContent.indexOf('待处理') >= 0; // 按钮显示“标记待处理”说明当前已开具
    t.disabled = true;
    loadSb().then(function (cli) { return cli.rpc('admin_set_invoice_status', { pwd: PWD, p_id: ivId, p_status: nowDone ? 'pending' : 'done' }); })
      .then(function (r) {
        if (r.error) throw r.error;
        toast(nowDone ? '已标记为待处理' : '已标记为已开具');
        renderBody();
      }).catch(function (err) { toast('操作失败：' + err.message, false); t.disabled = false; });
  } else if (act === 'save-price') {
    var pm = $('[data-f="p-model"]').value.trim();
    var pin = parseFloat($('[data-f="p-in"]').value);
    var pout = parseFloat($('[data-f="p-out"]').value);
    if (!pm) { toast('请填写模型键', false); return; }
    if (isNaN(pin) || isNaN(pout)) { toast('请填写输入 / 输出价格', false); return; }
    t.disabled = true;
    loadSb().then(function (cli) { return cli.rpc('admin_set_model_price', { pwd: PWD, p_model: pm, p_in: pin, p_out: pout }); })
      .then(function (r) {
        if (r.error) throw r.error;
        state.priceEdit = ''; state.priceIn = ''; state.priceOut = '';
        toast('价格已保存，用户端下次启动生效');
        renderBody();
      }).catch(function (err) { toast('保存失败：' + err.message, false); t.disabled = false; });
  } else if (act === 'edit-price') {
    var pCard = t.closest('[data-model]');
    state.priceEdit = pCard.getAttribute('data-model');
    var m = pCard.querySelector('.adm-badge').textContent.match(/in \$([\d.]+) \/ out \$([\d.]+)/);
    state.priceIn = m ? m[1] : ''; state.priceOut = m ? m[2] : '';
    renderBody();
  } else if (act === 'del-price') {
    var dm = t.closest('[data-model]').getAttribute('data-model');
    if (!confirm('删除 ' + dm + ' 的云端价格？删除后该模型回退到内置价目。')) return;
    loadSb().then(function (cli) { return cli.rpc('admin_delete_model_price', { pwd: PWD, p_model: dm }); })
      .then(function (r) {
        if (r.error) throw r.error;
        toast('已删除'); renderBody();
      }).catch(function (err) { toast('删除失败：' + err.message, false); });
  } else if (act === 'import-prices') {
    if (!confirm('把 App 内置的完整价目导入云端？导入后云端价目优先生效，可随时再编辑。')) return;
    import('./js/ai/ai-pricing.js').then(function (mod) {
      var rows = Object.keys(mod.MODEL_PRICES).map(function (k) {
        return { model: k, in: mod.MODEL_PRICES[k].in, out: mod.MODEL_PRICES[k].out };
      });
      importPrices(rows);
    }).catch(function (e) { toast('读取内置价目失败：' + e.message, false); });
  } else if (act === 'save-rank') {
    var rr = parseInt($('[data-f="r-rank"]').value, 10);
    var rm = $('[data-f="r-model"]').value.trim();
    var ro = $('[data-f="r-org"]').value.trim();
    var rs = parseFloat($('[data-f="r-score"]').value);
    if (!rr || !rm) { toast('请填写名次和模型名', false); return; }
    t.disabled = true;
    loadSb().then(function (cli) { return cli.rpc('admin_upsert_leaderboard', { pwd: PWD, p_rank: rr, p_model: rm, p_org: ro, p_score: isNaN(rs) ? 0 : rs, p_note: '' }); })
      .then(function (r) {
        if (r.error) throw r.error;
        state.rankEdit = null; state.rankModel = ''; state.rankOrg = ''; state.rankScore = '';
        toast('排行榜已保存，用户端下次启动生效');
        renderBody();
      }).catch(function (err) { toast('保存失败：' + err.message, false); t.disabled = false; });
  } else if (act === 'edit-rank') {
    var rCard = t.closest('[data-rank]');
    state.rankEdit = parseInt(rCard.getAttribute('data-rank'), 10);
    state.rankModel = rCard.querySelectorAll('b')[1].textContent;
    var badge = rCard.querySelector('.adm-badge').textContent;
    var mm = badge.match(/^(.*) · ([\d.]+) 分$/);
    state.rankOrg = mm ? mm[1].trim() : '';
    state.rankScore = mm ? mm[2] : '';
    renderBody();
  } else if (act === 'del-rank') {
    var dr = parseInt(t.closest('[data-rank]').getAttribute('data-rank'), 10);
    if (!confirm('删除名次 #' + dr + '？')) return;
    loadSb().then(function (cli) { return cli.rpc('admin_delete_leaderboard', { pwd: PWD, p_rank: dr }); })
      .then(function (r) {
        if (r.error) throw r.error;
        toast('已删除'); renderBody();
      }).catch(function (err) { toast('删除失败：' + err.message, false); });
  } else if (act === 'import-rank') {
    if (!confirm('把 App 内置综合榜导入云端？导入后覆盖 App 内置榜单，可随时再编辑。')) return;
    import('./js/ai/ai-rankings.js').then(function (mod) {
      var rows = mod.RANKINGS.overall;
      var i = 0, fail = 0;
      toast('开始导入 ' + rows.length + ' 名…');
      (function next() {
        if (i >= rows.length) { toast('导入完成' + (fail ? '（失败 ' + fail + ' 条）' : '')); renderBody(); return; }
        var x = rows[i++];
        loadSb().then(function (cli) {
          return cli.rpc('admin_upsert_leaderboard', { pwd: PWD, p_rank: i, p_model: x.m, p_org: x.p, p_score: x.s, p_note: '' });
        }).then(function (r) { if (r.error) fail++; next(); }).catch(function () { fail++; next(); });
      })();
    }).catch(function (e) { toast('读取内置榜单失败：' + e.message, false); });
  }
});

/* 文件选择（模型定价导入） */
document.addEventListener('change', function (e) {
  var f = e.target.closest('[data-act-file="prices"]');
  if (!f || !f.files || !f.files[0]) return;
  var file = f.files[0];
  var reader = new FileReader();
  reader.onload = function () {
    var rows = [];
    try {
      var txt = String(reader.result || '');
      if (/\.json$/i.test(file.name) || txt.trim().charAt(0) === '[' || txt.trim().charAt(0) === '{') {
        var j = JSON.parse(txt);
        if (Array.isArray(j)) {
          j.forEach(function (x) { if (x && x.model) rows.push({ model: String(x.model), in: parseFloat(x.in != null ? x.in : x.input_price) || 0, out: parseFloat(x.out != null ? x.out : x.output_price) || 0 }); });
        } else {
          Object.keys(j).forEach(function (k) { var v = j[k]; rows.push({ model: k, in: parseFloat(v.in != null ? v.in : v.input_price) || 0, out: parseFloat(v.out != null ? v.out : v.output_price) || 0 }); });
        }
      } else {
        txt.split(/\r?\n/).forEach(function (line) {
          var parts = line.split(/[,\t]/);
          if (parts.length >= 3 && parts[0].trim()) rows.push({ model: parts[0].trim(), in: parseFloat(parts[1]) || 0, out: parseFloat(parts[2]) || 0 });
        });
      }
    } catch (err) { toast('文件解析失败：' + err.message, false); return; }
    if (!rows.length) { toast('文件里没有可用的价格数据', false); return; }
    if (!confirm('识别到 ' + rows.length + ' 条价格，导入云端？')) return;
    importPrices(rows);
  };
  reader.readAsText(file);
  f.value = '';
});

/* ---------- 启动 ---------- */
if (PWD) renderHome(); else renderGate();

})();
