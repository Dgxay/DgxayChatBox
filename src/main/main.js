'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  globalShortcut,
  Menu,
  nativeTheme
} = require('electron');

const cfg = require('./config');
const { streamChat, listModels } = require('./llm');
const tools = require('./tools');
const mcp = require('./mcp');
const skills = require('./skills');

const isDev = process.argv.includes('--dev');
let mainWindow = null;

const pendingPermissions = new Map();
const runningRequests = new Map();
const terminalProcesses = new Map();
let permissionSeq = 0;
let currentGlobalShortcut = null;

app.setAppUserModelId('com.dgxay.chatbox');

// 截图/无 GPU 的测试环境需要关闭硬件加速，正式运行保持默认
if (process.env.DCB_SHOT || process.env.DCB_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('in-process-gpu');
  app.commandLine.appendSwitch('no-sandbox');
}

function createWindow() {
  const iconPath = path.join(__dirname, '../renderer/assets/icon.png');
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 660,
    show: false,
    frame: process.platform === 'darwin',
    backgroundColor: '#F7F4EE',
    title: 'DgxayChatBox',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    trafficLightPosition: { x: 16, y: 18 },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      webviewTag: false
    }
  });

  if (process.platform === 'darwin') {
    // macOS 需要最小菜单来支持 Cmd+Q / Cmd+C / 窗口管理
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
    );
  } else {
    Menu.setApplicationMenu(null);
  }

  if (isDev || process.env.DCB_SHOT) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
    mainWindow.webContents.on('did-fail-load', (_event, code, desc) => {
      console.error('[load:failed]', code, desc);
    });
  }

  if (process.env.DCB_SHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (process.env.DCB_SHOT_JS) {
            await mainWindow.webContents.executeJavaScript(process.env.DCB_SHOT_JS);
            await new Promise((resolve) => setTimeout(resolve, Number(process.env.DCB_SHOT_DELAY || 900)));
          }
          const image = await mainWindow.webContents.capturePage();
          const target = path.resolve(process.env.DCB_SHOT);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, image.toPNG());
          console.log('[shot] saved', target);
        } catch (err) {
          console.error('[shot] failed', err);
        }
        app.quit();
      }, 1400);
    });
  }

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  const sendMaxState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:state', { maximized: mainWindow.isMaximized() });
  };
  mainWindow.on('maximize', sendMaxState);
  mainWindow.on('unmaximize', sendMaxState);
  mainWindow.on('enter-full-screen', sendMaxState);
  mainWindow.on('leave-full-screen', sendMaxState);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function applyGlobalShortcut() {
  const config = cfg.readConfig();
  const accel = config.advanced?.globalShortcut;
  const enabled = Boolean(config.advanced?.globalShortcutEnabled);

  if (currentGlobalShortcut) {
    try {
      globalShortcut.unregister(currentGlobalShortcut);
    } catch {
      /* ignore */
    }
    currentGlobalShortcut = null;
  }
  if (!enabled || !accel) return { ok: true, registered: false };

  try {
    const ok = globalShortcut.register(accel, () => {
      if (!mainWindow) return createWindow();
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    if (ok) currentGlobalShortcut = accel;
    return { ok, registered: ok };
  } catch (err) {
    return { ok: false, registered: false, error: err.message };
  }
}

function systemPromptFor({ mode, permission, workspace, customPrompt, skill }) {
  const parts = [];
  parts.push(
    '你是 DgxayChatBox 桌面应用内置的 AI 助手。回答使用简体中文（除非用户使用其他语言），结构清晰，尽量简洁，合理使用 Markdown。'
  );
  if (skill?.content) {
    parts.push(`【本对话启用的技能：${skill.name}】\n${skill.content}`);
  }
  if (customPrompt && String(customPrompt).trim()) {
    parts.push(`用户自定义指令：\n${String(customPrompt).trim()}`);
  }

  if (mode !== 'work') {
    parts.push('当前为「对话模式」：不提供文件系统与终端工具，直接通过文字回答用户。');
    if (permission !== 'none') {
      parts.push(
        '如果用户明确要求安装 MCP server，可以调用 install_mcp_server 保存启动配置，并提示用户前往「设置 → MCP」启动。'
      );
    }
    return parts.join('\n\n');
  }

  parts.push(`当前为「工作模式」。工作空间目录：${workspace || '（尚未选择）'}。`);
  if (permission === 'none') {
    parts.push(
      '权限级别：无权限。你只能以只读方式访问工作空间内的文件，禁止修改/创建/删除文件，禁止联网，禁止执行命令。' +
        '如果用户要求写入文件、联网或执行命令，请说明需要切换到「普通权限」或「完全权限」。'
    );
  } else if (permission === 'normal') {
    parts.push(
      '权限级别：普通权限。你拥有全部能力：可以读写任意文件、执行终端命令、访问网络。' +
        '但每一次工具调用都会先由自动审查模型判断风险，可疑操作会转交用户确认；如果用户拒绝，不要重试，改用已经获得的信息回答。'
    );
  } else {
    parts.push(
      '权限级别：完全权限。你可以执行终端命令、访问任意文件、无限制联网，不再经过审查或询问。执行破坏性操作前请先向用户确认。'
    );
  }

  parts.push(
    '安装 MCP：如果用户明确要求安装 MCP server，调用 install_mcp_server 保存启动配置，完成后提示用户前往「设置 → MCP」点击启动。不要伪造安装结果。'
  );

  if (workspace) {
    parts.push(
      [
        '工作模式规则：',
        '1. 需要查看或修改文件时，必须调用工具，不要凭空假设文件内容；修改前先 read_file。',
        '2. 所有生成的文件必须保存到工作空间内，优先使用相对路径。',
        '3. 完成任务后用简短的中文总结你创建/修改了哪些文件。'
      ].join('\n')
    );
  } else {
    parts.push('尚未选择工作空间时，请不要调用任何文件工具，提示用户先在工作空间列表中选择文件夹。');
  }
  return parts.join('\n\n');
}

function normalizeHistory(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
}

const REVIEW_SYSTEM = [
  '你是 DgxayChatBox 的本机操作安全审查模型。AI 助手在获得用户授权前，由你判断一次操作是否可能伤害用户的电脑或泄露数据。',
  '只输出 JSON，不要代码块：{"decision":"allow","reason":"..."} 或 {"decision":"review","reason":"..."}',
  'allow 适用于：读取与任务直接相关的文件、在工作空间内写入普通文本文件、查看目录、执行只读查询、访问公开文档。',
  'review 适用于：删除或覆盖重要文件、修改工作空间外的系统/用户目录、安装/卸载/提权/服务/批量脚本、访问 .ssh/.env/密钥/浏览器数据、上传本地数据到外部、命令或目标不明确、可能不可逆。',
  '不确定时选择 review。理由用简体中文，不超过 60 字。'
].join('\n');

function summarizeArgs(args) {
  if (args == null) return '';
  if (typeof args !== 'object') return String(args).slice(0, 1800);
  const copy = { ...args };
  if (typeof copy.content === 'string' && copy.content.length > 1200) {
    copy.content = `${copy.content.slice(0, 1200)}…（共 ${copy.content.length} 字符）`;
  }
  let text = JSON.stringify(copy);
  if (text.length > 2000) text = `${text.slice(0, 2000)}…`;
  return text;
}

function resolveReviewer(config, providerId) {
  const usable = (provider) =>
    Boolean(
      provider?.reviewModelId &&
        Array.isArray(provider.models) &&
        provider.models.some((model) => model.id === provider.reviewModelId)
    );
  const own = (config.providers || []).find((provider) => provider.id === providerId);
  if (usable(own)) return { provider: own, modelId: own.reviewModelId, source: 'own' };
  const fallback = (config.providers || [])[0];
  if (usable(fallback)) return { provider: fallback, modelId: fallback.reviewModelId, source: 'default' };
  return null;
}

async function reviewOperation({ config, providerId, kind, name, args, command, workspace }) {
  const reviewer = resolveReviewer(config, providerId);
  if (!reviewer) {
    return {
      decision: 'review',
      reason: '尚未配置自动审查模型，需要你确认',
      reviewer: null,
      modelId: null
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const result = await streamChat({
      protocol: reviewer.provider.protocol || 'openai',
      baseUrl: reviewer.provider.baseUrl,
      apiKey: reviewer.provider.apiKey,
      model: reviewer.modelId,
      messages: [
        { role: 'system', content: REVIEW_SYSTEM },
        {
          role: 'user',
          content: [
            `操作类型：${kind === 'terminal' ? '终端命令' : '工具调用'}`,
            `操作名称：${name}`,
            command ? `命令：${command}` : '',
            `工作空间：${workspace || '（未选择）'}`,
            args ? `参数：${summarizeArgs(args)}` : '',
            '请判断这次操作是否安全。'
          ]
            .filter(Boolean)
            .join('\n')
        }
      ],
      stream: false,
      temperature: 0,
      maxTokens: 320,
      signal: controller.signal
    });

    const text = String(result.content || '').trim();
    let decision = 'review';
    let reason = text.slice(0, 160) || '审查模型未给出结论';
    const left = text.indexOf('{');
    const right = text.lastIndexOf('}');
    if (left !== -1 && right > left) {
      try {
        const parsed = JSON.parse(text.slice(left, right + 1));
        if (String(parsed.decision || '').toLowerCase() === 'allow') decision = 'allow';
        if (parsed.reason) reason = String(parsed.reason).slice(0, 200);
      } catch {
        /* keep review */
      }
    }
    return {
      decision,
      reason,
      reviewer: reviewer.provider.name,
      modelId: reviewer.modelId,
      source: reviewer.source
    };
  } catch (err) {
    return {
      decision: 'review',
      reason: `自动审查失败：${err.message}`,
      reviewer: reviewer.provider.name,
      modelId: reviewer.modelId,
      source: reviewer.source
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeOperation({ kind, name, args, command }) {
  const lines = [];
  if (kind === 'terminal') {
    lines.push(`命令：${command || ''}`);
    return lines.join('\n');
  }
  lines.push(`工具：${name}`);
  if (args?.path) lines.push(`路径：${args.path}`);
  if (args?.url) lines.push(`地址：${args.url}`);
  if (args?.command) lines.push(`命令：${args.command}`);
  if (args?.name) lines.push(`名称：${args.name}`);
  const body = summarizeArgs(args);
  if (body && body !== '{}') lines.push(`参数：${body}`);
  return lines.join('\n');
}

function askUserApproval(payload) {
  const id = `perm_${++permissionSeq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingPermissions.delete(id);
      resolve({ allow: false, reason: '等待确认超时' });
    }, 180000);

    pendingPermissions.set(id, {
      resolve: (decision) => {
        clearTimeout(timer);
        resolve({
          allow: decision === 'allow',
          reason: decision === 'allow' ? '' : '用户拒绝了该操作'
        });
      }
    });

    broadcast('permission:request', { id, ...payload });
  });
}

async function requestOperationApproval({
  kind,
  name,
  args,
  command,
  workspace,
  permission,
  providerId,
  toolId,
  notify
}) {
  if (permission === 'full') return { allow: true, source: 'full', review: null };
  if (permission !== 'normal') {
    return { allow: false, source: 'none', review: null, reason: '当前权限禁止该操作' };
  }

  const config = cfg.readConfig();
  notify?.({ type: 'review-start', toolId, name, kind });
  const review = await reviewOperation({
    config,
    providerId: providerId || config.activeProviderId,
    kind,
    name,
    args,
    command,
    workspace
  });
  notify?.({
    type: 'review',
    toolId,
    name,
    kind,
    decision: review.decision,
    reason: review.reason,
    reviewer: review.reviewer,
    modelId: review.modelId
  });

  if (review.decision === 'allow') {
    return { allow: true, source: 'auto', review };
  }

  const user = await askUserApproval({
    kind,
    title: kind === 'terminal' ? 'AI 请求执行终端命令' : 'AI 请求执行操作',
    operation: name,
    detail: describeOperation({ kind, name, args, command }),
    command: command || '',
    workspace: workspace || '',
    review: review.reason,
    reviewer: review.reviewer,
    reviewModel: review.modelId
  });

  return { allow: user.allow, source: 'user', review, reason: user.reason };
}

ipcMain.handle('app:init', () => {
  const config = cfg.readConfig();
  return {
    config,
    hasDir: cfg.hasDcbDir(),
    onboarded: Boolean(config.onboarded && config.providers?.length),
    version: app.getVersion(),
    platform: process.platform,
    paths: { dataDir: cfg.DCB_DIR, config: cfg.CONFIG_PATH, mcp: cfg.MCP_PATH, skills: cfg.SKILLS_DIR },
    darkMode: nativeTheme.shouldUseDarkColors
  };
});

ipcMain.handle('config:get', () => cfg.readConfig());

ipcMain.handle('config:save', (_event, patch) => {
  const before = cfg.readConfig();
  const next = cfg.saveConfig(patch || {});
  const shortcutChanged =
    before.advanced?.globalShortcut !== next.advanced?.globalShortcut ||
    before.advanced?.globalShortcutEnabled !== next.advanced?.globalShortcutEnabled;
  if (shortcutChanged) applyGlobalShortcut();
  return next;
});

ipcMain.handle('config:reset', () => {
  const fresh = cfg.resetConfig();
  applyGlobalShortcut();
  return fresh;
});

ipcMain.handle('config:openFolder', async () => {
  cfg.ensureDir();
  return shell.openPath(cfg.DCB_DIR);
});

ipcMain.handle('chats:load', () => cfg.loadChats());
ipcMain.handle('chats:save', (_event, chats) => cfg.saveChats(chats));

ipcMain.handle('dialog:pickFolder', async (_event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择工作空间文件夹',
    defaultPath: defaultPath || cfg.readConfig().work?.workspace || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '选择此文件夹'
  });
  if (result.canceled || !result.filePaths?.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('shell:openPath', async (_event, target) => {
  if (typeof target !== 'string' || !target) return 'invalid';
  if (/^https?:/i.test(target)) {
    await shell.openExternal(target);
    return '';
  }
  return shell.openPath(target);
});

ipcMain.handle('shell:showItem', (_event, target) => {
  if (typeof target === 'string' && target) shell.showItemInFolder(target);
  return true;
});

ipcMain.handle('models:fetch', async (_event, { baseUrl, apiKey, protocol }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    return await listModels({ baseUrl, apiKey, protocol, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle('chat:compress', async (_event, payload = {}) => {
  const config = cfg.readConfig();
  const provider = config.providers.find((item) => item.id === payload.providerId) || config.providers[0];
  const modelId = payload.modelId || provider?.models?.[0]?.id;
  if (!provider || !modelId) throw new Error('没有可用模型，无法压缩上下文');

  const history = normalizeHistory(payload.messages);
  if (!history.length) return { ok: true, summary: '', usage: null };

  const transcript = history
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
    .join('\n\n')
    .slice(-150000);

  const result = await streamChat({
    protocol: provider.protocol || 'openai',
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: modelId,
    messages: [
      {
        role: 'system',
        content:
          '你是上下文压缩器。把长对话压缩成一份可供后续继续工作的摘要。只输出摘要正文，不要寒暄，不要代码块围栏。'
      },
      {
        role: 'user',
        content:
          '请压缩下面的对话。必须保留：用户目标与偏好、关键事实与数字、已做出的决定、涉及的文件路径与代码位置、未完成事项、重要工具结果。删除寒暄、重复解释和无关内容。用简体中文输出，控制在 800 字以内。\n\n' +
          transcript
      }
    ],
    stream: false,
    temperature: 0.2,
    maxTokens: Math.min(2048, Number(config.chat?.maxTokens) || 2048)
  });

  const summary = String(result.content || '').trim();
  if (!summary) throw new Error('模型没有返回摘要，请稍后重试');
  return { ok: true, summary, usage: result.usage || null };
});

ipcMain.handle('mcp:list', () => mcp.listServers());
ipcMain.handle('mcp:add', (_event, input) => mcp.addServer(input || {}));
ipcMain.handle('mcp:remove', (_event, id) => {
  mcp.removeServer(id);
  return mcp.listServers();
});
ipcMain.handle('mcp:start', (_event, id) => mcp.startServer(id));
ipcMain.handle('mcp:stop', (_event, id) => {
  mcp.stopServer(id);
  return true;
});
ipcMain.handle('mcp:logs', (_event, id) => mcp.statusOf(id).logs || []);

function killProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      if (!child.killed) child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }, 2000).unref?.();
}

function runTerminalCommand({ requestId, command, cwd, emit }) {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const shellCommand = isWindows ? `chcp 65001>nul & ${command}` : command;
    let child;
    try {
      child = spawn(shellCommand, {
        cwd,
        shell: true,
        windowsHide: true,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      emit('error', { message: err.message });
      resolve({ ok: false, error: err.message });
      return;
    }

    terminalProcesses.set(requestId, { child });
    emit('start', { command, cwd, pid: child.pid });

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let total = 0;
    let truncated = false;
    let finished = false;

    const flush = () => {
      if (stdoutBuffer) {
        emit('output', { text: stdoutBuffer, stream: 'stdout' });
        stdoutBuffer = '';
      }
      if (stderrBuffer) {
        emit('output', { text: stderrBuffer, stream: 'stderr' });
        stderrBuffer = '';
      }
    };
    const timer = setInterval(flush, 60);

    const push = (stream, chunk) => {
      const text = chunk.toString('utf8').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
      total += text.length;
      if (total > 300000) {
        if (!truncated) {
          truncated = true;
          stderrBuffer += '\n…（输出过长，已截断）\n';
        }
        return;
      }
      if (stream === 'stderr') stderrBuffer += text;
      else stdoutBuffer += text;
    };

    child.stdout?.on('data', (chunk) => push('stdout', chunk));
    child.stderr?.on('data', (chunk) => push('stderr', chunk));

    const finish = (code, signal) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      flush();
      terminalProcesses.delete(requestId);
      emit('exit', { code, signal, aborted: signal === 'SIGTERM' || signal === 'SIGKILL' });
      resolve({ ok: true, code, signal });
    };

    child.on('error', (err) => {
      emit('error', { message: err.message });
      finish(-1, null);
    });
    child.on('exit', (code, signal) => finish(code, signal));

    const timeout = setTimeout(() => {
      emit('output', { text: '\n…（命令执行超过 5 分钟，已终止）\n', stream: 'stderr' });
      killProcessTree(child);
    }, 300000);
    child.on('exit', () => clearTimeout(timeout));
  });
}

ipcMain.handle('terminal:run', async (event, payload = {}) => {
  const requestId = String(payload.requestId || `term_${Date.now()}`);
  const config = cfg.readConfig();
  const permission = ['none', 'normal', 'full'].includes(config.ui?.permission)
    ? config.ui.permission
    : 'normal';
  const command = String(payload.command || '').trim();
  const emit = (type, data = {}) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('terminal:event', { requestId, type, ...data });
    }
  };

  if (!command) {
    emit('error', { message: '命令不能为空' });
    return { ok: false, error: 'empty command' };
  }
  if (permission === 'none') {
    emit('error', { message: '无权限模式禁止执行终端命令' });
    return { ok: false, denied: true };
  }

  let workspace = typeof payload.workspace === 'string' ? payload.workspace : config.work?.workspace || '';
  if (workspace) {
    try {
      if (!fs.statSync(workspace).isDirectory()) workspace = '';
    } catch {
      workspace = '';
    }
  }
  const cwd = workspace || os.homedir();

  if (permission === 'normal') {
    const approval = await requestOperationApproval({
      kind: 'terminal',
      name: 'run_terminal',
      command,
      workspace,
      permission,
      providerId: config.activeProviderId,
      notify: (approvalEvent) => emit('approval', approvalEvent)
    });
    if (!approval.allow) {
      emit('error', { message: approval.reason || '已拒绝执行该命令', denied: true });
      return { ok: false, denied: true, review: approval.review };
    }
    emit('approved', { source: approval.source, review: approval.review });
  }

  return runTerminalCommand({ requestId, command, cwd, emit });
});

ipcMain.handle('terminal:abort', (_event, requestId) => {
  const entry = terminalProcesses.get(String(requestId));
  if (!entry?.child) return false;
  killProcessTree(entry.child);
  return true;
});

ipcMain.handle('shortcut:status', () => ({
  registered: Boolean(currentGlobalShortcut),
  accelerator: currentGlobalShortcut || ''
}));

ipcMain.handle('permission:respond', (_event, { id, decision }) => {
  const pending = pendingPermissions.get(id);
  if (pending) {
    pendingPermissions.delete(id);
    pending.resolve(decision === 'allow' ? 'allow' : 'deny');
  }
  return true;
});

ipcMain.handle('skills:list', () => skills.listSkills());

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

ipcMain.handle('chat:abort', (_event, requestId) => {
  const controller = runningRequests.get(requestId);
  if (controller) {
    controller.abort();
    runningRequests.delete(requestId);
    return true;
  }
  return false;
});

ipcMain.handle('chat:send', async (event, payload = {}) => {
  const config = cfg.readConfig();
  const requestId = String(payload.requestId || `req_${Date.now()}`);
  const provider = config.providers.find((p) => p.id === payload.providerId);
  if (!provider) throw new Error('未找到对应的供应商，请到设置中检查配置');

  const modelId =
    payload.modelId || provider.models?.find((m) => m.id === config.activeModelId)?.id || provider.models?.[0]?.id;
  if (!modelId) throw new Error('该供应商下没有可用模型，请先在设置中添加模型');

  const mode = payload.mode === 'work' ? 'work' : 'chat';
  const permission = ['none', 'normal', 'full'].includes(payload.permission) ? payload.permission : 'normal';
  let workspace = typeof payload.workspace === 'string' ? payload.workspace.trim() : '';
  if (workspace) {
    try {
      const stat = await fs.promises.stat(workspace);
      if (!stat.isDirectory()) workspace = '';
    } catch {
      workspace = '';
    }
  }

  const useTools = mode === 'work' && Boolean(workspace);
  let toolDefs = [];
  if (useTools) toolDefs = tools.toolsFor(permission);
  else if (permission !== 'none') toolDefs = [tools.DEFINITIONS.install_mcp_server];
  const skillName = typeof payload.skill === 'string' ? payload.skill.trim() : '';
  const activeSkill = skillName ? skills.readSkill(skillName) : null;

  const apiMessages = [
    {
      role: 'system',
      content: systemPromptFor({
        mode,
        permission,
        workspace,
        customPrompt: config.chat?.systemPrompt,
        skill: activeSkill
      })
    },
    ...normalizeHistory(payload.messages)
  ];

  const controller = new AbortController();
  runningRequests.set(requestId, controller);

  const emit = (type, data = {}) => {
    if (event.sender.isDestroyed()) return;
    event.sender.send('chat:event', { requestId, type, ...data });
  };

  const settings = config.chat || {};
  let finalText = '';
  let reasoningText = '';
  let totalUsage = null;
  const toolLog = [];
  const files = [];
  let aborted = false;

  try {
    for (let step = 0; step < 8; step += 1) {
      emit('status', { text: step === 0 ? '正在生成' : '正在继续处理' });
      const result = await streamChat({
        protocol: provider.protocol || 'openai',
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: modelId,
        messages: apiMessages,
        tools: toolDefs,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        stream: settings.stream !== false,
        signal: controller.signal,
        onDelta: (text) => {
          finalText += text;
          emit('delta', { text });
        },
        onReasoning: (text) => {
          reasoningText += text;
          emit('reasoning', { text });
        }
      });

      if (result.usage) totalUsage = result.usage;

      if (Array.isArray(result.toolCalls) && result.toolCalls.length) {
        const calls = result.toolCalls
          .filter((call) => call?.function?.name)
          .map((call, index) => ({
            id: call.id || `call_${step}_${index}`,
            type: 'function',
            function: { name: call.function.name, arguments: call.function.arguments || '{}' }
          }));
        if (!calls.length) break;

        apiMessages.push({
          role: 'assistant',
          content: result.content || null,
          tool_calls: calls
        });

        for (const call of calls) {
          const toolId = `t_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
          const name = call.function.name;
          emit('tool', { id: toolId, name, status: 'running', args: call.function.arguments });
          let output = '';
          let ok = true;
          let lastReview = null;
          try {
            const args = call.function.arguments?.trim() ? JSON.parse(call.function.arguments) : {};
            const requestApproval = async (operation) => {
              const result = await requestOperationApproval({
                kind: 'tool',
                name: operation.name,
                args: operation.args,
                workspace,
                permission,
                providerId: provider.id,
                toolId,
                notify: (approvalEvent) => emit(approvalEvent.type, approvalEvent)
              });
              lastReview = result;
              return result.allow;
            };
            output = await tools.execute(name, args, {
              permission,
              workspace,
              requestApproval,
              onFile: (file) => {
                files.push(file);
                emit('file', file);
              }
            });
          } catch (err) {
            ok = false;
            output = `Error: ${err.message}`;
          }
          const logItem = {
            id: toolId,
            name,
            args: call.function.arguments,
            ok,
            output,
            review: lastReview
              ? {
                  source: lastReview.allow ? lastReview.source : 'denied',
                  decision: lastReview.review?.decision || (lastReview.allow ? 'allow' : 'review'),
                  reason: lastReview.review?.reason || lastReview.reason || ''
                }
              : undefined,
            at: Date.now()
          };
          toolLog.push(logItem);
          emit('tool', {
            id: toolId,
            name,
            status: ok ? 'ok' : 'error',
            output: output.slice(0, 4000),
            review: logItem.review
          });
          apiMessages.push({ role: 'tool', tool_call_id: call.id, content: output });
        }
        if (finalText) {
          finalText += '\n\n';
          emit('delta', { text: '\n\n' });
        }
        continue;
      }

      break;
    }

    emit('done', { text: finalText, usage: totalUsage });
    return {
      ok: true,
      requestId,
      text: finalText,
      reasoning: reasoningText,
      usage: totalUsage,
      toolLog,
      files
    };
  } catch (err) {
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      aborted = true;
      emit('aborted', {});
      return {
        ok: false,
        aborted: true,
        requestId,
        text: finalText,
        reasoning: reasoningText,
        usage: totalUsage,
        toolLog,
        files
      };
    }
    emit('error', { message: err.message });
    return {
      ok: false,
      requestId,
      error: err.message,
      text: finalText,
      reasoning: reasoningText,
      usage: totalUsage,
      toolLog,
      files
    };
  } finally {
    runningRequests.delete(requestId);
    emit('end', { aborted });
  }
});

app.whenReady().then(() => {
  mcp.setNotifier((payload) => broadcast('mcp:event', payload));
  createWindow();
  applyGlobalShortcut();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  for (const entry of terminalProcesses.values()) {
    killProcessTree(entry.child);
  }
  terminalProcesses.clear();
  mcp.killAll();
  globalShortcut.unregisterAll();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
