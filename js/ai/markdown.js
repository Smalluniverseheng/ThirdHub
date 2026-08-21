/* ===== ThirdHub js/ai/markdown.js — 轻量 Markdown 渲染（无外部依赖） ===== */
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderMarkdown(src) {
  if (!src) return '';
  let text = String(src);
  const codeBlocks = [];
  // 提取代码块，防内部内容被处理（占位符独占一行，便于后续识别）
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    codeBlocks.push({ lang, code });
    return `\n\u0000CODE${codeBlocks.length - 1}\u0000\n`;
  });
  // 流式容错：末尾未闭合的代码块也按代码块渲染
  const openIdx = text.lastIndexOf('```');
  if (openIdx !== -1) {
    const tail = text.slice(openIdx).match(/^```(\w*)\n?([\s\S]*)$/);
    if (tail) {
      codeBlocks.push({ lang: tail[1], code: tail[2] });
      text = text.slice(0, openIdx) + `\n\u0000CODE${codeBlocks.length - 1}\u0000\n`;
    }
  }
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
  const isTableLine = (l) => /^\s*\|.*\|?\s*$/.test(l) && l.includes('|');
  const isSepLine = (l) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes('-');
  const parseRow = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cb = line.match(/^\u0000CODE(\d+)\u0000$/);
    if (cb) {
      closeList();
      const blk = codeBlocks[+cb[1]];
      if (!blk) continue;
      const { lang, code } = blk;
      const l = (lang || '').toLowerCase();
      const canPreview = ['html', 'xml', 'svg', 'xhtml'].includes(l);
      out.push(`<div class="md-pre"><div class="md-pre-head"><span class="md-lang">${escHtml(lang || 'code')}</span><span class="md-pre-btns">${canPreview ? `<button class="md-preview" data-code="${encodeURIComponent(code)}">预览网页</button>` : ''}<button class="md-copy" data-code="${encodeURIComponent(code)}">复制</button></span></div><pre><code>${escHtml(code.replace(/\n$/, ''))}</code></pre></div>`);
      continue;
    }
    // GFM 表格：表头行 + 分隔行 + 数据行
    if (isTableLine(line) && i + 1 < lines.length && isSepLine(lines[i + 1])) {
      closeList();
      const head = parseRow(line);
      const aligns = parseRow(lines[i + 1]).map((c) => {
        const s = c.replace(/\s/g, '');
        if (s.startsWith(':') && s.endsWith(':')) return 'center';
        if (s.endsWith(':')) return 'right';
        if (s.startsWith(':')) return 'left';
        return '';
      });
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && isTableLine(lines[i])) { rows.push(parseRow(lines[i])); i++; }
      i--;
      const al = (j) => (aligns[j] ? ` style="text-align:${aligns[j]}"` : '');
      let html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>'
        + head.map((c, j) => `<th${al(j)}>${c}</th>`).join('') + '</tr></thead><tbody>';
      rows.forEach((r) => { html += '<tr>' + r.map((c, j) => `<td${al(j)}>${c}</td>`).join('') + '</tr>'; });
      html += '</tbody></table></div>';
      out.push(html);
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
  root.querySelectorAll('.md-preview').forEach((b) => {
    b.onclick = () => {
      document.dispatchEvent(new CustomEvent('th:preview-code', { detail: { code: decodeURIComponent(b.dataset.code) } }));
    };
  });
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
