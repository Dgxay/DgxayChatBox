# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

DgxayCode 是一个 Electron 32 桌面 AI 工作台：本地优先，支持三种 LLM 协议、工作模式的工具调用、四档权限审查、OAuth 登录与 MCP 进程管理。前端是原生 HTML/CSS/ES Modules，**没有构建步骤**。`NOTES.md` 是更详细的中文避坑手册（权限边界、OAuth、打包、已知限制），改动相关模块前应查阅。

## 常用命令

安装依赖（国内网络建议带镜像）：

```bash
npm install
```

启动应用 / 带开发者工具启动：

```bash
npm start
npm run dev
```

必须走这两个脚本：`scripts/start.js` 会先删除 `ELECTRON_RUN_AS_NODE` 再 spawn Electron。直接 `npx electron .` 在设置了该变量的终端里会以纯 Node 模式运行并报 `app is not defined`。

语法检查：

```bash
node --check src/main/main.js          # 主进程 / preload / scripts 直接检查（CommonJS）
for f in src/renderer/js/*.js; do cp "$f" "/tmp/$(basename "$f" .js).mjs"; node --check "/tmp/$(basename "$f" .js).mjs"; done
```

```powershell
Get-ChildItem src/renderer/js/*.js | ForEach-Object { Copy-Item $_ "$env:TEMP\$($_.BaseName).mjs" -Force; node --check "$env:TEMP\$($_.BaseName).mjs" }
```

渲染层是 ESM，`node --check` 需要先复制成 `.mjs`。仓库没有单元测试框架、没有 `npm test`，验证方式是启动应用手动测试，具体矩阵见 `NOTES.md` 第 12 节。

测试时隔离数据目录（不要污染真实 `~/.dcb`）：

```bash
DCB_HOME=/tmp/dcb-test npm start        # Windows: $env:DCB_HOME='D:/tmp/dcb-test'; npm start
```

截图自动化变量：`DCB_SHOT`（截图后退出）、`DCB_SHOT_JS`、`DCB_SHOT_DELAY`、`DCB_SHOT_ZOOM`、`DCB_DISABLE_GPU`。仅限本机测试。无单实例锁，测试前先清理残留进程，否则多个窗口会互相覆盖 `config.json` / `chats.json`。

打包：

```bash
npm run dist        # Windows x64 NSIS → dist/DgxayCode-<version>-Setup.exe
npm run dist:mac    # macOS arm64 DMG，必须在 macOS 上执行
npm run dist:linux  # x64 deb，需要 fpm（Windows 上会失败）
npm run pack        # 仅解包目录，用于检查 asar 内容
```

Windows 上产出 Linux 包：`npx electron-builder --linux dir --x64` 后执行 `python scripts/make-deb.py`（该脚本保留 `chrome-sandbox` 的 setuid）。Windows 上产出 macOS 便携 zip：`@electron/packager` 生成 `arm64 .app` 后执行 `python scripts/make-mac-zip.py`（非 DMG、未签名）。

图标：修改 `scripts/make_icons.py` 后重新运行 `python scripts/make_icons.py`，生成 `build/icon.{png,ico,icns}` 与渲染层图标；否则安装包仍是旧图标。

## 架构

### 进程与 IPC 契约

- **主进程**（`src/main`, CommonJS）：`main.js` 是唯一入口，持有窗口、全部 IPC handler、聊天循环、权限网关与终端执行；`config.js` 负责 `~/.dcb` 路径与原子读写；`llm.js` 协议层；`tools.js` 工具定义与执行；`oauth.js`、`mcp.js`、`skills.js` 各自独立。
- **preload**（`src/preload/preload.js`）：只通过 `contextBridge` 暴露 `window.dcb` 白名单。渲染层无 Node、无 `require`。
- **渲染层**（`src/renderer`）：`index.html` 以 `<script type="module" src="js/app.js">` 启动，ESM 之间直接 import。
- **新增任何能力都要成对改两处**：`main.js` 注册 `ipcMain.handle('ns:action')`，`preload.js` 增加对应 invoke 包装。只加一边会在渲染层得到 `undefined`。
- 主进程推送是反向的：`chat:event`、`terminal:event`、`mcp:event`、`permission:request`、`theme:system`，preload 用 `subscribe()` 收敛成 `onXxx(cb)` 回调。事件按 `requestId` 归属，渲染层据此丢弃过期流。

### 聊天循环（`main.js` → `llm.js` → `tools.js`）

`chat:send` 是核心编排点：

1. 从 `config.json` 解析供应商、模型、模式（`chat` / `work`）、权限与工作空间；`useTools` 仅在「工作模式 + 已选工作空间」时为真。
2. `systemPromptFor()` 拼装系统提示：基础人设 → 技能内容 → 自定义指令 → 模式说明 → 权限说明 → 工作模式「任务执行纪律」。权限文案必须与实际行为一致，改动权限语义时同步这里。
3. `normalizeHistory()` 只保留 user/assistant 文本，且只发送最近 24 条。
4. 循环调用 `streamChat()`（`llm.js` 按 `provider.protocol` 分发到 `streamOpenAI` / `streamAnthropic` / `streamResponses`），通过 `onDelta` / `onReasoning` 向渲染层推 `delta` / `reasoning`。
5. 若返回 `toolCalls`：先把 assistant 的 `tool_calls` 写回消息，再逐个调用 `tools.execute()`。每个工具调用都会包一层 `requestOperationApproval()`，工具内部还可以通过 `ctx.requestApproval` 再次请求（例如终端命令）。结果以 tool 消息回填，进入下一轮。上限：工作模式 24 轮、对话模式 8 轮。
6. 续跑保护：`looksUnfinishedWork()` 对空回复、`finishLength`、「接下来我会…」类承诺追加一条继续指令，最多 2 次。
7. 结束推 `done` / `aborted` / `error`，最后统一推 `end`；`chat:abort` 通过 `AbortController` 中断流。

### 权限网关（安全边界在主进程）

- `tools.js` 的 `PERMISSION_TOOLS` 决定各权限可见的工具集：`none` 只有 `list_directory` / `read_file`，其余三档是全量。`assertReadable` / `assertWritable` 再做路径级校验（`none` 限制在工作空间内）。
- `requestOperationApproval()` 是唯一授权入口：`full` 直接放行；`normal` 每次都 `askUserApproval()`；`auto` 先调审查模型，`allow` 放行、其余转人工；`none` 一律拒绝。
- 审查模型由 `resolveReviewer()` 选择：供应商自己的 `reviewModelId` 优先，否则回退 `providers[0]`；只接受存在于 `models[].id` 中的 ID。超时 25 秒，任何异常都按 `review` 处理。
- `askUserApproval()` 通过 `pendingPermissions` Map 挂起，发 `permission:request`，等渲染层 `permission:respond` 回来才 resolve。授权只对当次操作有效。
- 新增工具必须同步五处：`DEFINITIONS`、`PERMISSION_TOOLS`、`execute()` 分支、`systemPromptFor()` 的能力描述、以及确保执行路径经过 `requestOperationApproval`。漏第二处工具不可见，漏第五处会形成无授权入口。

### 协议层（`llm.js`）

`normalizeBaseUrl` / `endpointFor` 兼容「裸域名」「带 `/v1`」「完整端点」三种写法，已带版本前缀（如 `/v1beta/openai`）不会重复拼 `/v1`。`buildHeaders` 按协议与 `authType` 切换鉴权：Anthropic 用 OAuth 时只发 `Bearer` + `anthropic-beta`，不发 `x-api-key`；Responses 不发送 `temperature`。三种协议的工具调用在内部统一成 OpenAI 的 `tool_calls` 形状，各 stream 函数负责双向转换。`consumeSSE()` 是共享的流解析器。

### 渲染层结构

- `store.js`：唯一状态源 `state`（config / chats / 当前会话 / streaming 标记）+ `EventTarget` 总线。`patchConfig()` 写主进程并广播 `config` 事件；`scheduleChatSave()` 以 450ms 防抖落盘。
- `app.js`：`boot()` 拉 `app:init`、初始化 store/主题、绑定窗口控件、模式与权限切换、全局快捷键、以及 `permission:request` 的授权弹窗（`handlePermissionRequest`）。
- `chat.js`（最大文件）：消息线程渲染、发送、流式增量、斜杠命令、终端卡片、上下文环、思考框、工具卡片。`chat:event` 与 `terminal:event` 的类型分支集中在这里的 switch。
- `settings.js`：供应商/模型编辑、OAuth 账户、MCP、快捷键、通用、数据与关于六个分页。
- 视觉辅助模块各司其职：`streamfx.js`（按 Markdown 顶层块增量更新，只给新增字符包 `.fx-ch` 做模糊入场）、`squircle.js`（超椭圆 `clip-path`）、`typography.js`（末尾两字孤字保护）、`theme.js`（只切 `<html data-theme>`）、`markdown.js`（本地渲染，必须保持转义）、`ui.js`（菜单/弹窗/toast/快捷键工具）。

### 数据与配置

数据目录由 `DCB_HOME` 覆盖，默认 `%USERPROFILE%\.dcb` 或 `~/.dcb`：`config.json`、`chats.json`、`oauth.json`、`mcp.json`、`skills/`。全部以 `0600` 原子写（`writeJsonAtomic`），目录 `0700`。读取采用默认值深合并，不要假设用户配置里已有新字段。`config.json` 中 API Key 为明文；`chats.json` 最多保留 200 段对话。`providers[0]` 是默认供应商，也是审查模型回退来源，顺序有意义。

`config.agents` 是 Agent 定义（内置 + 用户自建，数组整体替换而非合并），`chat.agents` 保存单个对话启用的 Agent ID 列表，随 `chats.json` 持久化。默认主题为 `dark`，旧配置里由旧默认写入的 `ui.theme === 'system'` 会在首次读取时迁移一次（`ui.themeMigrated` 标记），之后用户仍可在设置里改回。模型级 `contextWindow` / `maxTokens` 都存在 `providers[].models[]` 上，`maxTokens` 为空时回落到 `chat.maxTokens`。

### 打包配置

`package.json` 的 `build` 段被 electron-builder 直接读取：`files` 只打包 `src/**/*` 与 `package.json`，因此根目录的 README/LICENSE 不会进安装包；`deleteAppDataOnUninstall: false` 保证卸载不删数据。产物进 `dist/`（已 gitignore）。

## 必须遵守的隐性约定

- **版本号是多点写入**：`package.json`、`package-lock.json`（根与 `packages[""]`）、`src/renderer/index.html`（`#setVersion`）、`src/renderer/js/app.js`、`src/renderer/js/settings.js`、`src/main/llm.js` 与 `src/main/oauth.js` 的 User-Agent、两个 README。改版本时全局搜索旧版本号。
- **CSP 是 `default-src 'self'`**：禁止内联脚本、远程脚本、远程字体。`style-src` 允许内联（`squircle.js` 依赖它写 `clip-path`），但不要用内联 `<script>`。
- **HTML `id` 与 JS 强耦合**：`#input`、`#sendBtn`、`#permList`、`#setBody` 等被直接查询，重命名会静默失效，改结构后全局搜索引用。
- **颜色只能走 token**（`--l0`…`--l4`、强调色 `#2563EB`）：写死十六进制会在深色模式露出亮色斑块。层级靠 1%–3% 的微对比色阶，不要加回描边和重阴影。
- **被 squircle 裁切的容器不能用 `box-shadow`**（会一起被裁掉）：浮层阴影放在父级 `filter: drop-shadow()`（`.menu-layer`、`.toast-layer`、`.modal-shell`、`.ob-wrap`）。弹窗结构是 `.modal-shell` 包 `.modal`，改宽度/阴影/裁切要同时顾两层。
- **流式渲染不要回退成每帧重建整段 `innerHTML`**：那会让每个字符重复触发模糊动画，整段文字持续抖动。
- **不要把未转义内容插入 `innerHTML`**：`markdown.js` 与各处模板拼接依赖 `escapeHtml()`。
- 渲染层没有热更新，改完 HTML/CSS/JS 需刷新窗口。

## 已知限制（不要当成 bug 去“修”之前先确认）

MCP 目前只做进程管理，**没有把 MCP 工具暴露给模型**；终端无 PTY，不支持交互式命令；没有自动更新、崩溃恢复、对话导出、单实例锁；Windows/macOS 产物未签名；对话上下文的用量圆环是字符启发式估算，不是真实 token。
