/**
 * 流式文字的「晕染」动效。
 *
 * 模型逐字返回时，不在每一帧重排整段 HTML，而是按 Markdown 顶层块做增量更新：
 * 只为「这一帧新增的字符」包一层 <span class="fx-ch">，
 * 由 CSS 让每个字从高斯模糊里浮出来。相邻字符的动画互相重叠，
 * 前一个字还没完全清晰，后一个字已经有轮廓，连起来就是一道温润的波浪。
 */

import { renderMarkdown } from './markdown.js';

const MAX_BLUR_CHARS = 240;
const MAX_STAGGER = 18;
const TEXT_BLOCKS = /^(P|H1|H2|H3|H4|LI|TD|TH|BLOCKQUOTE)$/;
const stores = new WeakMap();

function readBlocks(mdEl) {
  return [...mdEl.children]
    .filter((el) => !el.classList.contains('stream-cursor'))
    .map((el) => ({ node: el, text: el.textContent }));
}

function ensureCursor(mdEl, store) {
  let cursor = store.cursor;
  if (!cursor || !cursor.isConnected) {
    cursor = document.createElement('span');
    cursor.className = 'stream-cursor';
    store.cursor = cursor;
  }
  // 光标跟着最后一段文字走，而不是单独占一行
  const last = store.blocks[store.blocks.length - 1];
  if (last && TEXT_BLOCKS.test(last.node.tagName)) {
    last.node.appendChild(cursor);
  } else {
    mdEl.appendChild(cursor);
  }
}

function attachCleanup(mdEl, store) {
  if (store.cleanup) return;
  store.cleanup = true;
  mdEl.addEventListener('animationend', (event) => {
    const span = event.target instanceof Element ? event.target.closest('.fx-ch') : null;
    if (!span || !span.isConnected) return;
    span.replaceWith(document.createTextNode(span.textContent || ''));
  });
}

/** 把 root 内 from 之后的文字拆成逐个字符的 span，触发模糊入场动画 */
function wrapTail(root, from, cap = MAX_BLUR_CHARS) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let total = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.nodeValue) continue;
    nodes.push({ node, start: total });
    total += node.nodeValue.length;
  }
  if (!total) return;
  const startAt = Math.max(from, total - cap);
  if (startAt >= total) return;

  let step = 0;
  for (const { node, start } of nodes) {
    const end = start + node.nodeValue.length;
    if (end <= startAt) continue;
    const local = Math.max(0, startAt - start);
    if (local > 0) node.splitText(local);
    const tail = local > 0 ? node.nextSibling : node;
    if (!tail || !tail.nodeValue) continue;
    const chars = [...tail.nodeValue];
    const fragment = document.createDocumentFragment();
    for (const char of chars) {
      if (!char.trim()) {
        fragment.appendChild(document.createTextNode(char));
        continue;
      }
      const span = document.createElement('span');
      span.className = 'fx-ch';
      span.style.setProperty('--fx-i', String(Math.min(MAX_STAGGER, step)));
      span.textContent = char;
      fragment.appendChild(span);
      step += 1;
    }
    tail.parentNode?.replaceChild(fragment, tail);
  }
}

function animateDiff(prevNode, nextNode, prevText) {
  const nextText = nextNode.textContent || '';
  let common = 0;
  const limit = Math.min(prevText.length, nextText.length);
  while (common < limit && prevText[common] === nextText[common]) common += 1;
  wrapTail(nextNode, common);
}

function replaceFrom(mdEl, store, from, nodes) {
  const old = store.blocks;
  const inserted = nodes.slice(from);
  for (let i = from; i < old.length; i += 1) old[i].node.remove();
  for (const node of inserted) mdEl.appendChild(node);
  store.blocks = old
    .slice(0, from)
    .concat(inserted.map((node) => ({ node, text: node.textContent })));
  return inserted;
}

export function paintStream(mdEl, content) {
  if (!mdEl) return;
  let store = stores.get(mdEl);
  if (!store) {
    store = {
      blocks: readBlocks(mdEl),
      cursor: mdEl.querySelector(':scope > .stream-cursor'),
      cleanup: false
    };
    stores.set(mdEl, store);
    attachCleanup(mdEl, store);
  }

  const holder = document.createElement('div');
  holder.innerHTML = renderMarkdown(content || '');
  const nodes = [...holder.children];
  const old = store.blocks;

  let diff = -1;
  const total = Math.max(old.length, nodes.length);
  for (let i = 0; i < total; i += 1) {
    const prev = old[i];
    const next = nodes[i];
    if (!prev || !next || prev.text !== next.textContent) {
      diff = i;
      break;
    }
  }

  if (diff !== -1) {
    if (diff === old.length && nodes.length > old.length) {
      // 前一段已完结，只在尾部追加新块
      const inserted = nodes.slice(diff);
      for (const node of inserted) mdEl.appendChild(node);
      store.blocks = old.concat(inserted.map((node) => ({ node, text: node.textContent })));
      wrapTail(inserted[inserted.length - 1], 0, 160);
    } else if (diff === nodes.length - 1 && diff === old.length - 1) {
      // 最常见的情况：只有最后一块在长
      const prev = old[diff];
      const next = nodes[diff];
      animateDiff(prev.node, next, prev.text);
      prev.node.replaceWith(next);
      store.blocks[diff] = { node: next, text: next.textContent };
    } else {
      const inserted = replaceFrom(mdEl, store, diff, nodes);
      if (inserted.length) wrapTail(inserted[inserted.length - 1], 0, 200);
    }
  }

  ensureCursor(mdEl, store);
}

/** 流式结束后调用：把残留的动画 span 还原成纯文本 */
export function settleStream(mdEl) {
  const store = mdEl ? stores.get(mdEl) : null;
  if (store) {
    store.blocks = store.blocks.map(({ node }) => ({ node, text: node.textContent }));
  }
  if (!mdEl) return;
  mdEl.querySelectorAll('.fx-ch').forEach((span) => {
    span.replaceWith(document.createTextNode(span.textContent || ''));
  });
}
