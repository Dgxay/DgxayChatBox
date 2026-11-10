/**
 * 连续曲率圆角（iOS 式 squircle）。
 *
 * 圆弧圆角在转角处的曲率是突变的，放大半径后能明显看出「方 + 圆」的接缝；
 * 这里用超椭圆路径（|x/a|^n + |y/b|^n = 1，n≈4.4）裁切元素，
 * 让转角从直边开始平滑过渡，视觉上更接近 iPhone 的屏幕圆角。
 *
 * - 原生支持 corner-shape: squircle 的浏览器直接交给 CSS，不再做裁切；
 * - 只处理「有背景色的大圆角容器」，可聚焦控件保留原生 outline，避免焦点环被裁掉；
 * - 尺寸变化时重算路径（ResizeObserver），动态插入的节点由 MutationObserver 接管。
 */

const TARGETS = [
  '.composer',
  '.bubble',
  '.card',
  '.mcp-card',
  '.oauth-card',
  '.term-card',
  '.code-block',
  '.menu',
  '.slash-menu',
  '.modal',
  '.toast',
  '.ob-inner',
  '.work-bar',
  '.reasoning-body',
  '.mcp-log',
  '.msg-avatar',
  '.ec-icon',
  '.oauth-mark',
  '.ctx-bar',
  '.switch'
].join(',');

const FOCUSABLE = 'button, input, select, textarea, a, summary, [tabindex], [contenteditable]';
const MIN_RADIUS = 7;
const EXPONENT = 4.4;

let enabled = true;
let resizeObserver = null;
let mutationObserver = null;
const scheduled = new Set();
let frame = 0;

function nativeSquircle() {
  try {
    return typeof CSS !== 'undefined' && CSS.supports?.('corner-shape', 'squircle');
  } catch {
    return false;
  }
}

/** 读取元素实际使用的圆角半径（px）；百分比圆角（正圆）返回 0，交给原生绘制。 */
function radiusOf(el) {
  const style = getComputedStyle(el);
  const raw = style.borderTopLeftRadius || '0px';
  if (raw.includes('%')) return 0;
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

/**
 * 生成超椭圆圆角矩形的 path()。
 * @param {number} w 宽
 * @param {number} h 高
 * @param {number} radius 圆角半径
 */
function squirclePath(w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (!(w > 0 && h > 0)) return '';
  if (r < 0.5) return `path("M0 0H${round(w)}V${round(h)}H0Z")`;

  const power = 2 / EXPONENT;
  const steps = Math.max(4, Math.min(12, Math.round(r / 1.8) + 3));
  const points = [];

  const corner = (fn) => {
    for (let i = 1; i <= steps; i += 1) {
      const angle = (i / steps) * (Math.PI / 2);
      const [x, y] = fn(angle);
      points.push([x, y]);
    }
  };

  points.push([r, 0]);
  points.push([w - r, 0]);
  // 右上
  corner((a) => [w - r + r * Math.sin(a) ** power, r - r * Math.cos(a) ** power]);
  points.push([w, h - r]);
  // 右下
  corner((a) => [w - r + r * Math.cos(a) ** power, h - r + r * Math.sin(a) ** power]);
  points.push([r, h]);
  // 左下
  corner((a) => [r - r * Math.sin(a) ** power, h - r + r * Math.cos(a) ** power]);
  points.push([0, r]);
  // 左上
  corner((a) => [r - r * Math.cos(a) ** power, r - r * Math.sin(a) ** power]);

  const body = points.map(([x, y]) => `${round(x)} ${round(y)}`).join('L');
  return `path("M${body}Z")`;
}

function apply(el) {
  if (!enabled || !el.isConnected) return;
  if (el.matches(FOCUSABLE)) return;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  if (!width || !height) return;
  const radius = radiusOf(el);
  if (radius < MIN_RADIUS) {
    el.style.removeProperty('clip-path');
    return;
  }
  const path = squirclePath(width, height, radius);
  if (path) el.style.setProperty('clip-path', path);
}

function flush() {
  frame = 0;
  const batch = [...scheduled];
  scheduled.clear();
  for (const el of batch) apply(el);
}

function schedule(el) {
  if (!enabled || !el || el.nodeType !== 1) return;
  scheduled.add(el);
  if (!frame) frame = requestAnimationFrame(flush);
}

function register(el) {
  resizeObserver?.observe(el);
  schedule(el);
}

function collect(root) {
  if (!root || root.nodeType !== 1 || !enabled) return;
  if (root.matches?.(TARGETS)) register(root);
  root.querySelectorAll?.(TARGETS).forEach(register);
}

export function initSquircle() {
  if (nativeSquircle()) {
    enabled = false;
    return;
  }
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) schedule(entry.target);
  });
  mutationObserver = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => collect(node));
    }
  });

  collect(document.body);
  mutationObserver.observe(document.body, { childList: true, subtree: true });
}

/** 整块 DOM 重建后调用，补扫一次 */
export function refreshSquircle(root = document.body) {
  if (!enabled) return;
  collect(root);
}
