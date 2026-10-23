'use strict';

const path = require('path');
const fs = require('fs');
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

const isDev = process.argv.includes('--dev');
let mainWindow = null;

/** 网络授权：本次运行内的主机白名单 */
const sessionNetAllow = new Set();
const pendingPermissions = new Map();
const runningRequests = new Map();
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

function systemPromptFor({ mode, permission, workspace, customPrompt }) {
  const parts = [];
  parts.push(
    '你是 DgxayChatBox 桌面应用内置的 AI 助手。回答使用简体中文（除非用户使用其他语言），结构清晰，尽量简洁，合理使用 Markdown。'
  );
  if (customPrompt && String(customPrompt).trim()) {
    parts.push(`用户自定义指令：\n${String(customPrompt).trim()}`);
  }

  if (mode !== 'work') {
    parts.push('当前为「对话模式」：不提供文件系统与终端工具，直接通过文字回答用户。');
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
      '权限级别：普通权限。你可以读取并修改工作空间内的文件，禁止修改工作空间之外的任何文件。' +
        '使用 fetch_url 联网时会自动向用户发起授权请求，被拒绝时不要重试，改用已有信息回答。'
    );
  } else {
    parts.push(
      '权限级别：完全权限。你可以执行终端命令、访问任意文件、无限制联网。执行破坏性操作前请先向用户确认。'
    );
  }

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

function requestNetworkPermission(url) {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* ignore */
  }
  if (sessionNetAllow.has(host)) return Promise.resolve(true);

  const id = `perm_${++permissionSeq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingPermissions.delete(id);
      resolve(false);
    }, 120000);

    pendingPermissions.set(id, {
      resolve: (decision) => {
        clearTimeout(timer);
        if (decision === 'session') sessionNetAllow.add(host);
        resolve(decision !== 'deny');
      }
    });

    broadcast('permission:request', {
      id,
      kind: 'network',
      host,
      url,
      title: 'AI 请求联网访问',
      detail: `目标地址：${url}`
    });
  });
}

ipcMain.handle('app:init', () => {
  const config = cfg.readConfig();
  return {
    config,
    hasDir: cfg.hasDcbDir(),
    onboarded: Boolean(config.onboarded && config.providers?.length),
    version: app.getVersion(),
    platform: process.platform,
    paths: { dataDir: cfg.DCB_DIR, config: cfg.CONFIG_PATH },
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

ipcMain.handle('shortcut:status', () => ({
  registered: Boolean(currentGlobalShortcut),
  accelerator: currentGlobalShortcut || ''
}));

ipcMain.handle('permission:respond', (_event, { id, decision }) => {
  const pending = pendingPermissions.get(id);
  if (pending) {
    pendingPermissions.delete(id);
    pending.resolve(decision);
  }
  return true;
});

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
  const toolDefs = useTools ? tools.toolsFor(permission) : [];

  const apiMessages = [
    {
      role: 'system',
      content: systemPromptFor({
        mode,
        permission,
        workspace,
        customPrompt: config.chat?.systemPrompt
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
          try {
            const args = call.function.arguments?.trim() ? JSON.parse(call.function.arguments) : {};
            output = await tools.execute(name, args, {
              permission,
              workspace,
              requestNetwork: requestNetworkPermission,
              onFile: (file) => {
                files.push(file);
                emit('file', file);
              }
            });
          } catch (err) {
            ok = false;
            output = `Error: ${err.message}`;
          }
          const logItem = { id: toolId, name, args: call.function.arguments, ok, output, at: Date.now() };
          toolLog.push(logItem);
          emit('tool', { id: toolId, name, status: ok ? 'ok' : 'error', output: output.slice(0, 4000) });
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
  globalShortcut.unregisterAll();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
