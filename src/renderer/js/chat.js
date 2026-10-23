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
let autoResizing = false;
let paintQueued = false;
let streamingMsg = null;

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

  inputEl.addEventListener('input', () => {
    autosize();
    updateSendButton();
  });
  inputEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    const enterSends = state.config?.chat?.enterToSend !== false;
    const shouldSend = enterSends ? !event.shiftKey && !event.ctrlKey && !event.metaKey : event.ctrlKey || event.metaKey;
    if (shouldSend) {
      event.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', () => {
    if (state.streaming) {
      abortStream();
    } else {
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

  const enterSends = state.config.chat?.enterToSend !== false;
  $('#footHint').textContent = enterSends ? 'Enter 发送 · Shift + Enter 换行' : 'Ctrl + Enter 发送 · Enter 换行';
  inputEl.placeholder =
    mode === 'work' ? '描述你希望 AI 完成的工作，生成的文件会写入工作空间…' : '输入消息，Enter 发送，Shift + Enter 换行';

  document.body.dataset.mode = mode;

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

  const wasNearBottom = nearBottom();
  messagesEl.innerHTML = `<div class="msg-flow">${chat.messages.map(messageHtml).join('')}</div>`;
  if (wasNearBottom) scrollToBottom();
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
      return `<div class="tool-item ${tool.status}" title="${escapeHtml(tool.output || '')}">
        <span class="ti-icon">${icon}</span>
        <span class="tool-label">${toolLabels[tool.name] || tool.name}</span>
        ${detail ? `<span class="tool-detail">${escapeHtml(detail)}</span>` : ''}
      </div>`;
    })
    .join('');
  return `<div class="tool-trace">${rows}</div>`;
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
  sendBtn.disabled = !state.streaming && !(inputEl?.value || '').trim();
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

export async function sendMessage() {
  if (state.streaming) return;
  if (!state.config) return;
  const text = inputEl.value.trim();
  if (!text) {
    inputEl.focus();
    return;
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

  const history = chat.messages
    .filter((m) => m !== assistant && m.role && m.content && !m.error)
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const result = await window.dcb.chatSend({
      requestId: state.currentRequestId,
      providerId: provider.id,
      modelId: model.id,
      messages: history,
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
      status: log.ok ? 'ok' : 'error'
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
      repaintMessage(msg);
      break;
    }
    case 'file': {
      msg.files.push(event);
      repaintMessage(msg);
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
