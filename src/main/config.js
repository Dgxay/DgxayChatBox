'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 数据目录：%USERPROFILE%\.dcb（Windows）或 ~/.dcb（macOS / Linux）
 * 支持 DCB_HOME 环境变量，便于开发调试，不影响正式安装包行为。
 */
const DCB_DIR = process.env.DCB_HOME
  ? path.resolve(process.env.DCB_HOME)
  : path.join(os.homedir(), '.dcb');
const CONFIG_PATH = path.join(DCB_DIR, 'config.json');
const CHATS_PATH = path.join(DCB_DIR, 'chats.json');

const DEFAULT_CONFIG = {
  version: 1,
  onboarded: false,
  providers: [],
  activeProviderId: '',
  activeModelId: '',
  ui: {
    mode: 'chat',
    permission: 'normal',
    accent: 'coral',
    fontScale: 1,
    showSidebar: true
  },
  work: {
    workspace: '',
    recentWorkspaces: []
  },
  chat: {
    stream: true,
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: '',
    enterToSend: true
  },
  shortcuts: {
    newChat: 'Ctrl+N',
    settings: 'Ctrl+,',
    toggleMode: 'Ctrl+Shift+M',
    focusInput: 'Ctrl+L'
  },
  advanced: {
    globalShortcutEnabled: false,
    globalShortcut: 'Ctrl+Shift+Space'
  },
  meta: {
    createdAt: null,
    updatedAt: null
  }
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function ensureDir() {
  if (!fs.existsSync(DCB_DIR)) {
    fs.mkdirSync(DCB_DIR, { recursive: true, mode: 0o700 });
  }
}

function hasDcbDir() {
  try {
    return fs.existsSync(DCB_DIR);
  } catch {
    return false;
  }
}

function readConfig() {
  const base = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!fs.existsSync(CONFIG_PATH)) {
    return base;
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const merged = deepMerge(base, parsed);
    merged.meta = {
      ...merged.meta,
      createdAt: merged.meta?.createdAt || new Date().toISOString(),
      updatedAt: merged.meta?.updatedAt || new Date().toISOString()
    };
    return merged;
  } catch (err) {
    // 配置损坏时备份，避免用户数据被直接覆盖丢失
    try {
      const backup = `${CONFIG_PATH}.broken-${Date.now()}`;
      fs.copyFileSync(CONFIG_PATH, backup);
    } catch {
      /* ignore */
    }
    return base;
  }
}

function writeJsonAtomic(target, data, mode = 0o600) {
  ensureDir();
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode });
  fs.renameSync(tmp, target);
}

function saveConfig(patch) {
  const current = readConfig();
  const next = deepMerge(current, patch || {});
  const now = new Date().toISOString();
  next.meta = {
    createdAt: next.meta?.createdAt || now,
    updatedAt: now
  };
  writeJsonAtomic(CONFIG_PATH, next);
  return next;
}

function resetConfig() {
  const fresh = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  fresh.meta.createdAt = new Date().toISOString();
  fresh.meta.updatedAt = fresh.meta.createdAt;
  writeJsonAtomic(CONFIG_PATH, fresh);
  return fresh;
}

function loadChats() {
  try {
    if (!fs.existsSync(CHATS_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(CHATS_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveChats(chats) {
  try {
    writeJsonAtomic(CHATS_PATH, Array.isArray(chats) ? chats.slice(0, 200) : []);
    return true;
  } catch {
    return false;
  }
}

function maskKey(key) {
  if (!key) return '';
  const str = String(key);
  if (str.length <= 8) return '••••••••';
  return `${str.slice(0, 3)}••••••${str.slice(-4)}`;
}

module.exports = {
  DCB_DIR,
  CONFIG_PATH,
  CHATS_PATH,
  DEFAULT_CONFIG,
  deepMerge,
  hasDcbDir,
  readConfig,
  saveConfig,
  resetConfig,
  loadChats,
  saveChats,
  ensureDir,
  maskKey
};
