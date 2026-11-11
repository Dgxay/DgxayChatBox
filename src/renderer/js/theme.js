/**
 * 主题：浅色 / 深色 / 跟随系统。
 * 主题只切换 <html data-theme>，所有颜色、字重、阴影都由 CSS token 派生。
 */

export const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
];

let preference = 'system';
let systemDark = false;
let mediaQuery = null;

function resolve() {
  if (preference === 'light' || preference === 'dark') return preference;
  if (mediaQuery) return mediaQuery.matches ? 'dark' : 'light';
  return systemDark ? 'dark' : 'light';
}

function paint() {
  const theme = resolve();
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.body.dataset.theme = theme;
}

export function initTheme(info) {
  systemDark = Boolean(info?.darkMode);
  if (typeof window !== 'undefined' && window.matchMedia) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener?.('change', () => {
      if (preference === 'system') paint();
    });
  }
  window.dcb?.onSystemTheme?.((payload) => {
    if (typeof payload?.dark !== 'boolean') return;
    systemDark = payload.dark;
    if (preference === 'system') paint();
  });
  paint();
}

export function applyTheme(value) {
  preference = THEME_OPTIONS.some((item) => item.value === value) ? value : 'dark';
  paint();
  return resolve();
}

export function themePreference() {
  return preference;
}

export function currentTheme() {
  return resolve();
}
