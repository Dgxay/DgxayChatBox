'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const MAX_READ = 120000;
const MAX_OUTPUT = 24000;

const DEFINITIONS = {
  list_directory: {
    type: 'function',
    function: {
      name: 'list_directory',
      description:
        'List files and folders inside a directory. Use it to understand the workspace before reading or editing files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path, absolute or relative to the workspace. Defaults to workspace root.' },
          depth: { type: 'integer', description: 'How deep to recurse, 1-3. Default 1.' }
        },
        additionalProperties: false
      }
    }
  },
  read_file: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the text content of a file. Always read a file before modifying it.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, absolute or relative to the workspace.' }
        },
        required: ['path'],
        additionalProperties: false
      }
    }
  },
  write_file: {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Create or overwrite a file with the given content. Parent folders are created automatically. Generated files must stay inside the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path, preferably relative to the workspace.' },
          content: { type: 'string', description: 'Full file content to write.' }
        },
        required: ['path', 'content'],
        additionalProperties: false
      }
    }
  },
  create_directory: {
    type: 'function',
    function: {
      name: 'create_directory',
      description: 'Create a folder (including missing parents) inside the workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Folder path.' } },
        required: ['path'],
        additionalProperties: false
      }
    }
  },
  delete_path: {
    type: 'function',
    function: {
      name: 'delete_path',
      description: 'Delete a file or folder. Use with care and only when the user asked for it.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path to delete.' } },
        required: ['path'],
        additionalProperties: false
      }
    }
  },
  run_command: {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a shell command on the user machine and return stdout/stderr. Only available in full-permission mode.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command line to execute.' },
          cwd: { type: 'string', description: 'Working directory, defaults to the workspace.' }
        },
        required: ['command'],
        additionalProperties: false
      }
    }
  },
  fetch_url: {
    type: 'function',
    function: {
      name: 'fetch_url',
      description:
        'Fetch a URL over HTTP(S) and return the response body as text. Requires network permission from the user in normal mode.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL.' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method, default GET.' },
          body: { type: 'string', description: 'Optional request body (JSON or raw text).' }
        },
        required: ['url'],
        additionalProperties: false
      }
    }
  }
};

const PERMISSION_TOOLS = {
  none: ['list_directory', 'read_file'],
  normal: ['list_directory', 'read_file', 'write_file', 'create_directory', 'delete_path', 'fetch_url'],
  full: Object.keys(DEFINITIONS)
};

function toolsFor(permission) {
  const names = PERMISSION_TOOLS[permission] || PERMISSION_TOOLS.none;
  return names.map((name) => DEFINITIONS[name]);
}

function sameOrInside(root, target) {
  if (!root) return false;
  const rel = path.relative(root.toLowerCase(), target.toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveTarget(input, workspace) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('缺少路径参数');
  const base = workspace || os.homedir();
  return path.normalize(path.isAbsolute(raw) ? raw : path.resolve(base, raw));
}

function displayPath(abs, workspace) {
  if (workspace && sameOrInside(workspace, abs)) {
    const rel = path.relative(workspace, abs) || '.';
    return rel.split(path.sep).join('/');
  }
  return abs;
}

function assertReadable(target, ctx) {
  if (ctx.permission === 'none') {
    if (!ctx.workspace) throw new Error('当前为无权限模式且未选择工作空间，无法读取文件');
    if (!sameOrInside(ctx.workspace, target)) {
      throw new Error('无权限模式仅允许读取工作空间内的文件');
    }
  }
}

function assertWritable(target, ctx) {
  if (ctx.permission === 'none') throw new Error('当前为无权限模式，禁止修改文件');
  if (ctx.permission === 'normal') {
    if (!ctx.workspace) throw new Error('普通权限模式需要先选择工作空间');
    if (!sameOrInside(ctx.workspace, target)) {
      throw new Error('普通权限模式仅允许修改工作空间内的文件，拒绝写入外部路径');
    }
  }
  const roots = [
    path.parse(target).root,
    os.homedir(),
    ctx.workspace || ''
  ].filter(Boolean);
  for (const root of roots) {
    if (path.normalize(target).toLowerCase() === path.normalize(root).toLowerCase()) {
      throw new Error('拒绝对根目录执行删除或写入操作');
    }
  }
}

async function walkTree(dir, depth, prefix, acc, limit) {
  if (acc.length >= limit) return;
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    acc.push(`${prefix}[无法读取: ${err.code || err.message}]`);
    return;
  }
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const visible = entries.filter((e) => !e.name.startsWith('.') || e.name === '.dcb').slice(0, 80);
  for (const entry of visible) {
    if (acc.length >= limit) {
      acc.push(`${prefix}... (已截断)`);
      return;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      acc.push(`${prefix}${entry.name}/`);
      if (depth > 1) {
        await walkTree(full, depth - 1, `${prefix}  `, acc, limit);
      }
    } else {
      let size = 0;
      try {
        size = (await fsp.stat(full)).size;
      } catch {
        /* ignore */
      }
      acc.push(`${prefix}${entry.name}  (${size} B)`);
    }
  }
}

function truncate(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n... (输出已截断，共 ${text.length} 字符)`;
}

async function execute(name, args, ctx) {
  const permission = ctx.permission || 'none';
  const allowed = PERMISSION_TOOLS[permission] || [];
  if (!allowed.includes(name)) {
    throw new Error(`当前权限模式（${permission}）不允许调用工具 ${name}`);
  }
  const workspace = ctx.workspace || '';

  switch (name) {
    case 'list_directory': {
      const target = resolveTarget(args.path || '.', workspace);
      assertReadable(target, ctx);
      const stat = await fsp.stat(target);
      if (!stat.isDirectory()) throw new Error(`${displayPath(target, workspace)} 不是文件夹`);
      const acc = [`${displayPath(target, workspace)}/`];
      await walkTree(target, Math.min(Math.max(Number(args.depth) || 1, 1), 3), '  ', acc, 200);
      return acc.join('\n');
    }
    case 'read_file': {
      const target = resolveTarget(args.path, workspace);
      assertReadable(target, ctx);
      const stat = await fsp.stat(target);
      if (stat.isDirectory()) throw new Error('该路径是文件夹，请使用 list_directory');
      if (stat.size > 2 * 1024 * 1024) throw new Error('文件过大（>2MB），请使用终端命令处理');
      const content = await fsp.readFile(target, 'utf8');
      return `文件：${displayPath(target, workspace)}\n\n${truncate(content, MAX_READ)}`;
    }
    case 'write_file': {
      const target = resolveTarget(args.path, workspace);
      assertWritable(target, ctx);
      const content = typeof args.content === 'string' ? args.content : String(args.content ?? '');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      let action = 'created';
      try {
        await fsp.access(target);
        action = 'updated';
      } catch {
        /* new file */
      }
      await fsp.writeFile(target, content, 'utf8');
      const bytes = Buffer.byteLength(content, 'utf8');
      ctx.onFile?.({ action, path: target, display: displayPath(target, workspace), bytes });
      return `已${action === 'created' ? '创建' : '更新'}文件 ${displayPath(target, workspace)}（${bytes} 字节）`;
    }
    case 'create_directory': {
      const target = resolveTarget(args.path, workspace);
      assertWritable(target, ctx);
      await fsp.mkdir(target, { recursive: true });
      return `已创建文件夹 ${displayPath(target, workspace)}`;
    }
    case 'delete_path': {
      const target = resolveTarget(args.path, workspace);
      assertWritable(target, ctx);
      const stat = await fsp.stat(target);
      await fsp.rm(target, { recursive: stat.isDirectory(), force: false });
      ctx.onFile?.({ action: 'deleted', path: target, display: displayPath(target, workspace), bytes: 0 });
      return `已删除 ${displayPath(target, workspace)}`;
    }
    case 'run_command': {
      if (permission !== 'full') throw new Error('执行终端命令需要完全权限');
      const cwd = args.cwd ? resolveTarget(args.cwd, workspace) : workspace || os.homedir();
      const safeCwd = fs.existsSync(cwd) ? cwd : os.homedir();
      return await new Promise((resolve) => {
        exec(
          String(args.command || ''),
          { cwd: safeCwd, timeout: 180000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, shell: true },
          (err, stdout, stderr) => {
            const parts = [`$ ${args.command}`];
            if (stdout) parts.push(stdout.trim());
            if (stderr) parts.push(`[stderr]\n${stderr.trim()}`);
            if (err) parts.push(`[exit] code=${err.code ?? 'unknown'} ${err.killed ? '(超时或终止)' : ''}`);
            if (!stdout && !stderr && !err) parts.push('(无输出)');
            resolve(truncate(parts.join('\n\n'), MAX_OUTPUT));
          }
        );
      });
    }
    case 'fetch_url': {
      const url = String(args.url || '');
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error('URL 格式不正确');
      }
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('仅支持 http/https 协议');
      if (permission === 'none') throw new Error('无权限模式禁止联网');
      if (permission === 'normal') {
        const ok = await ctx.requestNetwork?.(url);
        if (!ok) throw new Error('用户拒绝了本次联网请求，请改用已有信息回答');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch(url, {
          method: (args.method || 'GET').toUpperCase(),
          headers: { 'User-Agent': 'Mozilla/5.0 DgxayChatBox/1.0', ...(args.body ? { 'Content-Type': 'application/json' } : {}) },
          body: args.body || undefined,
          signal: controller.signal
        });
        const text = await res.text();
        const contentType = res.headers.get('content-type') || '';
        return truncate(`HTTP ${res.status} ${res.statusText}\ncontent-type: ${contentType}\n\n${text}`, MAX_OUTPUT);
      } finally {
        clearTimeout(timer);
      }
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

module.exports = { toolsFor, execute, PERMISSION_TOOLS, DEFINITIONS };
