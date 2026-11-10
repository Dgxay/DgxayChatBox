/**
 * 排版保护：避免一句话换行后最后一行只剩一个字（孤字 / 孤行）。
 *
 * 做法：把正文末尾的两个字包进 nowrap 的 <span>。换行点只能落在更靠前的位置，
 * 于是原本会落单到下一行的那个字，会被前面的字一起带下去，最后一行至少两个字。
 * 若浏览器原生 text-wrap: pretty 已经把孤字处理掉了，这里的包裹不会产生任何视觉变化。
 */

const TARGETS = '.md p, .md li, .md blockquote, .bubble, .reasoning-body, .sr-desc, .hero > p';

const MIN_LENGTH = 16;
let queued = false;

function lastTextNode(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('pre, code, .fx-ch, .nw')) return NodeFilter.FILTER_REJECT;
      return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  let last = null;
  while (walker.nextNode()) last = walker.currentNode;
  return last;
}

function guard(el) {
  if (el.dataset.widow === '1') return;
  if (el.closest('pre, code, table')) return;
  const full = (el.textContent || '').trim();
  if (full.length < MIN_LENGTH) return;
  const node = lastTextNode(el);
  if (!node) return;
  const text = node.nodeValue;
  const body = text.replace(/\s+$/, '');
  if (body.length < 2) return;
  if (body.slice(-1) === '，' || body.slice(-1) === '、') {
    // 以逗号结尾时把标点一起带下去没有意义
    return;
  }
  el.dataset.widow = '1';
  const cut = body.length - 2;
  const tail = node.splitText(cut);
  if (tail.nodeValue.length > 2) tail.splitText(2);
  const span = document.createElement('span');
  span.className = 'nw';
  tail.parentNode.insertBefore(span, tail);
  span.appendChild(tail);
}

export function applyWidowGuard(root = document) {
  const scope = root instanceof Element ? root : document;
  scope.querySelectorAll(TARGETS).forEach((el) => {
    if (el.dataset.widow === '1') return;
    try {
      guard(el);
    } catch {
      /* 忽略单个节点的排版失败 */
    }
  });
}

/** 窗口尺寸变化后重新处理：旧标记需要清掉，否则换行点不会重算 */
export function scheduleWidowGuard(delay = 160) {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    document.querySelectorAll(TARGETS).forEach((el) => {
      if (el.dataset.widow !== '1') return;
      const span = el.querySelector('.nw');
      if (span) {
        span.replaceWith(...span.childNodes);
        el.normalize();
      }
      delete el.dataset.widow;
    });
    applyWidowGuard(document);
  }, delay);
}
