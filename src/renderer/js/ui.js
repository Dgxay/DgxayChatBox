/** 通用 UI 组件：Toast、菜单、弹窗、快捷键匹配 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function toast(message, type = 'ok', duration = 2600) {
  const layer = $('#toastLayer');
  if (!layer) return;
  const el = document.createElement('div');
  el.className = `toast ${type === 'ok' ? '' : type}`.trim();
  el.innerHTML = `<span class="t-dot"></span><span>${escapeHtml(message)}</span>`;
  layer.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, duration);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板');
    return true;
  } catch {
    toast('复制失败', 'error');
    return false;
  }
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return formatTime(ts);
  const yesterday = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/* ----------------------------- 菜单 ----------------------------- */

let activeMenu = null;

export function closeMenu() {
  if (!activeMenu) return;
  activeMenu.cleanup();
  activeMenu = null;
}

/**
 * @param {HTMLElement} anchor
 * @param {{items: Array, width?: number, align?: 'start'|'end', gap?: number}} options
 */
export function openMenu(anchor, { items = [], width = 260, align = 'start', gap = 6 } = {}) {
  closeMenu();
  const layer = $('#menuLayer');
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.style.width = `${width}px`;
  menu.style.maxWidth = `${Math.max(220, width)}px`;

  const searchable = items.filter((i) => i.type !== 'section' && i.type !== 'sep').length > 9;

  const renderItems = (filter = '') => {
    const q = filter.trim().toLowerCase();
    menu.innerHTML = '';
    if (searchable) {
      const search = document.createElement('div');
      search.className = 'menu-search';
      search.innerHTML = `<input type="text" placeholder="搜索模型…" value="${escapeHtml(filter)}" />`;
      menu.appendChild(search);
      const input = search.querySelector('input');
      input.addEventListener('input', () => {
        renderItems(input.value);
        const next = menu.querySelector('.menu-search input');
        if (next) {
          next.focus();
          next.setSelectionRange(next.value.length, next.value.length);
        }
      });
      setTimeout(() => input.focus({ preventScroll: true }), 0);
    }

    let matched = 0;
    items.forEach((item) => {
      if (item.type === 'section') {
        if (q) return;
        const el = document.createElement('div');
        el.className = 'menu-section';
        el.innerHTML = `${escapeHtml(item.label)}<span class="ms-line"></span>`;
        menu.appendChild(el);
        return;
      }
      if (item.type === 'sep') {
        if (q) return;
        const el = document.createElement('div');
        el.className = 'menu-sep';
        menu.appendChild(el);
        return;
      }
      const label = item.label || '';
      if (q && !`${label} ${item.sub || ''}`.toLowerCase().includes(q)) return;
      matched += 1;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `menu-item${item.active ? ' active' : ''}${item.danger ? ' danger' : ''}`;
      el.innerHTML = `
        ${item.icon ? `<span class="mi-icon">${item.icon}</span>` : ''}
        <span class="mi-label">${escapeHtml(label)}</span>
        ${item.sub ? `<span class="mi-sub">${escapeHtml(item.sub)}</span>` : ''}
        ${item.active ? '<svg class="mi-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>' : ''}
      `;
      el.addEventListener('click', () => {
        if (item.disabled) return;
        closeMenu();
        item.onClick?.();
      });
      menu.appendChild(el);
    });

    if (q && matched === 0) {
      const empty = document.createElement('div');
      empty.className = 'menu-section';
      empty.textContent = '没有匹配项';
      menu.appendChild(empty);
    }
  };

  renderItems('');
  layer.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = align === 'end' ? rect.right - mw : rect.left;
  left = Math.max(8, Math.min(left, vw - mw - 8));

  const spaceBelow = vh - rect.bottom;
  const openUp = spaceBelow < mh + gap + 12 && rect.top > spaceBelow;
  let top = openUp ? rect.top - mh - gap : rect.bottom + gap;
  top = Math.max(8, Math.min(top, vh - mh - 8));

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;

  const onPointerDown = (event) => {
    if (!menu.contains(event.target)) closeMenu();
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeMenu();
    }
  };
  const onResize = () => closeMenu();
  const onScroll = (event) => {
    if (!menu.contains(event.target)) closeMenu();
  };
  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('keydown', onKeydown, true);
  window.addEventListener('resize', onResize);
  document.addEventListener('scroll', onScroll, true);

  activeMenu = {
    cleanup() {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeydown, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('scroll', onScroll, true);
      menu.remove();
    }
  };
  return activeMenu;
}

/* ----------------------------- 弹窗 ----------------------------- */

/**
 * @param {{title:string, desc?:string, body?:string, width?:'wide'|'warn'|'', className?:string,
 *          actions?: Array<{label:string, variant?:string, value?:any, left?:boolean, onClick?:(close)=>any}>,
 *          onMount?:(bodyEl:HTMLElement, close:(v?:any)=>void)=>void, icon?:string}} options
 * @returns {Promise<any>}
 */
export function openModal(options) {
  const {
    title,
    desc = '',
    body = '',
    width = '',
    actions = [{ label: '知道了', variant: 'primary', value: true }],
    onMount,
    icon = '',
    className = ''
  } = options;

  const layer = $('#modalLayer');
  layer.hidden = false;
  layer.innerHTML = '';

  return new Promise((resolve) => {
    let settled = false;
    const close = (value) => {
      if (settled) return;
      settled = true;
      layer.hidden = true;
      layer.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };

    const modal = document.createElement('div');
    modal.className = `modal ${width} ${className}`.trim();
    modal.innerHTML = `
      <div class="modal-head">
        <h3>${icon ? `<span class="warn-icon">${icon}</span>` : ''}${escapeHtml(title)}</h3>
        ${desc ? `<p>${desc}</p>` : ''}
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot"></div>
    `;
    const foot = modal.querySelector('.modal-foot');
    const bodyEl = modal.querySelector('.modal-body');

    actions.forEach((action) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn ${action.variant === 'primary' ? 'btn-primary' : action.variant === 'danger' ? 'btn-danger' : ''}`;
      btn.textContent = action.label;
      if (action.left) foot.insertBefore(btn, foot.firstChild);
      else foot.appendChild(btn);
      btn.addEventListener('click', async () => {
        if (action.onClick) {
          btn.disabled = true;
          try {
            const result = await action.onClick(close);
            if (result === false) {
              btn.disabled = false;
              return;
            }
          } catch (err) {
            btn.disabled = false;
            toast(err.message || '操作失败', 'error');
            return;
          }
        }
        close(action.value ?? true);
      });
    });

    if (actions.some((a) => a.left)) {
      const hint = document.createElement('div');
      hint.className = 'left';
      foot.insertBefore(hint, foot.firstChild);
    }

    layer.appendChild(modal);
    onMount?.(bodyEl, close);

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(null);
      }
    };
    document.addEventListener('keydown', onKey, true);

    setTimeout(() => {
      const focusable = modal.querySelector('input, textarea, select, button.btn-primary');
      focusable?.focus({ preventScroll: true });
    }, 30);
  });
}

export function confirmDialog({ title, message, confirmText = '确认', cancelText = '取消', danger = true }) {
  return openModal({
    title,
    width: 'warn',
    body: `<p style="margin:0;font-size:13px;line-height:1.7;color:var(--text-2)">${message}</p>`,
    actions: [
      { label: cancelText, value: false },
      { label: confirmText, variant: danger ? 'danger' : 'primary', value: true }
    ]
  });
}

/* -------------------------- 快捷键解析 -------------------------- */

const KEY_ALIASES = {
  ' ': 'Space',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  escape: 'Esc',
  ',': ',',
  '.': '.'
};

export function normalizeKey(event) {
  const key = event.key;
  if (!key) return '';
  if (key.length === 1) return key.toUpperCase();
  const lower = key.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (lower === 'control') return 'Ctrl';
  if (lower === 'meta') return 'Meta';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function accelFromEvent(event) {
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.metaKey) parts.push('Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  const key = normalizeKey(event);
  if (!['Ctrl', 'Meta', 'Alt', 'Shift', ''].includes(key)) parts.push(key);
  return parts.join('+');
}

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');

export function matchesAccel(event, accel) {
  if (!accel) return false;
  const parts = accel.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return false;
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  const wantCtrl =
    mods.has('ctrl') || mods.has('cmdorctrl') || mods.has('commandorcontrol') || (IS_MAC && !mods.has('meta'));
  const wantMeta = mods.has('meta') || mods.has('cmd');
  const wantAlt = mods.has('alt');
  const wantShift = mods.has('shift');

  if (Boolean(event.ctrlKey) !== (wantCtrl && !IS_MAC)) return false;
  if (Boolean(event.metaKey) !== (wantMeta || wantCtrl)) return false;
  if (Boolean(event.altKey) !== wantAlt) return false;
  if (Boolean(event.shiftKey) !== wantShift) return false;

  return normalizeKey(event).toLowerCase() === key.toLowerCase();
}

/** 为代码块复制按钮做全局代理 */
export function bindCodeCopy() {
  document.addEventListener('click', (event) => {
    const btn = event.target.closest?.('.code-copy');
    if (!btn) return;
    const encoded = btn.dataset.code || '';
    let text = '';
    try {
      text = decodeURIComponent(encoded);
    } catch {
      text = encoded;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        const old = btn.textContent;
        btn.textContent = '已复制';
        setTimeout(() => {
          btn.textContent = old;
        }, 1400);
      },
      () => toast('复制失败', 'error')
    );
  });
}
