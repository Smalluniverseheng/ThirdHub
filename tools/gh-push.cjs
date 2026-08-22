/* tools/gh-push.cjs — 推送全部改动文件到 GitHub main（供 release.cjs 调用） */
const fs = require('fs');
const TOKEN = process.env.GH_TOKEN;
const API = 'https://api.github.com/repos/Smalluniverseheng/ThirdHub';
async function gh(path, opts = {}) { const r = await fetch(API + path, Object.assign({ headers: { Authorization: 'Bearer ' + TOKEN, 'User-Agent': 'dsh', Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' } }, opts)); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 120)); return j; }
(async () => {
  const files = ['js/app.js', 'sw.js', '_worker.js', 'js/changelog.js', 'version.json', 'index.html', 'js/modules/ai-chat.js', 'js/modules/compute.js', 'js/modules/dsh-console.js', 'js/modules/community.js', 'js/modules/profile.js', 'js/modules/board-media.js', 'js/modules/category.js', 'js/modules/onboarding.js', 'js/modules/keyvault.js', 'js/ai/model-selector.js', 'js/ai/ai-api.js', 'js/ai/ai-models.js', 'js/modules/ai-settings.js', 'js/modules/board-cloudphone.js', 'js/boards.js', 'js/supabase.js', 'js/modules/devices.js', 'js/modules/recycle-bin.js', 'js/modules/feedback.js', 'js/modules/devlog.js', 'js/modules/applock.js', 'js/modules/storage.js', 'js/modules/vip.js', 'js/modules/pay.js', 'tools/release.cjs', 'tools/gh-push.cjs', 'tools/regression.cjs'];
  const head = (await gh('/git/ref/heads/main')).object.sha;
  const hc = await gh('/git/commits/' + head);
  const tree = [];
  for (const f of files) { const p = 'D:/ai/deep seek/' + f; if (!fs.existsSync(p)) continue; const content = fs.readFileSync(p, 'utf8'); const b = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content, encoding: 'utf-8' }) }); tree.push({ path: f, mode: '100644', type: 'blob', sha: b.sha }); }
  const nt = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: hc.tree.sha, tree }) });
  const c = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message: 'v' + (process.argv[2] || 'x') + ': ' + (process.argv.slice(3).join(' ') || 'release'), tree: nt.sha, parents: [head] }) });
  await gh('/git/refs/heads/main', { method: 'PATCH', body: JSON.stringify({ sha: c.sha, force: false }) });
  console.log('PUSHED', c.sha);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });