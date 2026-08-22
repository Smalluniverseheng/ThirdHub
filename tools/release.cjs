/* ===== ThirdHub tools/release.cjs — 发布流水线（v8.8 起每版必跑） =====
   用法：node tools/release.cjs <版本号> <更新说明;分号分隔多条>
   步骤：1 版本槽位 bump → 2 全量 ESM 语法检查 → 3 staging+Cloudflare 部署
         4 无头浏览器回归 → 5 GitHub 推送；任何一步失败立即中止 */
const fs = require('fs');
const { spawnSync } = require('child_process');
const ROOT = 'D:/ai/deep seek';
const VERSION = process.argv[2];
const NOTE = process.argv.slice(3).join(' ') || '更新';
if (!VERSION || !/^\d+\.\d+$/.test(VERSION)) { console.error('用法: node tools/release.cjs <版本号> <说明>'); process.exit(1); }
const fail = (msg) => { console.error('\n❌ 发布中止: ' + msg); process.exit(1); };
const sh = (cmd, label, timeout = 300000) => { const r = spawnSync(cmd, { shell: true, cwd: ROOT, encoding: 'utf8', timeout }); if (r.status !== 0) fail(label + ' 退出码 ' + r.status + '\n' + String(r.stderr || r.stdout || '').slice(-500)); return r.stdout || ''; };
(async () => {
  const date = new Date().toISOString().slice(0, 10);
  console.log('=== [1. 版本槽位 bump ' + VERSION + '] ===');
  const bumps = [
    ['js/app.js', /export const APP_VERSION = '[^']+'/, "export const APP_VERSION = '" + VERSION + "';"],
    ['sw.js', /const VERSION = '[^']+'/, "const VERSION = '" + VERSION + "';"],
    ['_worker.js', /const APP_LATEST = '[^']+'/, "const APP_LATEST = '" + VERSION + "';"],
    ['version.json', /"version": "[^"]+"/, '"version": "' + VERSION + '"'],
    ['version.json', /"title": "ThirdHub v[^"]+"/, '"title": "ThirdHub v' + VERSION + '"'],
    ['version.json', /"releaseDate": "[^"]+"/, '"releaseDate": "' + date + '"'],
  ];
  for (const [f, re, rep] of bumps) {
    const p = ROOT + '/' + f;
    let t = fs.readFileSync(p, 'utf8');
    if (!re.test(t)) fail(f + ' 未找到版本槽位');
    fs.writeFileSync(p, t.replace(re, rep));
  }
  let html = fs.readFileSync(ROOT + '/index.html', 'utf8');
  const prevV = (html.match(/\?v=([\d.]+)/) || [])[1];
  if (prevV) fs.writeFileSync(ROOT + '/index.html', html.split('?v=' + prevV).join('?v=' + VERSION));
  let cl = fs.readFileSync(ROOT + '/js/changelog.js', 'utf8');
  const items = NOTE.split(';').map((s) => s.trim()).filter(Boolean).map((s) => '      "' + s + '",').join('\n');
  const head = 'export const CHANGELOG = [\n  {\n    version: "' + VERSION + '",\n    date: "' + date + '",\n    items: [\n' + items + '\n    ],\n  },';
  cl = cl.replace('export const CHANGELOG = [', head);
  fs.writeFileSync(ROOT + '/js/changelog.js', cl);
  let vj = fs.readFileSync(ROOT + '/version.json', 'utf8');
  const firstNote = (NOTE.split(';')[0] || '更新').trim();
  vj = vj.replace(/"content": "[^"]*"/, '"content": "' + firstNote + '。"');
  vj = vj.replace(/"releaseNotes": "[^"]*"/, '"releaseNotes": "' + firstNote.slice(0, 20) + '"');
  fs.writeFileSync(ROOT + '/version.json', vj);
  console.log('  ✓ 槽位已更新 ' + VERSION);
  console.log('=== [2. 全量 ESM 语法检查] ===');
  const jsFiles = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (['node_modules', '.git', 'thirdhub-agent', 'backend', 'supabase', 'data'].includes(e.name) || e.name.endsWith('-staging')) continue; const p = dir + '/' + e.name; if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) jsFiles.push(p.replace(ROOT + '/', '')); } };
  walk(ROOT);
  let bad = 0;
  for (const f of jsFiles) {
    fs.writeFileSync(ROOT + '/.rel-check.mjs', fs.readFileSync(ROOT + '/' + f, 'utf8'));
    const r = spawnSync('node', ['--check', ROOT + '/.rel-check.mjs'], { encoding: 'utf8' });
    if (r.status !== 0) { bad++; console.log('  ❌ ' + f + ': ' + String(r.stderr).split('\n')[1]); }
  }
  if (bad) fail(bad + ' 个文件语法错误');
  console.log('  ✓ ' + jsFiles.length + ' 个 JS 全部通过');
  console.log('=== [3. 部署到 Cloudflare] ===');
  if (fs.existsSync(ROOT + '-staging')) fs.rmSync(ROOT + '-staging', { recursive: true, force: true });
  const rb = spawnSync('robocopy "' + ROOT + '" "' + ROOT + '-staging" /E /XD node_modules .git thirdhub-agent backend supabase data /XF *.cjs *.tgz .deploy-list.txt cloudflared.exe npm.tgz *.log /NFL /NDL /NJH /NJS /NP', { shell: true, cwd: ROOT, encoding: 'utf8' });
  if (rb.status > 7) fail('robocopy 退出码 ' + rb.status); /* robocopy 1-7 均为成功 */
  const wr = spawnSync('node', [ROOT + '/node_modules/wrangler/bin/wrangler.js', 'pages', 'deploy', ROOT + '-staging', '--project-name', 'thirdhub', '--branch', 'main'], { cwd: ROOT, encoding: 'utf8', timeout: 600000, env: Object.assign({}, process.env, { CLOUDFLARE_API_TOKEN: process.env.CF_TOKEN || '', CLOUDFLARE_ACCOUNT_ID: '43a379d1850a953981f2835a9d5ed683' }) });
  if (wr.status !== 0) fail('wrangler 退出码 ' + wr.status + '\n' + String(wr.stderr || wr.stdout || '').slice(-500));
  console.log('  ✓ 已部署');
  console.log('=== [4. 无头回归] ===');
  const reg = spawnSync('node', [ROOT + '/tools/regression.cjs'], { encoding: 'utf8', timeout: 180000 });
  if (reg.status !== 0) fail('回归失败\n' + String(reg.stdout || reg.stderr || '').slice(-800));
  console.log('  ✓ 回归通过');
  console.log('=== [5. GitHub 推送] ===');
  const gp = spawnSync('node', [ROOT + '/tools/gh-push.cjs', VERSION, NOTE], { cwd: ROOT, encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { GH_TOKEN: process.env.GH_TOKEN || '' }) });
  if (gp.status !== 0) fail('gh-push 退出码 ' + gp.status + '\n' + String(gp.stderr || gp.stdout || '').slice(-500));
  console.log('\n✅ 发布完成 v' + VERSION + ' · 全部检查通过');
})().catch((e) => { console.error(e); process.exit(1); });