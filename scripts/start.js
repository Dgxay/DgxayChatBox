'use strict';

/**
 * 开发启动脚本：兼容设置了 ELECTRON_RUN_AS_NODE 的终端环境，
 * 否则 Electron 会以纯 Node 模式运行，导致 app 未定义。
 */
const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env
});

child.on('close', (code) => process.exit(code ?? 0));
