/* ===== ThirdHub js/ai/markdown.js — 轻量 Markdown 渲染（无外部依赖） ===== */
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderMarkdown(src) {
  if (!src) return '';
  let text = String(src);
  const codeBlocks = [];
  // 提取代码块，防内部内容被处理
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    codeBlocks.push({ lang, code });
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });
  text = escHtml(text);
  // 行内代码
  text = text.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');
  // 粗体 / 斜体 / 删除线
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // 链接
  text = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const lines = text.split('\n');
  const out = [];
  let inList = null;
  const closeList = () => { if (inList) { out.push(inList === 'ul' ? '</ul>' : '</ol>'); inList = null; } };

  for (let line of lines) {
    const cb = line.match(/^\u0000CODE(\d+)\u0000$/);
    if (cb) {
      closeList();
      const { lang, code } = codeBlocks[+cb[1]];
      out.push(`<div class="md-pre"><div class="md-pre-head"><span>${escHtml(lang || 'code')}</span><button class="md-copy" data-code="${encodeURIComponent(code)}">复制</button></div><pre><code>${escHtml(code.replace(/\n$/, ''))}</code></pre></div>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); const lv = h[1].length; out.push(`<div class="md-h md-h${lv}">${h[2]}</div>`); continue; }
    if (/^\s*>\s?/.test(line)) { closeList(); out.push(`<div class="md-quote">${line.replace(/^\s*>\s?/, '')}</div>`); continue; }
    if (/^\s*(-|\*)\s+/.test(line)) {
      if (inList !== 'ul') { closeList(); out.push('<ul class="md-ul">'); inList = 'ul'; }
      out.push('<li>' + line.replace(/^\s*(-|\*)\s+/, '') + '</li>'); continue;
    }
    if (/^\s*\d+[.、]\s+/.test(line)) {
      if (inList !== 'ol') { closeList(); out.push('<ol class="md-ol">'); inList = 'ol'; }
      out.push('<li>' + line.replace(/^\s*\d+[.、]\s+/, '') + '</li>'); continue;
    }
    if (/^\s*---\s*$/.test(line)) { closeList(); out.push('<hr class="md-hr">'); continue; }
    closeList();
    if (line.trim()) out.push('<p class="md-p">' + line + '</p>');
  }
  closeList();
  return out.join('');
}

export function bindCopyButtons(root) {
  root.querySelectorAll('.md-copy').forEach((b) => {
    b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(decodeURIComponent(b.dataset.code));
        b.textContent = '已复制';
        setTimeout(() => (b.textContent = '复制'), 1500);
      } catch (e) {}
    };
  });
}
