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
const MCP_PATH = path.join(DCB_DIR, 'mcp.json');
const SKILLS_DIR = path.join(DCB_DIR, 'skills');
const OAUTH_PATH = path.join(DCB_DIR, 'oauth.json');

const DEFAULT_CONFIG = {
  version: 1,
  onboarded: false,
  providers: [],
  activeProviderId: '',
  activeModelId: '',
  ui: {
    mode: 'chat',
    permission: 'normal',
    accent: 'blue',
    theme: 'dark',
    fontScale: 1,
    showSidebar: true
  },
  // Agent 仅在工作模式下注入系统提示；builtin 为 true 的条目不允许删除
  agents: [
    {
      id: 'agent-planner',
      name: '规划者',
      desc: '先拆解任务，再动手',
      prompt:
        '收到目标后先拆成可验证的步骤，说明每一步要读写的文件或命令，再按顺序执行；遇到不确定的信息先读文件核对，不要凭印象假设。',
      builtin: true
    },
    {
      id: 'agent-engineer',
      name: '工程师',
      desc: '最小改动，保证可运行',
      prompt:
        '动手前先读现有实现与项目约定，优先最小改动而不是重写；代码要能直接运行，改完自查语法、边界条件与调用方。',
      builtin: true
    },
    {
      id: 'agent-reviewer',
      name: '审查者',
      desc: '挑错优先于完成',
      prompt:
        '以审查视角检查每一步产出：正确性、安全性、边界条件、遗漏项。发现问题立即指出并给出修复方案，不要为了让任务“看起来完成”而忽略风险。',
      builtin: true
    },
    {
      id: 'agent-writer',
      name: '文档写手',
      desc: '结构化中文输出',
      prompt:
        '输出结构清晰的中文内容，先给结论再给细节；保留关键文件路径、命令与参数，避免空话和重复描述。',
      builtin: true
    }
  ],
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
    // 旧版本使用珊瑚色作为主题色，现统一为蓝色（V1.2 之前的配置读取时自动迁移）
    if (!merged.ui) merged.ui = { ...base.ui };
    if (!merged.ui.accent || merged.ui.accent === 'coral') merged.ui.accent = 'blue';
    // 默认主题改为深色：旧配置里由旧默认写入的 system 只迁移一次，之后用户仍可自行改回
    if (merged.ui.theme === 'system' && !merged.ui.themeMigrated) {
      merged.ui.theme = 'dark';
    }
    merged.ui.themeMigrated = true;
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
  MCP_PATH,
  SKILLS_DIR,
  OAUTH_PATH,
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
