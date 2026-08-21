
const fs = require('fs');
const path = require('path');
const TOKEN = process.env.GH_TOKEN;
const ROOT = path.resolve('D:/ai/deep seek');
const H = { 'User-Agent': 'node', 'Authorization': 'token ' + TOKEN, 'Accept': 'application/vnd.github+json' };
const BASE = 'https://api.github.com/repos/Smalluniverseheng/ThirdHub';
const SKIP_DIRS = new Set(['node_modules', '.git']);
const SKIP_FILES = /(^|\/)(node_modules|data|package-lock\.json)(\/|$)|.log$|.tmp-/;
async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(method + ' ' + url + ' -> ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
  return j;
}
(async () => {
  const ref = await api('GET', '/git/ref/heads/main');
  const head = ref.object.sha;
  const commit = await api('GET', '/git/commits/' + head);
  const OLD_TREE = commit.tree.sha;
  const files = [];
  (function walk(d, rel) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) { if (!SKIP_DIRS.has(f) && !SKIP_FILES.test(rel + f + '/')) walk(p, rel + f + '/'); }
      else if (!SKIP_FILES.test(rel + f)) files.push({ abs: p, rel: rel + f });
    }
  })(ROOT, '');
  console.log('files:', files.length);
  const shaOf = {};
  const queue = files.slice();
  while (queue.length) {
    const batch = queue.splice(0, 8);
    await Promise.all(batch.map(async (f) => {
      const blob = await api('POST', '/git/blobs', { content: fs.readFileSync(f.abs).toString('base64'), encoding: 'base64' });
      shaOf[f.rel] = blob.sha;
    }));
  }
  const tree = files.map((f) => ({ path: f.rel, mode: '100644', type: 'blob', sha: shaOf[f.rel] }));
  const newTree = await api('POST', '/git/trees', { base_tree: OLD_TREE, tree });
  const msg = 'v5.6 关于页整理 + 多端下载中心 + 模型国内外排序置顶 + 对比分栏 + 算力改名后端（中转设置）';
  const c = await api('POST', '/git/commits', { message: msg, tree: newTree.sha, parents: [head] });
  await api('PATCH', '/git/refs/heads/main', { sha: c.sha, force: false });
  console.log('pushed:', c.sha.slice(0, 10));
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
