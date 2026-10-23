import {
  state,
  initStore,
  on,
  patchConfig,
  currentMode,
  currentPermission,
  currentWorkspace,
  recentWorkspaces,
  workspaceLabel,
  PERMISSIONS,
  providers,
  emit
} from './store.js';
import { $, $$, escapeHtml, toast, openModal, matchesAccel } from './ui.js';
import { icons } from './icons.js';
import * as chat from './chat.js';
import * as settings from './settings.js';
import { initOnboarding } from './onboarding.js';

const MAXIMIZE_ICON = '<svg viewBox="0 0 12 12"><rect x="2.4" y="2.4" width="7.2" height="7.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
const RESTORE_ICON = '<svg viewBox="0 0 12 12"><rect x="2.2" y="4" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.15"/><path d="M4.3 4V2.9c0-.5.4-.9.9-.9h4c.5 0 .9.4.9.9v4c0 .5-.4.9-.9.9H8.2" fill="none" stroke="currentColor" stroke-width="1.15"/></svg>';

async function boot() {
  bindWindowControls();

  let info;
  try {
    info = await window.dcb.init();
  } catch (err) {
    document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif">应用初始化失败：${escapeHtml(err.message)}</div>`;
    return;
  }

  await initStore(info);
  document.body.classList.toggle('platform-darwin', info.platform === 'darwin');

  chat.initChat();
  settings.initSettings();
  bindStaticEvents();
  applyConfigUI();
  window.dcb.onPermissionRequest(handlePermissionRequest);

  if (info.onboarded && info.hasDir) {
    $('#onboard').hidden = true;
    chat.refreshAll();
    document.title = 'DgxayChatBox';
  } else {
    initOnboarding();
  }

  document.body.classList.add('ready');
  setTimeout(() => $('#input')?.focus(), 120);
}

/* ------------------------------ 窗口 ------------------------------ */

function bindWindowControls() {
  $('#winMin').addEventListener('click', () => window.dcb.window.minimize());
  $('#winMax').addEventListener('click', () => window.dcb.window.toggleMaximize());
  $('#winClose').addEventListener('click', () => window.dcb.window.close());

  window.dcb.window.onState(({ maximized }) => {
    const btn = $('#winMax');
    if (!btn) return;
    btn.innerHTML = maximized ? RESTORE_ICON : MAXIMIZE_ICON;
    btn.title = maximized ? '还原' : '最大化';
  });

}

/* ------------------------------ 事件 ------------------------------ */

function bindStaticEvents() {
  $('#btnNewChat').addEventListener('click', () => {
    if (state.settingsOpen) settings.closeSettings();
    chat.startNewChat();
  });
  $('#btnSettings').addEventListener('click', () => settings.openSettings('providers'));
  $('#btnHeaderSettings').addEventListener('click', () => settings.openSettings('providers'));

  $$('#modeSwitch button').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  $('#modeHintBtn').addEventListener('click', () => setMode(currentMode() === 'work' ? 'chat' : 'work'));

  $('#wsAdd').addEventListener('click', () => chat.chooseWorkspace());
  $('#wsList').addEventListener('click', handleWorkspaceClick);
  $('#permList').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-perm]');
    if (btn) setPermission(btn.dataset.perm);
  });
  $('#btnOpenWorkspace').addEventListener('click', async () => {
    const ws = currentWorkspace();
    if (!ws) {
      chat.chooseWorkspace();
      return;
    }
    const result = await window.dcb.openPath(ws);
    if (result) toast('无法打开该文件夹', 'error');
  });

  const keydownHandler = async (event) => {
    if (state.recordingShortcut) return;
    if (event.defaultPrevented) return;
    if (!state.config?.onboarded || !providers().length) return;
    if (document.querySelector('.modal')) return;

    const shortcuts = state.config.shortcuts || {};
    if (matchesAccel(event, shortcuts.newChat)) {
      event.preventDefault();
      chat.startNewChat();
      return;
    }
    if (matchesAccel(event, shortcuts.settings)) {
      event.preventDefault();
      settings.openSettings('providers');
      return;
    }
    if (matchesAccel(event, shortcuts.toggleMode)) {
      event.preventDefault();
      setMode(currentMode() === 'work' ? 'chat' : 'work');
      return;
    }
    if (matchesAccel(event, shortcuts.focusInput)) {
      event.preventDefault();
      chat.focusInput(true);
      return;
    }
    if (event.key === 'Escape' && state.settingsOpen) {
      settings.closeSettings();
    }
  };
  document.addEventListener('keydown', keydownHandler);

  on('config', () => {
    applyConfigUI();
    chat.refreshChrome();
  });
}

function applyConfigUI() {
  const config = state.config;
  if (!config) return;
  document.body.dataset.accent = config.ui?.accent || 'coral';
  document.body.dataset.mode = config.ui?.mode === 'work' ? 'work' : 'chat';
  document.documentElement.style.setProperty('--font-scale', String(config.ui?.fontScale || 1));

  $$('#modeSwitch button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === (config.ui?.mode || 'chat'));
    btn.setAttribute('aria-selected', String(btn.classList.contains('active')));
  });

  const kbd = $('#kbdNewChat');
  if (kbd) kbd.textContent = config.shortcuts?.newChat || '';
  const kbdSet = $('#kbdSettings');
  if (kbdSet) kbdSet.textContent = config.shortcuts?.settings || '';
  const ver = $('#setVersion');
  if (ver && state.info) ver.textContent = 'V1.1';
}

/* ------------------------------ 模式与权限 ------------------------------ */

async function setMode(mode) {
  if (!mode || mode === currentMode()) return;
  if (!state.config?.onboarded) return;
  if (state.settingsOpen) settings.closeSettings();
  if (state.streaming) {
    toast('请先等待当前回复结束，或点击停止', 'warn');
    return;
  }

  if (mode === 'work' && !currentWorkspace()) {
    const picked = await chat.chooseWorkspace();
    if (!picked) {
      toast('工作模式需要先选择一个工作空间', 'warn');
      return;
    }
  }

  await patchConfig({ ui: { ...state.config.ui, mode } });
  const chatData = state.chats.find((c) => c.id === state.activeChatId);
  if (chatData && !chatData.messages.length) chatData.mode = mode;
  applyConfigUI();
  chat.refreshAll();
  if (mode === 'work') toast('已进入工作模式，AI 可以直接处理文件');
}

async function setPermission(permission) {
  if (!PERMISSIONS[permission] || permission === currentPermission()) return;
  if (!state.config?.onboarded) return;

  if (permission === 'full') {
    const confirmed = await confirmFullPermission();
    if (!confirmed) return;
  }

  await patchConfig({ ui: { ...state.config.ui, permission } });
  chat.refreshAll();
  if (permission === 'normal' && !providers().some((provider) => provider.reviewModelId)) {
    toast('普通权限已开启；尚未配置自动审查模型，操作都会询问你', 'warn', 4200);
  } else {
    toast(`权限已切换为${PERMISSIONS[permission].label}`);
  }
}

function confirmFullPermission() {
  return openModal({
    title: '开启完全权限？',
    icon: icons.alert,
    width: 'warn',
    desc: '完全权限下，AI 将不再受工作空间限制，请只在信任的模型与任务中使用。',
    body: `
      <ul class="warn-list">
        <li>执行任意终端命令，包括删除文件、安装软件</li>
        <li>读取与修改磁盘上任意位置的文件</li>
        <li>无限制访问网络，可能把本地数据发送到外部</li>
      </ul>
      <label class="check-row">
        <input type="checkbox" id="fullAck" />
        <span>我已了解上述风险，并确认当前任务值得信任</span>
      </label>
    `,
    actions: [
      { label: '取消', value: false },
      {
        label: '仍然启用',
        variant: 'danger',
        value: true,
        onClick: () => {
          if (!$('#fullAck')?.checked) {
            toast('请先勾选确认，再启用完全权限', 'warn');
            return false;
          }
          return true;
        }
      }
    ]
  });
}

async function handleWorkspaceClick(event) {
  const remove = event.target.closest('.wc-x');
  const chip = event.target.closest('.ws-chip');

  if (remove) {
    event.stopPropagation();
    const path = remove.dataset.path;
    const work = state.config.work || {};
    if (remove.dataset.clear === '1') {
      await patchConfig({
        work: {
          ...work,
          workspace: '',
          recentWorkspaces: (work.recentWorkspaces || []).filter((p) => p !== path)
        }
      });
      chat.refreshAll();
      toast('已取消工作空间');
    } else {
      await patchConfig({
        work: { ...work, recentWorkspaces: (work.recentWorkspaces || []).filter((p) => p !== path) }
      });
      chat.refreshAll();
    }
    return;
  }

  if (!chip) return;
  const path = chip.dataset.path;
  if (path === currentWorkspace()) {
    // 点击当前工作空间直接唤起文件夹选择器，方便更换目录
    await chat.chooseWorkspace();
    return;
  }
  const recents = [path, ...recentWorkspaces().filter((p) => p !== path)].slice(0, 6);
  await patchConfig({ work: { ...state.config.work, workspace: path, recentWorkspaces: recents } });
  chat.refreshAll();
  toast(`工作空间：${workspaceLabel(path)}`);
}

/* ------------------------------ 联网授权 ------------------------------ */

async function handlePermissionRequest(request) {
  const reviewBox = request.review
    ? `<div class="review-box">${icons.alert}<div><b>${escapeHtml(
        request.reviewer || '自动审查'
      )}</b> 未放行这次操作：<br />${escapeHtml(request.review)}</div></div>`
    : `<div class="review-box review-ok">${icons.shield}<div>尚未配置自动审查模型，普通权限下的所有操作都需要你确认。</div></div>`;

  const decision = await openModal({
    title: request.title || 'AI 请求执行操作',
    icon: icons.shield,
    width: 'warn',
    desc: '普通权限拥有全部能力，但每次实际操作都需要审查模型判断或你的授权。',
    body: `
      <pre class="op-detail">${escapeHtml(request.detail || '')}</pre>
      ${reviewBox}
      <p class="form-note">授权只对本次操作生效。发现命令、路径或参数可疑时请拒绝。</p>
    `,
    actions: [
      { label: '拒绝', value: 'deny' },
      { label: '允许一次', value: 'allow', variant: 'primary' }
    ]
  });

  await window.dcb.respondPermission({ id: request.id, decision: decision === 'allow' ? 'allow' : 'deny' });
}

/* ------------------------------ 启动 ------------------------------ */

boot().catch((err) => {
  console.error(err);
  document.body.classList.add('ready');
  toast(err.message || '启动失败', 'error');
});

window.addEventListener('error', (event) => {
  console.error('[renderer]', event.error || event.message);
});
