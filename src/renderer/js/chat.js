import {
  state,
  getChat,
  ensureChat,
  createNewChat,
  switchChat,
  deleteChat,
  scheduleChatSave,
  persistChatsNow,
  patchConfig,
  titleFrom,
  activeProvider,
  activeModel,
  modelLabel,
  currentMode,
  currentPermission,
  currentWorkspace,
  recentWorkspaces,
  workspaceLabel,
  PERMISSIONS,
  providers,
  setActiveModel,
  emit,
  on
} from './store.js';
import {
  $,
  escapeHtml,
  toast,
  openMenu,
  formatTime,
  formatRelative,
  confirmDialog,
  copyText
} from './ui.js';
import { renderMarkdown } from './markdown.js';
import { icons, toolIcons, toolLabels } from './icons.js';

let messagesEl;
let inputEl;
let sendBtn;
let modelBtn;
let ctxRing;
let ctxRingProgress;
let skillChip;
let slashMenu;
let autoResizing = false;
let paintQueued = false;
let streamingMsg = null;
let terminalBusy = false;
let slashEntries = [];
let slashIndex = 0;
let slashMode = 'commands';
let skillsCache = [];
let skillsLoaded = false;

const ASSISTANT_AVATAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 6.9A2.9 2.9 0 0 1 7.1 4h9.8a2.9 2.9 0 0 1 2.9 2.9v6.2a2.9 2.9 0 0 1-2.9 2.9H9.7L5.2 19.4V6.9Z" fill="#fff"/></svg>`;

const SUGGESTIONS = {
  chat: [
    { kind: 'coral', icon: icons.book, title: '写一段产品介绍', desc: '为一款新应用打磨文案', prompt: '帮我写一段有感染力的产品介绍，产品是：' },
    { kind: 'sky', icon: icons.code, title: '解释一段代码', desc: '看懂逻辑与潜在问题', prompt: '请逐段解释下面这段代码，并指出潜在问题：\n\n```\n\n```' },
    { kind: 'mint', icon: icons.calendar, title: '规划周末行程', desc: '两天的轻松路线', prompt: '帮我规划一个周末两天的行程，城市是：，偏好：' },
    { kind: 'amber', icon: icons.pencil, title: '润色这封邮件', desc: '更专业、更得体', prompt: '请帮我润色下面这封邮件，保持原意，语气专业友好：\n\n' }
  ],
  work: [
    { kind: 'coral', icon: icons.folder, title: '整理这个文件夹', desc: '归类、重命名，生成索引', prompt: '帮我整理当前工作空间：先浏览目录结构，再给出整理方案，最后按方案重命名或归类文件，并生成一份索引。' },
    { kind: 'amber', icon: icons.book, title: '生成一份周报', desc: '读取记录并汇总输出', prompt: '请阅读工作空间里的工作记录，汇总生成一份本周周报，保存为 markdown 文件。' },
    { kind: 'sky', icon: icons.code, title: '分析代码结构', desc: '输出模块说明文档', prompt: '分析当前工作空间的代码结构，说明主要模块的职责与依赖关系，并生成一份 ARCHITECTURE.md。' },
    { kind: 'mint', icon: icons.terminal, title: '批量处理文件', desc: '写个脚本并执行', prompt: '先列出工作空间里的文件，然后写一个脚本完成批量处理（具体需求：），保存脚本并执行。' }
  ]
};

/* ------------------------------ 初始化 ------------------------------ */

export function initChat() {
  messagesEl = $('#messages');
  inputEl = $('#input');
  sendBtn = $('#sendBtn');
  modelBtn = $('#modelBtn');
  ctxRing = $('#ctxRing');
  ctxRingProgress = $('#ctxRingProgress');
  skillChip = $('#skillChip');
  slashMenu = $('#slashMenu');

  inputEl.addEventListener('input', () => {
    autosize();
    updateSendButton();
    updateComposerHint();
    updateSlashMenu();
  });
  inputEl.addEventListener('keydown', (event) => {
    if (handleSlashKey(event)) return;
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    const enterSends = state.config?.chat?.enterToSend !== false;
    const shouldSend = enterSends ? !event.shiftKey && !event.ctrlKey && !event.metaKey : event.ctrlKey || event.metaKey;
    if (shouldSend) {
      event.preventDefault();
      sendMessage();
    }
  });

  ctxRing?.addEventListener('click', showContextDetails);
  skillChip?.addEventListener('click', clearSkill);
  slashMenu?.addEventListener('mousedown', (event) => event.preventDefault());
  slashMenu?.addEventListener('click', handleSlashClick);
  document.addEventListener('mousedown', (event) => {
    if (!slashMenu || slashMenu.hidden) return;
    if (slashMenu.contains(event.target) || event.target === inputEl) return;
    hideSlashMenu();
  });
  window.dcb.onTerminalEvent(handleTerminalEvent);

  sendBtn.addEventListener('click', () => {
    if (state.streaming) {
      abortStream();
    } else if (!terminalBusy && !compressing) {
      sendMessage();
    }
  });

  modelBtn.addEventListener('click', openModelMenu);

  messagesEl.addEventListener('click', handleMessageClick);
  messagesEl.addEventListener('scroll', () => {
    // 用户上滑时不再强制跟随
    state.autoScroll = nearBottom();
  });

  window.dcb.onChatEvent(handleChatEvent);

  on('model-changed', () => refreshChrome());
  on('chat-changed', () => refreshAll());
  on('config', () => {
    if (!state.streaming) refreshAll();
    else refreshChrome();
  });
}

/* ------------------------------ 渲染 ------------------------------ */

export function refreshAll() {
  if (!state.config) return;
  refreshSidebar();
  refreshHeader();
  renderThread();
  refreshWorkBar();
  refreshChrome();
}

export function refreshChrome() {
  if (!state.config) return;
  const model = activeModel();
  const nameEl = $('#modelBtnName');
  if (nameEl) nameEl.textContent = model ? model.name : '选择模型';
  modelBtn?.classList.toggle('empty', !model);

  const foot = $('#footModel');
  if (foot) {
    foot.textContent = model ? `${model.providerName} · ${model.id}` : '尚未配置模型';
  }

  const mode = currentMode();
  const chip = $('#modeChip');
  chip.dataset.mode = mode;
  chip.textContent = mode === 'work' ? '工作模式' : '对话模式';

  const hintText = $('#modeHintText');
  if (hintText) hintText.textContent = mode === 'work' ? '工作模式' : '对话模式';

  $('#modeHintBtn').title = `点击切换到${mode === 'work' ? '对话' : '工作'}模式`;

  inputEl.placeholder =
    mode === 'work'
      ? '描述你希望 AI 完成的工作，输入 ! 执行终端命令，/ 打开命令'
      : '输入消息，输入 ! 执行终端命令，/ 打开命令';

  document.body.dataset.mode = mode;
  updateComposerHint();
  refreshSkillChip();
  refreshContextRing();

  const btnWs = $('#btnOpenWorkspace');
  if (btnWs) btnWs.hidden = !currentWorkspace() || mode !== 'work';

  updateSendButton();
  refreshWorkBar();
}

function refreshSidebar() {
  const list = $('#chatList');
  const chats = [...state.chats]
    .filter((c) => c.messages?.length)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  $('#chatCount').textContent = chats.length ? String(chats.length) : '';
  $('#sideEmpty').hidden = chats.length > 0;

  list.innerHTML = chats
    .map(
      (chat) => `
      <div class="chat-item ${chat.id === state.activeChatId ? 'active' : ''}" data-chat="${chat.id}">
        <span class="ci-dot"></span>
        <span class="ci-title">${escapeHtml(chat.title || '新对话')}</span>
        <span class="ci-time">${escapeHtml(formatRelative(chat.updatedAt))}</span>
        <button class="ci-del" data-del="${chat.id}" title="删除对话">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>`
    )
    .join('');

  list.querySelectorAll('.chat-item').forEach((item) => {
    item.addEventListener('click', (event) => {
      if (event.target.closest('[data-del]')) return;
      switchChat(item.dataset.chat);
    });
  });

  list.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const chat = getChat(btn.dataset.del);
      const ok = await confirmDialog({
        title: '删除这段对话？',
        message: `「${escapeHtml(chat?.title || '新对话')}」及其中的消息将被移除，此操作不可恢复。`,
        confirmText: '删除'
      });
      if (ok) {
        deleteChat(btn.dataset.del);
        refreshAll();
        toast('对话已删除');
      }
    });
  });
}

function refreshHeader() {
  const chat = getChat();
  refreshSkillChip();
  $('#chatTitle').textContent = chat?.title || '新对话';
  const mode = currentMode();
  const perm = PERMISSIONS[currentPermission()];
  const meta = [];
  meta.push(mode === 'work' ? '工作模式' : '对话模式');
  if (mode === 'work') {
    meta.push(currentWorkspace() ? workspaceLabel(currentWorkspace()) : '未选择工作空间');
    meta.push(perm?.label || '');
  } else {
    const model = activeModel();
    if (model) meta.push(model.name);
  }
  $('#chatMeta').textContent = meta.filter(Boolean).join(' · ');
}

function renderThread() {
  const chat = getChat();
  if (!chat || !chat.messages.length) {
    messagesEl.innerHTML = `<div class="msg-flow">${heroHtml()}</div>`;
    messagesEl.scrollTop = 0;
    return;
  }

  chat.messages.forEach((msg) => {
    if (!msg._id) msg._id = `m_${Math.random().toString(36).slice(2, 9)}`;
  });
  refreshContextRing();

  const wasNearBottom = nearBottom();
  messagesEl.innerHTML = `<div class="msg-flow">${chat.messages.map(messageHtml).join('')}</div>`;
  if (wasNearBottom) scrollToBottom();
  refreshContextRing();
}

function heroHtml() {
  const mode = currentMode();
  const hour = new Date().getHours();
  const greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 19 ? '下午好' : '晚上好';
  const model = activeModel();
  const perm = PERMISSIONS[currentPermission()];

  const title =
    mode === 'work' ? `让 AI 直接<em>动手做事</em>。` : `${greet}，今天<em>想做点什么</em>？`;
  const sub =
    mode === 'work'
      ? currentWorkspace()
        ? `工作空间 ${workspaceLabel(currentWorkspace())} · ${perm.label}。生成的文件都会保存在这里。`
        : '先在下方选择一个文件夹作为工作空间，AI 生成的文件都会存放在那里。'
      : model
        ? `已连接 ${escapeHtml(model.name)}。提问、写作、分析，或者只是聊聊。`
        : '还没有配置模型，先去设置里连接一个吧。';

  const cards = (SUGGESTIONS[mode] || SUGGESTIONS.chat)
    .map(
      (item) => `
      <button class="suggest" data-prompt="${escapeHtml(item.prompt)}">
        <span class="s-icon s-${item.kind}">${item.icon}</span>
        <span>
          <span class="s-title">${item.title}</span>
          <span class="s-desc">${item.desc}</span>
        </span>
      </button>`
    )
    .join('');

  return `
    <div class="hero">
      <div class="hero-kicker"><span class="dot"></span>${mode === 'work' ? 'WORK MODE' : 'READY'}</div>
      <h1>${title}</h1>
      <p>${sub}</p>
      <div class="suggests">${cards}</div>
      <div class="hero-foot">
        <span>${model ? escapeHtml(model.providerName) : '未配置供应商'}</span>
        <span class="sep"></span>
        <span>${model ? escapeHtml(model.id) : '前往设置添加'}</span>
      </div>
    </div>
  `;
}

function messageHtml(msg) {
  if (msg.role === 'terminal') return terminalHtml(msg);
  if (msg.role === 'user') {
    return `
      <div class="msg user" data-id="${msg._id}">
        <div class="msg-body">
          <div class="bubble">${escapeHtml(msg.content)}</div>
          <div class="msg-time">${formatTime(msg.ts)}</div>
        </div>
      </div>`;
  }

  const tools = toolsHtml(msg);
  const reasoning = msg.reasoning
    ? `<details class="reasoning"><summary>思考过程</summary><div class="reasoning-body">${escapeHtml(msg.reasoning)}</div></details>`
    : '';
  const files = filesHtml(msg);
  const error = msg.error
    ? `<div class="bubble" style="margin-top:${msg.content ? '10px' : '0'}">${escapeHtml(msg.error)}</div>`
    : '';
  const aborted = msg.aborted ? `<div class="msg-time" style="opacity:1">已手动停止生成</div>` : '';
  const cursor = msg.streaming ? '<span class="stream-cursor"></span>' : '';
  const body = msg.content
    ? `<div class="md">${renderMarkdown(msg.content)}${cursor}</div>`
    : msg.streaming
      ? `<div class="md"><span class="stream-cursor"></span></div>`
      : '';

  return `
    <div class="msg assistant ${msg.error && !msg.content ? 'error' : ''}" data-id="${msg._id}">
      <div class="msg-avatar logo-avatar">${ASSISTANT_AVATAR}</div>
      <div class="msg-body">
        ${reasoning}
        ${tools}
        ${body}
        ${files}
        ${error}
        ${aborted}
        ${msg.compressed ? '<div class="msg-time" style="opacity:1">上下文已压缩</div>' : ''}
        <div class="msg-time">${formatTime(msg.ts)}</div>
      </div>
    </div>`;
}

function toolsHtml(msg) {
  if (!msg.tools?.length) return '';
  const rows = msg.tools
    .map((tool) => {
      const detail = toolDetail(tool);
      const icon = tool.status === 'running' ? icons.spinner : toolIcons[tool.name] || icons.spark;
      const reviewing = tool.reviewing ? '<span class="tool-review">审查中</span>' : '';
      const reviewLabel =
        tool.review?.source === 'user'
          ? '已授权'
          : tool.review?.source === 'auto'
            ? '自动审查'
            : tool.review?.source === 'denied'
              ? '已拒绝'
              : '';
      const review = reviewLabel
        ? `<span class="tool-review ${tool.review.source === 'user' ? 'user' : ''} ${
            tool.review.source === 'denied' ? 'denied' : ''
          }" title="${escapeHtml(tool.review.reason || '')}">${reviewLabel}</span>`
        : reviewing;
      return `<div class="tool-item ${tool.status}" title="${escapeHtml(tool.output || '')}">
        <span class="ti-icon">${icon}</span>
        <span class="tool-label">${toolLabels[tool.name] || tool.name}</span>
        ${detail ? `<span class="tool-detail">${escapeHtml(detail)}</span>` : ''}
        ${review}
      </div>`;
    })
    .join('');
  return `<div class="tool-trace">${rows}</div>`;
}

function terminalHtml(msg) {
  const statusMap = {
    running: '执行中',
    reviewing: '自动审查中',
    waiting: '等待授权',
    denied: '已拒绝',
    done: '已完成',
    error: '执行失败'
  };
  const status = msg.status || 'running';
  const statusText = statusMap[status] || status;
  const running = ['running', 'reviewing', 'waiting'].includes(status);
  const dot = status === 'error' || status === 'denied' ? 'red' : running ? 'amber' : 'green';
  const reviewNote = msg.review
    ? `<div class="term-review-note">${
        msg.review.source === 'auto'
          ? `<b>自动审查已放行</b>${msg.review.reviewer ? ` · ${escapeHtml(msg.review.reviewer)}` : ''}${
              msg.review.reason ? ` · ${escapeHtml(msg.review.reason)}` : ''
            }`
          : msg.review.source === 'user'
            ? `<b>已由你授权执行</b>${msg.review.reason ? ` · ${escapeHtml(msg.review.reason)}` : ''}`
            : `<b>自动审查未放行</b>${msg.review.reason ? ` · ${escapeHtml(msg.review.reason)}` : ''}`
      }</div>`
    : '';
  const err = msg.error
    ? `<div class="term-review-note" style="color:#ff9b8e">${escapeHtml(msg.error)}</div>`
    : '';
  return `
    <div class="msg terminal" data-id="${msg._id}">
      <div class="term-card">
        <div class="term-head">
          <span class="term-dot ${dot}"></span>
          <span class="term-title">终端</span>
          <span class="term-status ${status === 'error' || status === 'denied' ? 'error' : running ? 'running' : ''}">${statusText}${
            Number.isInteger(msg.exitCode) ? ` · ${msg.exitCode}` : ''
          }</span>
          <span class="term-cwd" title="${escapeHtml(msg.cwd || '')}">${escapeHtml(msg.cwd || '')}</span>
          ${
            running && msg._req
              ? `<button class="term-abort" data-term-abort="${escapeHtml(msg._req)}">停止</button>`
              : ''
          }
        </div>
        <div class="term-body">
          <div class="term-cmdline"><span class="term-prompt">$</span>${escapeHtml(msg.command || '')}</div>
          <pre class="term-out">${escapeHtml(msg.output || '')}${
            msg.stderr ? `<span class="term-stderr">${escapeHtml(msg.stderr)}</span>` : ''
          }${running ? '<span class="term-cursor"></span>' : ''}</pre>
        </div>
        ${reviewNote}
        ${err}
      </div>
    </div>`;
}

function filesHtml(msg) {
  if (!msg.files?.length) return '';
  const chips = msg.files
    .map(
      (file) => `<button class="file-chip" data-path="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}">
        ${icons.file}<span>${file.action === 'deleted' ? '已删除' : '已生成'} ${escapeHtml(file.display || file.path)}</span>
      </button>`
    )
    .join('');
  return `<div class="file-chips">${chips}</div>`;
}

function toolDetail(tool) {
  if (tool.detail) return tool.detail;
  if (!tool.args) return '';
  try {
    const args = typeof tool.args === 'string' ? JSON.parse(tool.args) : tool.args;
    return args.path || args.command || args.url || '';
  } catch {
    return '';
  }
}

function refreshWorkBar() {
  const bar = $('#workBar');
  const mode = currentMode();
  bar.hidden = mode !== 'work';
  if (mode !== 'work') return;

  const active = currentWorkspace();
  const chips = [];
  if (active) chips.push(active);
  recentWorkspaces().forEach((path) => {
    if (!chips.includes(path)) chips.push(path);
  });
  const visible = chips.slice(0, 3);

  const list = $('#wsList');
  list.innerHTML = visible.length
    ? visible
        .map(
          (path) => `
      <button class="ws-chip ${path === active ? 'active' : ''}" data-path="${escapeHtml(path)}" title="${escapeHtml(path)}">
        ${icons.folder}<span>${escapeHtml(workspaceLabel(path))}</span>
        <span class="wc-x" data-clear="${path === active ? '1' : '0'}" data-path="${escapeHtml(path)}" title="${path === active ? '取消选择' : '从列表移除'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </span>
      </button>`
        )
        .join('')
    : `<span class="wb-empty">尚未选择工作空间</span>`;

  const perm = currentPermission();
  $('#permList').querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.perm === perm);
    btn.setAttribute('aria-checked', String(btn.dataset.perm === perm));
  });
}

function updateSendButton() {
  if (!sendBtn) return;
  sendBtn.classList.toggle('stop', state.streaming);
  sendBtn.querySelector('.i-send').hidden = state.streaming;
  sendBtn.querySelector('.i-stop').hidden = !state.streaming;
  sendBtn.title = state.streaming ? '停止生成' : '发送';
  sendBtn.disabled =
    compressing || terminalBusy || (!state.streaming && !(inputEl?.value || '').trim());
}

function autosize() {
  if (autoResizing || !inputEl) return;
  autoResizing = true;
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(220, Math.max(24, inputEl.scrollHeight))}px`;
  autoResizing = false;
}

function nearBottom() {
  if (!messagesEl) return true;
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 140;
}

function scrollToBottom(behavior = 'auto') {
  if (!messagesEl) return;
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior });
}

function handleMessageClick(event) {
  const suggest = event.target.closest('.suggest');
  if (suggest) {
    inputEl.value = suggest.dataset.prompt || '';
    autosize();
    inputEl.focus();
    return;
  }
  const fileChip = event.target.closest('.file-chip');
  if (fileChip) {
    window.dcb.showItem(fileChip.dataset.path);
  }
  const abort = event.target.closest('[data-term-abort]');
  if (abort) {
    window.dcb.terminalAbort(abort.dataset.termAbort);
  }
}

/* ------------------------------ 模型菜单 ------------------------------ */

function openModelMenu() {
  if (!providers().length) {
    emit('open-settings', { tab: 'providers' });
    return;
  }
  const current = activeModel();
  const items = [];
  providers().forEach((provider) => {
    items.push({ type: 'section', label: provider.name || '未命名供应商' });
    (provider.models || []).forEach((model) => {
      items.push({
        label: model.name || model.id,
        sub: model.name && model.name !== model.id ? model.id : '',
        active: current && current.providerId === provider.id && current.id === model.id,
        onClick: async () => {
          await setActiveModel(provider.id, model.id);
          toast(`已切换到 ${model.name || model.id}`);
          refreshChrome();
        }
      });
    });
  });
  items.push({ type: 'sep' });
  items.push({
    label: '管理模型与供应商…',
    icon: icons.settings,
    onClick: () => emit('open-settings', { tab: 'providers' })
  });

  openMenu(modelBtn, { items, width: 300, align: 'end' });
}

/* ------------------------------ 会话操作 ------------------------------ */

export function startNewChat() {
  if (state.streaming) abortStream();
  createNewChat();
  refreshAll();
  inputEl.focus();
}

/* ------------------------------ 发送 ------------------------------ */

export async function chooseWorkspace() {
  const dir = await window.dcb.pickFolder(currentWorkspace() || undefined);
  if (!dir) return null;
  const recents = [dir, ...recentWorkspaces().filter((p) => p !== dir)].slice(0, 6);
  await patchConfig({ work: { workspace: dir, recentWorkspaces: recents } });
  refreshAll();
  toast(`工作空间：${workspaceLabel(dir)}`);
  return dir;
}

export function abortStream() {
  if (!state.currentRequestId) return;
  window.dcb.chatAbort(state.currentRequestId);
}

/* ------------------------------ 斜杠命令 / 终端 / 上下文 ------------------------------ */

let compressing = false;

const SLASH_COMMANDS = [
  {
    id: 'compress',
    label: '/压缩',
    title: '压缩上下文',
    desc: '仅保留重要信息，减少后续请求的上下文占用',
    icon: icons.spark
  },
  {
    id: 'skill',
    label: '/技能',
    title: '调用技能',
    desc: '查看已安装的 skills，并在本次对话中启用',
    icon: icons.book
  }
];

function updateComposerHint() {
  const foot = $('#footHint');
  if (!foot) return;
  const value = (inputEl?.value || '').trim();
  if (value.startsWith('!')) {
    foot.textContent = '终端命令 · Enter 运行，输出显示在对话中';
    return;
  }
  if (value.startsWith('/')) {
    foot.textContent = '斜杠命令 · ↑↓ 选择，Enter 执行，Esc 关闭';
    return;
  }
  const enterSends = state.config?.chat?.enterToSend !== false;
  foot.textContent = enterSends
    ? 'Enter 发送 · Shift + Enter 换行 · / 命令 · ! 终端'
    : 'Ctrl + Enter 发送 · Enter 换行 · / 命令 · ! 终端';
}

function refreshSkillChip() {
  if (!skillChip) return;
  const skill = getChat()?.skill || '';
  skillChip.hidden = !skill;
  const nameEl = $('#skillChipName');
  if (nameEl) nameEl.textContent = skill;
}

async function loadSkills(force = false) {
  if (skillsLoaded && !force) return skillsCache;
  try {
    skillsCache = (await window.dcb.listSkills()) || [];
  } catch {
    skillsCache = [];
  }
  skillsLoaded = true;
  return skillsCache;
}

async function activateSkill(name) {
  const chat = ensureChat();
  chat.skill = name;
  chat.updatedAt = Date.now();
  refreshSkillChip();
  scheduleChatSave();
  toast(`已在本次对话启用技能：${name}`);
}

function clearSkill() {
  const chat = getChat();
  if (!chat?.skill) return;
  chat.skill = '';
  chat.updatedAt = Date.now();
  refreshSkillChip();
  scheduleChatSave();
  toast('已移除本次对话的技能');
}

function hideSlashMenu() {
  if (!slashMenu) return;
  slashMenu.hidden = true;
  slashMenu.innerHTML = '';
  slashEntries = [];
  slashIndex = 0;
}

function positionSlashMenu() {
  const composer = $('#composer');
  if (!composer || !slashMenu) return;
  const rect = composer.getBoundingClientRect();
  slashMenu.style.left = `${Math.round(rect.left)}px`;
  slashMenu.style.width = `${Math.round(Math.min(400, rect.width))}px`;
  slashMenu.style.bottom = `${Math.round(window.innerHeight - rect.top + 8)}px`;
}

async function updateSlashMenu() {
  if (!slashMenu || !inputEl) return;
  const value = inputEl.value;
  if (!value.startsWith('/') || value.includes('\n') || state.settingsOpen) {
    hideSlashMenu();
    return;
  }

  const skillMatch = value.match(/^\/(?:技能|skill)(?:\s+([\s\S]*))?$/i);
  if (skillMatch) {
    const list = await loadSkills();
    const query = (skillMatch[1] || '').trim().toLowerCase();
    slashMode = 'skills';
    slashEntries = list
      .filter((skill) => !query || skill.name.toLowerCase().includes(query) || (skill.description || '').toLowerCase().includes(query))
      .map((skill) => ({ type: 'skill', name: skill.name, description: skill.description || '' }));
    slashIndex = Math.min(slashIndex, Math.max(0, slashEntries.length - 1));
    renderSlashMenu(
      slashEntries.length
        ? ''
        : `<div class="slash-empty">还没有安装技能。<br />把技能文件夹放到 <code>~/.dcb/skills</code>，或在其中放置 <code>name.md</code>。</div>`
    );
    return;
  }

  const query = value.slice(1).toLowerCase();
  slashMode = 'commands';
  slashEntries = SLASH_COMMANDS.filter(
    (cmd) =>
      !query ||
      cmd.label.toLowerCase().includes(query) ||
      cmd.title.toLowerCase().includes(query) ||
      cmd.desc.toLowerCase().includes(query)
  ).map((cmd) => ({ type: 'command', ...cmd }));
  slashIndex = Math.min(slashIndex, Math.max(0, slashEntries.length - 1));
  renderSlashMenu('');
}

function renderSlashMenu(emptyHtml) {
  if (!slashMenu) return;
  if (!slashEntries.length && !emptyHtml) {
    hideSlashMenu();
    return;
  }

  const rows = slashEntries
    .map((entry, index) => {
      const active = index === slashIndex ? ' active' : '';
      if (entry.type === 'skill') {
        return `<button type="button" class="slash-item${active}" data-slash-index="${index}">
          <span class="si-icon">${icons.spark}</span>
          <span class="si-main"><b>/技能 ${escapeHtml(entry.name)}</b><small>${escapeHtml(entry.description || '已安装技能')}</small></span>
          <kbd>Enter</kbd>
        </button>`;
      }
      return `<button type="button" class="slash-item${active}" data-slash-index="${index}">
        <span class="si-icon">${entry.icon || icons.spark}</span>
        <span class="si-main"><b>${escapeHtml(entry.label)}</b><small>${escapeHtml(entry.desc)}</small></span>
        <kbd>Enter</kbd>
      </button>`;
    })
    .join('');

  slashMenu.innerHTML = `
    <div class="slash-head">${slashMode === 'skills' ? '技能' : '斜杠命令'}<span class="sh-line"></span></div>
    ${rows}
    ${emptyHtml || ''}
  `;
  slashMenu.hidden = false;
  positionSlashMenu();
  const active = slashMenu.querySelector('.slash-item.active');
  active?.scrollIntoView({ block: 'nearest' });
}

function handleSlashKey(event) {
  if (!slashMenu || slashMenu.hidden) return false;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (slashEntries.length) {
      slashIndex = (slashIndex + 1) % slashEntries.length;
      renderSlashMenu('');
    }
    return true;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (slashEntries.length) {
      slashIndex = (slashIndex - 1 + slashEntries.length) % slashEntries.length;
      renderSlashMenu('');
    }
    return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    hideSlashMenu();
    return true;
  }
  if ((event.key === 'Enter' || event.key === 'Tab') && !event.isComposing) {
    if (slashEntries.length) {
      event.preventDefault();
      chooseSlashEntry(slashEntries[slashIndex]);
      return true;
    }
  }
  return false;
}

function chooseSlashEntry(entry) {
  if (!entry) return;
  if (entry.type === 'command' && entry.id === 'compress') {
    hideSlashMenu();
    inputEl.value = '';
    autosize();
    updateSendButton();
    updateComposerHint();
    compressContext();
    return;
  }
  if (entry.type === 'command' && entry.id === 'skill') {
    slashMode = 'skills';
    inputEl.value = '/技能 ';
    autosize();
    inputEl.focus();
    updateSlashMenu();
    return;
  }
  if (entry.type === 'skill') {
    inputEl.value = `/技能 ${entry.name} `;
    autosize();
    updateSendButton();
    updateSlashMenu();
    inputEl.focus();
  }
}

function handleSlashClick(event) {
  const item = event.target.closest('[data-slash-index]');
  if (!item) return;
  const index = Number(item.dataset.slashIndex);
  chooseSlashEntry(slashEntries[index]);
}

async function handleSlashInput(text) {
  if (text === '/压缩' || text === '/compress') {
    inputEl.value = '';
    autosize();
    updateSendButton();
    updateComposerHint();
    hideSlashMenu();
    await compressContext();
    return { handled: true };
  }
  if (text === '/技能' || text === '/skill') {
    inputEl.value = '/技能 ';
    autosize();
    await updateSlashMenu();
    inputEl.focus();
    return { handled: true, keepInput: true };
  }

  const match = text.match(/^\/(?:技能|skill)\s+([\s\S]+)$/i);
  if (match) {
    const rest = match[1].trim();
    const list = await loadSkills(true);
    const skill = list
      .filter((item) => rest === item.name || rest.startsWith(`${item.name} `))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (!skill) {
      toast('未找到该技能，可用 /技能 查看列表', 'warn');
      return { handled: true };
    }
    await activateSkill(skill.name);
    const prompt = rest.slice(skill.name.length).trim();
    return prompt ? { handled: false, prompt } : { handled: true };
  }

  return { handled: false };
}

function formatTokens(value) {
  const number = Math.max(0, Math.round(Number(value) || 0));
  if (number >= 10000) return `${Math.round(number / 1000)}k`;
  if (number >= 1000) return `${(number / 1000).toFixed(1)}k`;
  return String(number);
}

function estimateTokens(text) {
  if (!text) return 0;
  let total = 0;
  for (const char of String(text)) {
    if (/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(char)) total += 1;
    else if (/\s/.test(char)) total += 0.25;
    else total += 0.28;
  }
  return Math.ceil(total);
}

function contextLimit() {
  const model = activeModel();
  const configured = Number(model?.contextWindow);
  if (configured > 0) return configured;
  if (model?.protocol === 'anthropic' || model?.protocol === 'responses') return 200000;
  return 128000;
}

function estimateChatTokens(chat) {
  let total = 700;
  if (!chat) return total;
  for (const msg of chat.messages || []) {
    if (msg.role === 'terminal') {
      total += estimateTokens(msg.command) + estimateTokens(msg.output) + estimateTokens(msg.stderr) + 12;
    } else {
      total += estimateTokens(msg.content) + 6;
    }
  }
  if (chat.skill) total += 1200;
  return Math.round(total);
}

function refreshContextRing() {
  if (!ctxRing || !ctxRingProgress) return;
  const used = estimateChatTokens(getChat());
  const limit = contextLimit();
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  ctxRingProgress.style.strokeDashoffset = String(53.41 * (1 - ratio));
  ctxRing.classList.toggle('empty', used <= 700);
  ctxRing.title = `上下文 ${formatTokens(used)} / ${formatTokens(limit)}（${(ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%）`;
}

function showContextDetails() {
  const chat = getChat();
  const model = activeModel();
  const used = estimateChatTokens(chat);
  const limit = contextLimit();
  const percent = Math.min(100, (used / limit) * 100);
  const messageCount = (chat?.messages || []).filter((msg) => msg.role !== 'terminal').length;
  const html = `
    <div class="ctx-head"><b>${percent.toFixed(percent < 10 ? 1 : 0)}%</b><span>${formatTokens(used)} / ${formatTokens(limit)}</span></div>
    <div class="ctx-bar"><i style="width:${percent.toFixed(1)}%"></i></div>
    <div class="ctx-grid">
      <span>对话消息</span><span>${messageCount}</span>
      <span>上下文上限</span><span>${formatTokens(limit)}</span>
      <span>剩余可用</span><span>${formatTokens(Math.max(0, limit - used))}</span>
      <span>当前模型</span><span>${escapeHtml(model?.name || '未选择')}</span>
      <span>技能</span><span>${escapeHtml(chat?.skill || '无')}</span>
    </div>
    <p class="ctx-note">按字符启发式估算，实际 token 以模型 usage 为准。接近上限时可用 /压缩 保留重要上下文。</p>
  `;
  openMenu(ctxRing, { items: [{ type: 'html', html }], width: 286, align: 'end' });
}

async function compressContext() {
  if (compressing || state.streaming) {
    toast('请等待当前回复结束', 'warn');
    return;
  }
  const chat = getChat();
  if (!chat?.messages?.length) {
    toast('当前对话还没有可压缩的内容', 'warn');
    return;
  }
  const provider = activeProvider();
  const model = activeModel();
  if (!provider || !model) {
    toast('请先配置模型', 'warn');
    return;
  }

  const before = estimateChatTokens(chat);
  compressing = true;
  updateSendButton();
  toast('正在压缩上下文…', 'ok', 4000);
  try {
    const result = await window.dcb.compressContext({
      providerId: provider.id,
      modelId: model.id,
      messages: buildHistory(chat)
    });
    if (!result?.summary) throw new Error('模型没有返回摘要');
    chat.messages = [
      {
        role: 'assistant',
        content: `> 上下文已压缩，仅保留重要信息。\n\n${result.summary}`,
        ts: Date.now(),
        compressed: true
      }
    ];
    chat.updatedAt = Date.now();
    streamingMsg = null;
    renderThread();
    refreshSidebar();
    scheduleChatSave();
    const after = estimateChatTokens(chat);
    toast(`上下文已压缩：${formatTokens(before)} → ${formatTokens(after)} tokens（估算）`);
  } catch (err) {
    toast(err.message || '压缩失败', 'error');
  } finally {
    compressing = false;
    updateSendButton();
  }
}

function buildHistory(chat) {
  return (chat?.messages || [])
    .filter((msg) => msg && msg.role && !msg.streaming)
    .map((msg) => {
      if (msg.compressed) {
        return { role: 'user', content: `[上下文摘要]\n${msg.content}` };
      }
      if (msg.role === 'terminal') {
        const output = `${msg.output || ''}${msg.stderr ? `\n${msg.stderr}` : ''}`.slice(0, 4000);
        return {
          role: 'user',
          content: `[终端命令] ${msg.command}\n[输出]\n${output}\n[退出码] ${
            msg.exitCode ?? (msg.status === 'running' ? '运行中' : '未知')
          }`
        };
      }
      if (!msg.content || msg.error) return null;
      return { role: msg.role, content: msg.content };
    })
    .filter(Boolean);
}

async function runTerminal(rawCommand) {
  const command = String(rawCommand || '').trim();
  if (!command) {
    toast('请输入要执行的终端命令', 'warn');
    return;
  }
  if (terminalBusy) {
    toast('已有命令正在执行，请先停止', 'warn');
    return;
  }

  const chat = ensureChat();
  chat.mode = currentMode();
  if (!chat.title || chat.title === '新对话') chat.title = titleFrom(`终端 · ${command}`);
  if (state.chats[0]?.id !== chat.id) {
    state.chats = [chat, ...state.chats.filter((item) => item.id !== chat.id)];
  }
  const requestId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const message = {
    role: 'terminal',
    command,
    cwd: currentWorkspace() || '',
    output: '',
    stderr: '',
    status: 'running',
    ts: Date.now(),
    _req: requestId,
    _id: `m_${Math.random().toString(36).slice(2, 9)}`
  };
  chat.messages.push(message);
  chat.updatedAt = Date.now();

  inputEl.value = '';
  autosize();
  updateSendButton();
  updateComposerHint();
  updateSlashMenu();
  terminalBusy = true;
  state.terminalMsg = message;
  state.terminalRequestId = requestId;

  renderThread();
  refreshSidebar();
  scrollToBottom();
  scheduleChatSave();

  try {
    const result = await window.dcb.terminalRun({ requestId, command, workspace: currentWorkspace() });
    if (result?.denied) {
      message.status = 'denied';
      if (!message.error) message.error = result.message || '命令被拒绝执行';
    } else if (result?.error) {
      message.status = 'error';
      if (!message.error) message.error = result.error;
    }
    if (Number.isInteger(result?.code)) {
      message.exitCode = result.code;
      if (message.status === 'running') message.status = result.code === 0 ? 'done' : 'error';
    }
  } catch (err) {
    message.status = 'error';
    message.error = err.message || '命令执行失败';
  } finally {
    terminalBusy = false;
    message._req = null;
    state.terminalMsg = null;
    state.terminalRequestId = null;
    repaintMessage(message);
    refreshContextRing();
    scheduleChatSave();
    updateSendButton();
    refreshSidebar();
  }
}

function handleTerminalEvent(event) {
  if (!event || event.requestId !== state.terminalRequestId || !state.terminalMsg) return;
  const message = state.terminalMsg;
  switch (event.type) {
    case 'start':
      message.status = 'running';
      if (event.cwd) message.cwd = event.cwd;
      break;
    case 'review-start':
      message.status = 'reviewing';
      break;
    case 'review':
      if (event.decision === 'allow') {
        message.status = 'running';
        message.review = { source: 'auto', reviewer: event.reviewer, reason: event.reason };
      } else {
        message.status = 'waiting';
        message.review = { source: 'review', reviewer: event.reviewer, reason: event.reason };
      }
      break;
    case 'approved':
      message.status = 'running';
      message.review = {
        source: event.source === 'auto' ? 'auto' : 'user',
        reviewer: event.review?.reviewer || event.reviewer || '',
        reason: event.review?.reason || event.reason || ''
      };
      break;
    case 'output':
      if (event.stream === 'stderr') message.stderr = (message.stderr || '') + (event.text || '');
      else message.output = (message.output || '') + (event.text || '');
      break;
    case 'exit':
      message.exitCode = event.code;
      message.status = event.code === 0 ? 'done' : 'error';
      if (event.aborted) {
        message.status = 'done';
        message.error = '命令已停止';
      }
      break;
    case 'error':
      message.status = event.denied ? 'denied' : 'error';
      message.error = event.message || '命令执行失败';
      break;
    default:
      break;
  }
  repaintMessage(message);
  refreshContextRing();
  if (nearBottom()) scrollToBottom();
  scheduleChatSave();
}

export async function sendMessage() {
  if (state.streaming || compressing) return;
  if (terminalBusy) {
    toast('请等待终端命令结束，或先在终端卡片中停止', 'warn');
    return;
  }
  if (!state.config) return;
  let text = inputEl.value.trim();
  if (!text) {
    inputEl.focus();
    return;
  }

  if (text.startsWith('!')) {
    await runTerminal(text.slice(1));
    return;
  }

  const slash = await handleSlashInput(text);
  if (slash.handled) {
    if (slash.keepInput) {
      updateSendButton();
      return;
    }
    inputEl.value = '';
    autosize();
    updateSendButton();
    updateComposerHint();
    hideSlashMenu();
    if (!slash.prompt) return;
    text = slash.prompt;
  } else if (slash.prompt) {
    text = slash.prompt;
    hideSlashMenu();
  }

  const provider = activeProvider();
  const model = activeModel();
  if (!provider || !model) {
    toast('请先配置供应商与模型', 'warn');
    emit('open-settings', { tab: 'providers' });
    return;
  }

  const mode = currentMode();
  if (mode === 'work' && !currentWorkspace()) {
    const picked = await chooseWorkspace();
    if (!picked) {
      toast('工作模式需要先选择工作空间', 'warn');
      return;
    }
  }

  const chat = ensureChat();
  chat.mode = mode;
  chat.updatedAt = Date.now();
  const userMsg = { role: 'user', content: text, ts: Date.now() };
  chat.messages.push(userMsg);
  if (!chat.title || chat.title === '新对话') chat.title = titleFrom(text);
  chat.updatedAt = Date.now();
  if (state.chats[0]?.id !== chat.id) {
    state.chats = [chat, ...state.chats.filter((c) => c.id !== chat.id)];
  }

  inputEl.value = '';
  autosize();
  inputEl.focus();

  const assistant = {
    role: 'assistant',
    content: '',
    ts: Date.now(),
    streaming: true,
    tools: [],
    files: [],
    reasoning: ''
  };
  chat.messages.push(assistant);
  streamingMsg = assistant;

  renderThread();
  refreshSidebar();
  refreshHeader();
  scrollToBottom();
  scheduleChatSave();

  state.streaming = true;
  state.currentRequestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  state.autoScroll = true;
  updateSendButton();

  const history = buildHistory(chat)
    .filter((message) => !(message.role === 'assistant' && message.content === assistant.content && !message.content))
    .slice(-24);

  try {
    const result = await window.dcb.chatSend({
      requestId: state.currentRequestId,
      providerId: provider.id,
      modelId: model.id,
      messages: history,
      skill: chat.skill || '',
      mode,
      permission: currentPermission(),
      workspace: currentWorkspace()
    });
    finishAssistant(assistant, result);
  } catch (err) {
    assistant.streaming = false;
    assistant.error = err?.message || '请求失败，请检查网络或供应商配置';
  } finally {
    state.streaming = false;
    state.currentRequestId = null;
    finishStreamingUI(chat);
  }
}

function finishAssistant(msg, result) {
  msg.streaming = false;
  if (result?.text && result.text.length > (msg.content || '').length) {
    msg.content = result.text;
  }
  if (result?.reasoning && !msg.reasoning) msg.reasoning = result.reasoning;
  if (result?.usage) msg.usage = result.usage;
  if (result?.files?.length) msg.files = result.files;
  if (result?.toolLog?.length) {
    msg.tools = result.toolLog.map((log) => ({
      id: log.id,
      name: log.name,
      args: log.args,
      output: log.output,
      status: log.ok ? 'ok' : 'error',
      review: log.review
    }));
  }
  if (result?.aborted) msg.aborted = true;
  if (result?.error) msg.error = result.error;
  if (!msg.content && !msg.error && !msg.aborted) {
    msg.error = '模型没有返回内容，请检查模型 ID 或稍后重试。';
  }
}

function finishStreamingUI(chat) {
  streamingMsg = null;
  chat.updatedAt = Date.now();
  if (!state.settingsOpen) renderThread();
  refreshSidebar();
  refreshHeader();
  refreshSkillChip();
  refreshContextRing();
  updateSendButton();
  scrollToBottom();
  scheduleChatSave();
}

function handleChatEvent(event) {
  if (!event || event.requestId !== state.currentRequestId || !streamingMsg) return;
  const msg = streamingMsg;

  switch (event.type) {
    case 'delta': {
      msg.content = (msg.content || '') + (event.text || '');
      queueStreamPaint();
      break;
    }
    case 'reasoning': {
      msg.reasoning = (msg.reasoning || '') + (event.text || '');
      queueStreamPaint(true);
      break;
    }
    case 'tool': {
      let tool = msg.tools.find((t) => t.id === event.id);
      if (!tool) {
        tool = { id: event.id, name: event.name, status: event.status, args: event.args || '' };
        msg.tools.push(tool);
      }
      tool.status = event.status;
      if (event.args) tool.args = event.args;
      if (event.output) tool.output = event.output;
      if (event.review) tool.review = event.review;
      repaintMessage(msg);
      break;
    }
    case 'file': {
      msg.files.push(event);
      repaintMessage(msg);
      break;
    }
    case 'review-start': {
      const tool = msg.tools.find((item) => item.id === event.toolId);
      if (tool) {
        tool.reviewing = true;
        repaintMessage(msg);
      }
      break;
    }
    case 'review': {
      const tool = msg.tools.find((item) => item.id === event.toolId);
      if (tool) {
        tool.reviewing = false;
        tool.review = {
          source: event.decision === 'allow' ? 'auto' : 'review',
          reviewer: event.reviewer || '',
          reason: event.reason || ''
        };
        repaintMessage(msg);
      }
      break;
    }
    case 'error': {
      msg.error = event.message || '请求失败';
      break;
    }
    default:
      break;
  }
}

function queueStreamPaint(force = false) {
  if (paintQueued && !force) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    if (!streamingMsg) return;
    paintStreaming(streamingMsg);
  });
}

function paintStreaming(msg) {
  const el = messagesEl.querySelector(`.msg[data-id="${msg._id}"]`);
  if (!el) {
    renderThread();
    return;
  }
  const keep = nearBottom();
  const md = el.querySelector('.md');
  if (md) {
    md.innerHTML = `${renderMarkdown(msg.content || '')}<span class="stream-cursor"></span>`;
  } else {
    repaintMessage(msg);
    return;
  }
  const reasoningEl = el.querySelector('.reasoning-body');
  if (reasoningEl) reasoningEl.textContent = msg.reasoning;
  refreshContextRing();
  if (keep) scrollToBottom();
}

function repaintMessage(msg) {
  const el = messagesEl.querySelector(`.msg[data-id="${msg._id}"]`);
  if (!el) return;
  const keep = nearBottom();
  el.outerHTML = messageHtml(msg);
  if (keep) scrollToBottom();
}

/* ------------------------------ 对外 ------------------------------ */

export function focusInput(selectAll = false) {
  inputEl?.focus();
  if (selectAll) inputEl?.select();
}

export function fillInput(text) {
  if (!inputEl) return;
  inputEl.value = text;
  autosize();
  inputEl.focus();
}

export function refreshThread() {
  renderThread();
}

export function bindComposerHelpers() {
  // 预留：后续可在此挂载附件等能力
}

on('chat-list-changed', refreshSidebar);

export { copyText };
