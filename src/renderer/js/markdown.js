/** 轻量 Markdown 渲染器：标题 / 列表 / 表格 / 代码块 / 引用 / 行内样式 */

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineFormat(text) {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line || '');
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * @param {string} source
 * @returns {string} safe HTML
 */
export function renderMarkdown(source) {
  if (!source) return '';
  const codeBlocks = [];
  let text = String(source).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  text = text.replace(/```([\w#+.\-/]*)[ \t]*\n?([\s\S]*?)(?:\n?```|$)/g, (_m, lang, code) => {
    codeBlocks.push({ lang: (lang || 'code').toLowerCase(), code: code.replace(/\n$/, '') });
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });

  text = escapeHtml(text);

  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (_m, code) => {
    inlineCodes.push(code);
    return `\u0000IC${inlineCodes.length - 1}\u0000`;
  });

  const lines = text.split('\n');
  const out = [];
  let i = 0;

  const flushParagraph = (buf) => {
    if (!buf.length) return;
    const html = buf.map((line) => inlineFormat(line)).join('<br>');
    out.push(`<p>${html}</p>`);
  };

  let paragraph = [];

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      flushParagraph(paragraph);
      paragraph = [];
      i += 1;
      continue;
    }

    if (/^\u0000CODE\d+\u0000$/.test(line.trim())) {
      flushParagraph(paragraph);
      paragraph = [];
      out.push(line.trim());
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph(paragraph);
      paragraph = [];
      const level = Math.min(heading[1].length, 4);
      out.push(`<h${level}>${inlineFormat(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph(paragraph);
      paragraph = [];
      out.push('<hr>');
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph(paragraph);
      paragraph = [];
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(inlineFormat(lines[i].replace(/^\s*>\s?/, '')));
        i += 1;
      }
      out.push(`<blockquote>${quote.join('<br>')}</blockquote>`);
      continue;
    }

    if (line.includes('|') && isTableSeparator(lines[i + 1])) {
      flushParagraph(paragraph);
      paragraph = [];
      const header = splitTableRow(line);
      const aligns = splitTableRow(lines[i + 1]).map((cell) => {
        if (/^:.*:$/.test(cell)) return 'center';
        if (/^:/.test(cell)) return 'left';
        if (/:$/.test(cell)) return 'right';
        return '';
      });
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      const th = header
        .map((cell, idx) => `<th${aligns[idx] ? ` style="text-align:${aligns[idx]}"` : ''}>${inlineFormat(cell)}</th>`)
        .join('');
      const body = rows
        .map(
          (row) =>
            `<tr>${header
              .map(
                (_h, idx) =>
                  `<td${aligns[idx] ? ` style="text-align:${aligns[idx]}"` : ''}>${inlineFormat(row[idx] || '')}</td>`
              )
              .join('')}</tr>`
        )
        .join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }

    const isBullet = /^(\s*)[-*+]\s+/.test(line);
    const isOrdered = /^(\s*)\d+[.)]\s+/.test(line);
    if (isBullet || isOrdered) {
      flushParagraph(paragraph);
      paragraph = [];
      const items = [];
      const baseIndent = line.match(/^(\s*)/)[1].length;
      while (i < lines.length) {
        const current = lines[i];
        if (!current.trim()) break;
        const m = current.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m) {
          items.push({
            indent: m[1].length,
            ordered: /\d/.test(m[2]),
            html: inlineFormat(m[3])
          });
          i += 1;
          continue;
        }
        if (/^\s{2,}\S/.test(current) && items.length) {
          items[items.length - 1].html += `<br>${inlineFormat(current.trim())}`;
          i += 1;
          continue;
        }
        break;
      }
      if (!items.length) {
        paragraph.push(line);
        i += 1;
        continue;
      }
      const rootIndent = Math.min(baseIndent, ...items.map((item) => item.indent));
      out.push(renderList(items, 0, rootIndent).html);
      continue;
    }

    paragraph.push(line);
    i += 1;
  }

  flushParagraph(paragraph);

  let html = out.join('\n');

  html = html.replace(/\u0000IC(\d+)\u0000/g, (_m, idx) => `<code>${inlineCodes[Number(idx)] ?? ''}</code>`);
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_m, idx) => {
    const block = codeBlocks[Number(idx)];
    if (!block) return '';
    const encoded = encodeURIComponent(block.code);
    return `<div class="code-block"><div class="code-head"><span>${escapeHtml(block.lang)}</span><button class="code-copy" type="button" data-code="${encoded}">复制</button></div><pre><code>${escapeHtml(block.code)}</code></pre></div>`;
  });

  return html;
}

function renderList(items, start, indent) {
  const ordered = items[start].ordered;
  const tag = ordered ? 'ol' : 'ul';
  let html = `<${tag}>`;
  let i = start;
  while (i < items.length) {
    const item = items[i];
    if (item.indent !== indent) break;
    let inner = item.html;
    i += 1;
    if (i < items.length && items[i].indent > indent) {
      const nested = renderList(items, i, items[i].indent);
      inner += nested.html;
      i = nested.next;
    }
    html += `<li>${inner}</li>`;
  }
  html += `</${tag}>`;
  return { html, next: i };
}
