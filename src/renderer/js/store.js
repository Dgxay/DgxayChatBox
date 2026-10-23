import { uid, debounce } from './ui.js';

export const state = {
  config: null,
  chats: [],
  activeChatId: null,
  streaming: false,
  currentRequestId: null,
  info: null,
  settingsOpen: false,
  settingsTab: 'providers',
  recordingShortcut: false
};

export const bus = new EventTarget();

export function emit(name, detail = {}) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on(name, handler) {
  bus.addEventListener(name, handler);
  return () => bus.removeEventListener(name, handler);
}

let saveChain = Promise.resolve();

export function patchConfig(patch) {
  saveChain = saveChain
    .then(async () => {
      const merged = await window.dcb.saveConfig(patch);
      state.config = merged;
      emit('config', { patch });
      return merged;
    })
    .catch((err) => {
      console.error('[config]', err);
      emit('config-error', { error: err });
      return state.config;
    });
  return saveChain;
}

export async function initStore(info) {
  state.info = info;
  state.config = info.config;
  try {
    const chats = await window.dcb.loadChats();
    state.chats = Array.isArray(chats)
      ? chats.filter((c) => Array.isArray(c.messages) && c.messages.length)
      : [];
  } catch {
    state.chats = [];
  }
}

/* ------------------------------ 模型 ------------------------------ */

export function providers() {
  return state.config?.providers || [];
}

export function findProvider(id) {
  return providers().find((p) => p.id === id) || null;
}

export function activeProvider() {
  const c = state.config;
  if (!c) return null;
  return providers().find((p) => p.id === c.activeProviderId) || providers()[0] || null;
}

export function activeModel() {
  const provider = activeProvider();
  if (!provider) return null;
  const list = provider.models || [];
  const model = list.find((m) => m.id === state.config.activeModelId) || list[0];
  if (!model) return null;
  return {
    id: model.id,
    name: model.name || model.id,
    providerId: provider.id,
    providerName: provider.name,
    protocol: provider.protocol || 'openai',
    contextWindow: Number(model.contextWindow) || 0
  };
}

export function modelLabel() {
  const model = activeModel();
  if (!model) return '选择模型';
  return model.name || model.id;
}

export async function setActiveModel(providerId, modelId) {
  await patchConfig({ activeProviderId: providerId, activeModelId: modelId });
  emit('model-changed');
}

/* ------------------------------ 工作区 ------------------------------ */

export function currentWorkspace() {
  return state.config?.work?.workspace || '';
}

export function recentWorkspaces() {
  const all = state.config?.work?.recentWorkspaces || [];
  return all.filter((p) => typeof p === 'string' && p.trim());
}

export function workspaceLabel(path) {
  if (!path) return '未选择';
  const parts = String(path)
    .split(/[\\/]/)
    .filter(Boolean);
  return parts[parts.length - 1] || path;
}

export const PERMISSIONS = {
  none: {
    label: '无权限',
    short: '只读',
    desc: '仅可只读访问工作空间文件，禁止联网与修改文件'
  },
  normal: {
    label: '普通权限',
    short: '普通',
    desc: '拥有全部能力，每次操作先由审查模型判断，可疑操作转交你确认'
  },
  full: {
    label: '完全权限',
    short: '完全',
    desc: '可执行终端命令、访问任意文件、无限制联网'
  }
};

export function currentPermission() {
  return state.config?.ui?.permission || 'normal';
}

export function currentMode() {
  return state.config?.ui?.mode === 'work' ? 'work' : 'chat';
}

/* ------------------------------ 会话 ------------------------------ */

export function getChat(id = state.activeChatId) {
  return state.chats.find((c) => c.id === id) || null;
}

export function ensureChat() {
  let chat = getChat();
  if (chat) return chat;
  chat = {
    id: uid('chat'),
    title: '新对话',
    mode: currentMode(),
    skill: '',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  return chat;
}

export function createNewChat() {
  const existing = getChat();
  if (existing && !existing.messages.length) return existing;
  const chat = {
    id: uid('chat'),
    title: '新对话',
    mode: currentMode(),
    skill: '',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  emit('chat-changed', { chat });
  return chat;
}

export function switchChat(id) {
  if (!getChat(id)) return;
  state.activeChatId = id;
  emit('chat-changed', { chat: getChat(id) });
}

export function deleteChat(id) {
  const index = state.chats.findIndex((c) => c.id === id);
  if (index === -1) return;
  state.chats.splice(index, 1);
  if (state.activeChatId === id) {
    state.activeChatId = state.chats[0]?.id || null;
    emit('chat-changed', { chat: getChat() });
  }
  scheduleChatSave();
  emit('chat-list-changed');
}

export function titleFrom(text) {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '新对话';
  return cleaned.length > 26 ? `${cleaned.slice(0, 26)}…` : cleaned;
}

export function persistChatsNow() {
  const payload = state.chats
    .filter((c) => Array.isArray(c.messages) && c.messages.length)
    .map((c) => ({
      id: c.id,
      title: c.title,
      mode: c.mode,
      skill: c.skill || '',
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messages: c.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ts: m.ts,
        tools: m.tools?.length ? m.tools : undefined,
        files: m.files?.length ? m.files : undefined,
        reasoning: m.reasoning || undefined,
        error: m.error || undefined,
        usage: m.usage || undefined,
        compressed: m.compressed || undefined,
        command: m.command || undefined,
        cwd: m.cwd || undefined,
        output: m.output || undefined,
        stderr: m.stderr || undefined,
        exitCode: Number.isInteger(m.exitCode) ? m.exitCode : undefined,
        status: m.status || undefined,
        review: m.review || undefined
      }))
    }));
  return window.dcb.saveChats(payload).catch(() => false);
}

export const scheduleChatSave = debounce(persistChatsNow, 450);
