# DgxayChatBox 项目注意事项

适用版本：**V1.2（1.2.0）**  
最后更新：2026-11-07  
配套文档：[README-zh.md](./README-zh.md)、[README.md](./README.md)

本文汇总开发、调试、日常使用与打包发布全过程中容易踩坑的地方。开始改代码或分发安装包前，建议先通读第 3、4、10、11 节。

---

## 1. 项目结构与技术约定

- Electron 32 + 原生 HTML / CSS / ES Modules，**没有前端构建步骤**。改完 `src/renderer` 后刷新窗口即可，不需要编译。
- 主进程（`src/main`）使用 CommonJS；渲染层是 ESM；preload 通过 `contextBridge` 暴露白名单 IPC。
- 渲染层不能直接 `require`、不能访问 Node API，也不要在 `index.html` 里写内联脚本（CSP 已禁止）。
- 新增任何 IPC 都必须同时改两处：`src/main/main.js` 注册 handler，`src/preload/preload.js` 暴露方法。只在渲染层调用会直接报 `undefined`。
- 渲染层 ESM 不能用 `node --check src/renderer/js/foo.js` 直接检查，需先复制成 `.mjs` 再检查。
- 关键文件职责：

| 路径 | 职责 |
| --- | --- |
| `src/main/main.js` | 窗口、IPC、系统提示、审查/授权、聊天循环、终端、压缩 |
| `src/main/config.js` | `~/.dcb` 路径、默认配置、原子写入 |
| `src/main/llm.js` | 三种协议的请求、SSE 解析、工具调用转换 |
| `src/main/tools.js` | 工具定义、权限矩阵、文件/命令/联网执行 |
| `src/main/oauth.js` | OAuth PKCE、回环回调、令牌存储与刷新 |
| `src/main/mcp.js` | `mcp.json`、MCP 子进程启停与日志 |
| `src/main/skills.js` | 扫描 `~/.dcb/skills` |
| `src/renderer/js/chat.js` | 对话、斜杠命令、终端卡片、上下文环 |
| `src/renderer/js/settings.js` | 供应商、OAuth、MCP、快捷键、通用、数据 |
| `src/renderer/js/store.js` | 前端状态、权限元数据、会话持久化 |

---

## 2. 环境与启动

- 需要 **Node.js 18+** 与 npm。
- 国内网络建议先设置镜像再安装：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm install
```

- **不要直接用 `npx electron .` 启动**：如果终端设置了 `ELECTRON_RUN_AS_NODE=1`，Electron 会以纯 Node 模式运行，报 `app is not defined`。项目提供的 `npm start` / `npm run dev` 会先清掉该变量：

```bash
npm start      # 正常启动
npm run dev    # 启动并打开开发者工具
```

- `npm run dev` 只影响开发环境，不会影响安装包行为。
- 当前**没有单实例锁**。重复启动会出现多个窗口同时读写 `config.json` / `chats.json`，后写入者覆盖先写入者。调试时先确认没有残留进程。
- Windows 使用无边框窗口，标题栏拖拽区由 CSS 的 `-webkit-app-region` 实现；macOS 使用原生边框并保留最小应用菜单（Cmd+Q / 复制粘贴）。改窗口样式时不要破坏 macOS 的 `frame: true` 分支。
- 以下环境变量只用于自动化测试，**不要写进正式启动方式**：

| 变量 | 作用 |
| --- | --- |
| `DCB_HOME` | 覆盖数据目录，测试隔离必备 |
| `DCB_SHOT` | 启动后截图到指定路径并退出 |
| `DCB_SHOT_JS` | 截图前执行任意 JS（仅测试） |
| `DCB_SHOT_DELAY` | 截图前等待毫秒数 |
| `DCB_DISABLE_GPU` | 禁用硬件加速，适配无 GPU 环境 |

`DCB_SHOT_JS` 等同于远程执行代码，只能在本机测试使用。

---

## 3. 数据与配置

数据目录：`%USERPROFILE%\.dcb`（Windows）或 `~/.dcb`（macOS / Linux）。

```
.dcb/
├── config.json   # 供应商、模型、审查模型、模式、快捷键
├── chats.json    # 对话历史、技能、终端输出
├── oauth.json    # OAuth 客户端配置与账户令牌
├── mcp.json      # MCP server 配置
└── skills/       # 技能（SKILL.md 或 name.md）
```

- `config.json`、`chats.json`、`oauth.json`、`mcp.json` 均以 `0600` 原子写入；目录为 `0700`。
- **API Key 在 `config.json` 中是明文**；`chats.json` 中的对话、终端输出、文件内容也是明文。不要把这些文件直接发给别人或上传到公开仓库。
- OAuth 令牌在系统支持时用 Electron `safeStorage` 加密；更换系统账户、重装系统或钥匙串变化后可能无法解密，需要重新连接。
- 配置读取采用“默认值深合并”。旧配置缺字段会自动补默认值；不要假设用户配置一定包含新字段。
- **供应商顺序有意义**：`providers[0]` 是默认供应商，也是未配置审查模型时的回退来源。拖动/删除第一个供应商会改变默认审查模型。
- 旧版本的珊瑚色主题会在读取时自动迁移为蓝色；这是目前唯一的配置迁移逻辑。改版本号不会自动迁移其他字段。
- 升级/重装不会删除 `~/.dcb`；NSIS 卸载器配置了 `deleteAppDataOnUninstall: false`，需要彻底清理时手动删除该目录。
- 「设置 → 数据与关于 → 重置应用」只重置 `config.json` 与对话记录，**不会删除** `oauth.json`、`mcp.json` 和 `skills/`。OAuth 账户仍保持连接，MCP 配置与技能也仍在；彻底清理需手动删除对应文件。
- 重置不可恢复，操作前先备份 `.dcb`。
- `chats.json` 最多保留 **200 段对话**（写入时 `slice(0, 200)`），超出部分直接丢弃。重要对话需要自行导出或备份。
- 应用运行时手改 `config.json` 可能被下一次保存覆盖；改配置前先退出应用。
- 对话保存有防抖。流式生成中强制结束进程，最后一段内容可能未落盘。
- 测试一律使用临时目录：

```bash
DCB_HOME=/tmp/dcb-test npm start
# Windows: DCB_HOME=D:/tmp/dcb-test npm start
```

不要拿真实的 `~/.dcb` 做测试，尤其不要在里面跑会写文件或删文件的用例。

---

## 4. 权限与自动审查（最容易出错）

### 4.1 四档权限的实际行为

| 模式 | 能力 | 授权流程 |
| --- | --- | --- |
| `none` 无权限 | 仅只读**工作空间内**文件；禁止写、删、联网、终端 | 无 |
| `normal` 普通权限 | 全部能力（工作空间内外文件、终端、联网） | **每一次**工具调用 / 终端命令都弹窗询问 |
| `auto` 自动审查 | 全部能力 | 先由审查模型判断；放行则执行，可疑才弹窗 |
| `full` 完全权限 | 全部能力，无限制 | 不审查、不询问 |

- 权限**在主进程强制执行**，渲染层只负责展示。不要试图只改前端来“绕过”权限，`tools.js` 会重新校验。
- 普通权限和自动审查都是“拥有全部能力”，区别只在授权方式；不要把它们误写成“普通权限只能改工作空间”。
- 无权限模式读取也受限：`read_file` / `list_directory` 只能访问工作空间内；未选择工作空间时直接拒绝。
- 完全权限切换时会弹风险确认；这是 UI 提示，不是安全边界。

### 4.2 自动审查的可用条件

- 每个供应商可配置 `reviewModelId`；当前供应商未配置时回退到 `providers[0]`。
- 只有当前供应商或默认供应商存在**有效的**审查模型时，权限列表才显示「自动审查」。
- 移除审查模型后，已选中的自动审查会自动回落到普通权限（写回配置）。
- 审查模型调用超时 25 秒；超时、网络失败或返回无法解析时，一律按“可疑”处理，转交用户确认。
- 审查模型只输出 `{"decision":"allow|review","reason":"..."}`。它只是建议，**不是沙箱**，可能被提示词注入或判断错误；高风险操作仍应人工确认。

### 4.3 授权范围与边界

- 授权只对**当前这一次**操作有效，没有“本次运行始终允许”的持久授权。
- 用户拒绝后，工具返回错误，系统提示要求模型不要重试；模型仍可能尝试别的路径，需要留意。
- 普通权限下的终端命令同样先弹窗；不存在“终端绕过审查”的入口。
- `install_mcp_server` 在对话模式（非无权限）也可用，但它**只写入配置，不启动进程**。
- `delete_path` 使用 `fs.rm`，**永久删除，不进回收站**，没有撤销。
- 写入保护只拒绝“目标恰好等于根目录 / 用户主目录 / 工作空间根目录”的情况，并不会阻止删除其他重要目录。普通/自动/完全权限下都可能改到工作空间外的文件，操作前先备份。
- 新增工具时必须同步更新：
  1. `DEFINITIONS`（工具 schema）
  2. `PERMISSION_TOOLS`（哪些权限可见）
  3. `execute()` 分支
  4. 系统提示中的能力描述
  5. 审查/授权路径（普通与自动审查都必须经过）

  漏掉第 2 步会导致工具不可用；漏掉第 5 步会形成无授权的执行入口。

---

## 5. 模型与协议

| 协议 | 端点 | 鉴权 |
| --- | --- | --- |
| `openai` | `{base}/v1/chat/completions` | `Authorization: Bearer` |
| `anthropic` | `{base}/v1/messages` | `x-api-key` + `anthropic-version` |
| `responses` | `{base}/v1/responses` | `Authorization: Bearer` |

- `provider.protocol` 决定协议，模型继承供应商协议；缺省按 `openai` 处理。
- Base URL 可以只填域名、带 `/v1`，或直接填完整端点。已经带版本前缀的地址（如 Google 的 `/v1beta/openai`）不会再重复拼 `/v1`。
- Google 的 OpenAI 兼容地址是 `https://generativelanguage.googleapis.com/v1beta/openai`，不是 `https://generativelanguage.googleapis.com/v1`。
- Anthropic 使用 OAuth 时只发 `Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20`，**不再发 `x-api-key`**；用 API Key 时才发 `x-api-key`。
- Responses 请求不发送 `temperature`（推理模型通常不接受）；`max_output_tokens` 仍会发送。
- 三种协议的工具调用会互相转换：`tool_calls` ↔ `tool_use` / `tool_result` ↔ `function_call` / `function_call_output`。改协议层后至少回归这三种工具链。
- 模型列表接口不是所有网关都支持；拉取失败时允许手动填写模型 ID，不要把它当阻断错误。
- 切换协议后原有模型 ID 可能不再存在，需要重新填写或重新拉取。
- 模型的 `contextWindow` 只影响上下文圆环的**估算**，不会改变服务端真实上限。留空时 ChatCompletions 按 128k、Anthropic / Responses 按 200k 估算。
- 上下文环按字符启发式估算（中文约 1 字符 1 token），不是真实计费 token；以响应里的 `usage` 为准。
- 对话模式最多 8 轮工具循环；工作模式最多 24 轮，并最多自动续跑 2 次。达到上限会停止，长任务需要拆分成多次对话。
- **每次请求只发送最近 24 条消息**（`slice(-24)`）。更早的内容会被静默丢弃，长对话应先 `/压缩` 或另起会话。
- 部分平台限制订阅令牌用于第三方推理（OpenAI / Anthropic / xAI 均可能返回 401/403）。遇到时在供应商里切回 API Key，不要反复重试。

---

## 6. OAuth 账户连接

| 平台 | 回调方式 | 注意事项 |
| --- | --- | --- |
| OpenAI | 固定回环 `localhost:1455/auth/callback` | 端口被 Codex CLI 或其他实例占用时授权会失败 |
| Anthropic | 手动粘贴授权码，格式 `code#state` | 授权页显示的是 `code#state`，不要只复制前半段；流程 5 分钟过期 |
| xAI | 随机回环端口 | 需要 SuperGrok / X Premium+ |
| Google | 随机回环端口 | 必须自建「桌面应用」OAuth 客户端，启用 Generative Language API，回调地址必须精确匹配 |

- OAuth 只负责拿到凭据；“用不用它推理”由供应商的 `authMode` 决定。连接账户后还要在供应商编辑里选择「OAuth 账户」。
- 每个平台同时只保留一个连接；重新授权会覆盖旧令牌。
- 令牌过期会自动刷新；刷新失败会标记为已过期，需要重新连接。
- `~/.dcb/oauth.json` 含访问令牌与刷新令牌，**绝对不要提交到 Git、发截图或贴日志**。
- 授权在系统浏览器完成；应用不会内嵌登录页，也不会把密码发给模型。
- 自动化测试可设置 `DCB_OAUTH_NO_BROWSER=1` 跳过打开浏览器，仅用于本机回环测试。
- 修改授权端点 / 令牌端点后必须确认是 `http(s)://`；OAuth state 会校验，回调 state 不匹配会被拒绝。
- Google 未启用 API 时通常表现为 403/404，不是授权失败；先检查 Cloud Console。

---

## 7. 工作模式与文件操作

- 工作模式的工具只在**已选择工作空间**时启用；未选择时系统提示会要求 AI 不要调用文件工具。
- 工作模式系统提示包含「任务执行纪律」：先拆步骤、立即调用工具、完成前不得停止、不得只输出计划、失败要换方案、结束前验证。
- 主进程有续跑保护：空回复、长度截断、或出现“接下来我会 / 下一步将”等承诺时，自动追加“继续执行”，最多两次。该判断是启发式的，可能多跑一轮；可随时点停止。
- AI 生成的文件默认写入工作空间，但普通/自动/完全权限下也能写工作空间外路径（需授权或不需授权）。不要误以为“工作空间=沙箱”。
- 文件工具上限：
  - 单次读取最多 120,000 字符，超出截断；
  - 命令 / 网页输出最多 24,000 字符，超出截断；
  - 工具内命令超时 180 秒，输出缓冲 8 MB；
  - `!` 终端命令超时 5 分钟，累计输出超过 300,000 字符截断。
- 没有内置的版本控制、回收站或撤销。让 AI 批量改文件前，先用 Git 提交或复制备份。
- 删除是永久删除；不要对包含重要资料的目录使用自动/完全权限。
- 任务被拒绝授权或工具报错后不会自动回滚已完成的步骤，可能留下半成品，需要人工检查。
- 工作模式连续执行会消耗较多 token；长任务开始前可先 `/压缩`，或拆成多个明确的小任务。

---

## 8. 输入框与快捷功能

### 8.1 斜杠命令

- 输入 `/` 打开命令菜单；`↑` `↓` 选择，`Enter` 执行，`Esc` 关闭。
- `/压缩`：
  - 调用当前模型总结对话，然后用一条摘要**替换全部历史**；
  - 有损操作，细节会丢失，且不可撤销；
  - 只压缩当前会话；需要已配置模型；流式生成或压缩进行中不能再次触发；
  - 摘要提示要求保留目标、决定、文件路径、待办，但模型仍可能漏掉内容。
- `/技能`：列出 `~/.dcb/skills` 下的技能。
- `/技能 <名称> [提示词]`：在**本次对话**启用技能，技能内容会注入系统提示；切换对话不会继承，需要重新启用。
- 技能可以是含 `SKILL.md` 的文件夹，或单个 `name.md`；支持 `name` / `description` frontmatter。
- 单个技能内容最多注入 40,000 字符，超出会截断。
- 点输入框上方的技能标签可移除。

### 8.2 终端命令

- 以 `!` 开头的输入不会发给模型，而是作为终端命令执行，例如 `!git status`。
- 同一时间只允许一个终端命令；执行期间发送按钮不可用，需先在终端卡片点「停止」。
- 命令通过 `shell: true` 执行：Windows 是 cmd（每条命令前 `chcp 65001`），macOS / Linux 是系统 shell。**不要照搬 bash 语法到 Windows**。
- 没有 PTY，不支持 `vim`、`top`、`ssh` 交互、需要密码输入或全屏 TUI 的命令；请使用非交互参数（`-y`、`--no-pager`、`CI=1`）。
- 工作目录优先工作空间，未选择时为用户主目录；命令里引用的相对路径以此为准。
- 输出会去除 ANSI 转义序列后显示，并进入 AI 上下文；大量输出会截断。
- 终端权限与工具一致：无权限拒绝，普通每次询问，自动审查先判断，完全直接执行。
- 停止按钮只终止当前命令进程树，不会回滚命令已产生的副作用。

### 8.3 上下文圆环与发送

- 圆环是估算值，不是实时计费；点击可查看已用/上限、剩余、消息数、模型与技能。
- 上下文接近上限时优先 `/压缩`，或新建对话；仅靠圆环不会自动截断历史。
- 发送按钮在输入为空、终端执行中、压缩中会禁用；流式生成时变为停止按钮。
- 回车发送受「发送方式」设置影响；输入法组合期间不会误发送。

---

## 9. MCP

- 配置保存在 `~/.dcb/mcp.json`，字段：`name`、`command`、`args`、`env`、`cwd`、`enabled`。
- 设置 → MCP 支持手动新增、启动、停止、查看日志、删除；最多保留 400 行日志。
- **MCP 不会随应用启动自动运行**；每次启动应用后需要手动点「启动」。
- 退出应用会尝试停止所有 MCP 子进程：Windows 使用 `taskkill /T /F`，其他平台先 `SIGTERM`，3 秒后 `SIGKILL`。
- 让 AI 安装 MCP 时，`install_mcp_server` 只写配置并提示你去设置页启动；它不会伪造“已启动”。
- 当前版本**只管理 MCP 进程，没有把 MCP 工具暴露给模型**。启动后的 MCP 不会自动出现在对话工具列表里，这是已知限制。
- `spawn` 使用 `shell: true`，`command` 和 `args` 会交给系统 shell 解析；只运行可信来源的 MCP 配置。
- `env` 以明文保存在 `mcp.json`；不要把长期密钥写进不信任的配置。
- macOS 从 Finder 启动的 GUI 应用 PATH 往往不含 `npx` / `uvx` / Homebrew 路径；MCP 起不来时先改用绝对路径（如 `/opt/homebrew/bin/npx`）。
- `npx` 首次运行会联网下载包，启动慢或失败先看日志；离线环境需提前安装。
- 工作目录留空时使用 `~/.dcb`，相对路径资源可能找不到，建议显式填写。
- MCP 日志可能包含令牌或本地路径，截图/反馈前先脱敏。

---

## 10. 界面与代码约定

- 视觉基线：ChatGPT / Claude 风格浅色界面，暖白侧栏 + 白色画布，**单一蓝色强调色 `#2563EB`**；不要引入紫色、渐变或多种高饱和强调色。
- 目前只有浅色主题，没有暗色模式；不要假设 `prefers-color-scheme` 会切换配色。
- 所有数字通过仅覆盖 `U+0030-0039` 的 `@font-face` 使用等宽字形（Consolas / SF Mono / JetBrains Mono / DejaVu Sans Mono）；正文字体保持不变。新增数字展示时不需要额外设置字体。
- 字体全部本地加载，不依赖网络；不要改成 Google Fonts 等远程字体（CSP 也会拦截）。
- CSP 为 `default-src 'self'`，禁止内联脚本与远程脚本；新增资源必须是本地文件。
- 没有前端构建，也没有热更新；改完 HTML/CSS/JS 需要重新加载窗口（开发时可用开发者工具刷新）。
- HTML 的 `id` 与渲染层强耦合；重命名 `#input`、`#sendBtn`、`#permList`、`#setBody` 等会导致功能静默失效，改结构后全局搜索引用。
- 新增按钮/菜单优先复用现有 `btn`、`menu`、`modal` 组件类，避免出现第二套视觉语言。
- Markdown 渲染使用本地实现；不要直接把未转义的用户内容插入 `innerHTML`，新增渲染逻辑时保持转义。
- 窗口拖拽区与按钮区要区分 `-webkit-app-region: drag / no-drag`，否则按钮点不动或窗口拖不动。

---

## 11. 打包与发布

### 11.1 版本号要改全

版本号不是单一来源，至少检查以下位置（可直接全局搜索 `1.2.0` / `V1.2`）：

- `package.json` → `version`
- `package-lock.json` → 根 `version` 与 `packages[""].version`
- `src/renderer/index.html` → 侧栏 `#setVersion`
- `src/renderer/js/app.js` → `ver.textContent`
- `src/renderer/js/settings.js` → 数据页版本行
- `src/main/llm.js`、`src/main/oauth.js` → `User-Agent`
- `README.md`、`README-zh.md` → 标题与版本章节
- `scripts/make-deb.py` → 文档字符串中的示例文件名（实际文件名从 `package.json` 读取）

改完执行 `npm run dist` 前先确认 `package.json` 版本，否则产物文件名与界面显示会不一致。

### 11.2 构建命令

```bash
npm run dist         # Windows x64 NSIS 安装包
npm run dist:mac     # macOS arm64 DMG（必须在 macOS 上运行）
npm run dist:linux   # Debian / Ubuntu deb（建议在 Linux 上运行）
```

产物在 `dist/`，不要提交到 Git。

### 11.3 Windows

- 产物：`dist/DgxayChatBox-<version>-Setup.exe`，NSIS，可选安装目录，创建桌面/开始菜单快捷方式。
- **未做代码签名**，SmartScreen 会提示“未知发布者”；需要用户点“更多信息 → 仍要运行”。正式分发建议购买代码签名证书。
- 安装包不包含 `README`、`LICENSE` 等根目录文件（`build.files` 只打包 `src` 与 `package.json`）；如需随包分发，要显式加入 `files`。
- 卸载不会删除 `~/.dcb`。

### 11.4 macOS

- electron-builder **拒绝在非 macOS 上构建 macOS 产物**，DMG 还依赖 `hdiutil`。Windows 上只能生成便携 zip。
- 当前 Windows 构建流程：
  1. `@electron/packager` 生成 arm64 `.app`；
  2. `scripts/make-mac-zip.py` 补图标、改 `Info.plist`、加入 `Install-DgxayChatBox.command`；
  3. 输出 `DgxayChatBox-<version>-arm64-mac.zip`。
- 便携包**不是 DMG**，只支持 Apple Silicon（arm64），未签名/未公证。
- 首次打开若提示“已损坏”或“无法验证开发者”，右键打开，或执行：

```bash
xattr -cr /Applications/DgxayChatBox.app
```

- 安装脚本会在本机做 ad-hoc 签名；没有 Apple Developer ID，无法彻底避免 Gatekeeper 提示。
- 正式 DMG 需在 macOS 上运行 `npm run dist:mac`，或使用仓库的 `macos-14` GitHub Actions。
- electron-packager 可能提示找不到 `build/icon.icns`（因为工作目录不是项目根）；`make-mac-zip.py` 会把图标写入 `Contents/Resources` 并设置 `CFBundleIconFile`，打包后应确认 zip 内含 `icon.icns`。

### 11.5 Linux

- Windows 上没有 `fpm`，`electron-builder --linux deb` 会失败；改用：

```bash
npx electron-builder --linux dir --x64
python scripts/make-deb.py
```

- 产物：`dist/DgxayChatBox-<version>-amd64.deb`，仅验证 Debian / Ubuntu x64。
- `scripts/make-deb.py` 会保留 `chrome-sandbox` 的 setuid 权限；丢失会导致 Chromium 沙箱启动失败。
- 安装：`sudo apt install ./DgxayChatBox-<version>-amd64.deb`；依赖缺失时 `sudo apt -f install`。
- 不要用 `dpkg -i` 跳过依赖解析，除非明确知道缺什么。

### 11.6 CI 与图标

- `.github/workflows/build.yml` 在 `windows-latest`、`macos-14`、`ubuntu-22.04` 上构建并上传产物；Linux 步骤同样使用 `--linux dir` + `make-deb.py`。
- 图标由 `scripts/make_icons.py` 生成 `build/icon.png`、`icon.ico`、`icon.icns` 与渲染层图标；换配色或图形后必须重新运行，否则安装包仍是旧图标。
- 打包前建议 `npm ci` 并确认 `dist/`、`.test/`、`.tmp-*` 已清理，避免把测试文件带进 asar。

---

## 12. 测试与调试

- 所有 UI/权限测试使用 `DCB_HOME` 指向临时目录，结束后删除；不要污染真实 `~/.dcb`。
- 模型调用优先用本地 mock server 验证流式、工具调用、错误码；真实 API 只做最后确认，避免费用与密钥泄露。
- 权限改动至少覆盖矩阵：`none` 写/删/联网/终端全部拒绝；`normal` 每次询问且拒绝后不执行；`auto` 放行与转人工两条路径；`full` 直接执行。
- 协议改动至少覆盖三种协议的文本流、工具调用、工具结果回传、非流式请求。
- OAuth 改动至少覆盖：回环回调、手动授权码、state 不匹配、令牌刷新、断开连接。
- 打包后必须实际启动一次安装版，确认资源路径、图标、版本号与开发环境一致；只测 `npm start` 不够。
- 截图测试结束会退出应用；如果端口被占用或进程残留，先清理再重跑。
- 渲染层语法检查：

```bash
for f in src/renderer/js/*.js; do
  cp "$f" "/tmp/$(basename "$f" .js).mjs"
  node --check "/tmp/$(basename "$f" .js).mjs" || echo "FAIL $f"
done
```

- 主进程 / preload / 脚本可直接 `node --check`。
- 测试用 mock 服务不要监听 `0.0.0.0`，只绑定 `127.0.0.1`。

---

## 13. 已知限制

- MCP 仅支持进程管理，**尚未把 MCP 工具接入模型调用**。
- 终端没有 PTY，不支持交互式命令。
- 上下文用量是估算值；历史只发送最近 24 条消息。
- `/压缩` 有损且不可撤销。
- 没有单实例锁、自动更新、崩溃恢复、对话导出；对话最多保存 200 段。
- 没有暗色主题；只有浅色界面。
- Windows / macOS 产物未签名；macOS 仅 arm64 便携包（非 DMG）。
- Linux 仅提供 x64 `.deb`，未提供 rpm / AppImage。
- 配置与对话明文存储；OAuth 令牌在支持时加密。
- 审查模型是 LLM，判断可能出错，不能替代人工审查。
- OAuth 订阅令牌能否用于推理取决于平台策略，可能被拒绝。

---

## 14. 发布前安全检查清单

- [ ] `~/.dcb` 未被打包进产物，仓库中没有 `config.json` / `oauth.json` / `mcp.json`
- [ ] 截图、日志、README 中没有真实 API Key、OAuth 令牌、本地隐私路径
- [ ] 版本号在 `package.json`、界面、README、产物文件名中一致
- [ ] 四档权限的人工测试全部通过，拒绝路径确实不执行
- [ ] 自动审查未配置时不会显示该模式，且会回落到普通权限
- [ ] 三种协议至少各跑通一次工具调用
- [ ] `npm start` 与打包版都能启动，无 CSP/资源 404
- [ ] Windows SmartScreen、macOS Gatekeeper 的提示已在发布说明中告知用户
- [ ] 卸载/重置行为与数据保留策略已说明（重置不会清除 OAuth / MCP / 技能）
- [ ] 已提醒用户：完全权限等同于允许 AI 执行任意本机代码

---

## 15. 常见问题速查

| 现象 | 优先排查 |
| --- | --- |
| 启动报 `app is not defined` | 终端有 `ELECTRON_RUN_AS_NODE`，改用 `npm start` |
| 每次启动都进欢迎页 | `~/.dcb` 不存在/不可写，或 `DCB_HOME` 指错 |
| 模型 401 / 403 | API Key 是否有效；OAuth 是否过期；平台是否限制订阅令牌 |
| Anthropic 请求失败 | Base URL 是否多写/少写 `/v1`；OAuth 是否误发 `x-api-key` |
| Google 404 | Base URL 必须是 `.../v1beta/openai`，且已启用 Generative Language API |
| 权限列表没有“自动审查” | 当前/默认供应商未配置有效的 `reviewModelId` |
| 普通权限没有弹窗 | 是否误改前端；授权逻辑在主进程，检查 `requestOperationApproval` |
| 终端命令无输出/卡住 | 是否交互式命令；Windows 是否用了 bash 语法；是否超过 5 分钟 |
| MCP 启动失败 | 命令是否在 PATH；macOS 改用绝对路径；查看 MCP 日志 |
| MCP 启动了但 AI 不会用 | 当前版本未把 MCP 工具暴露给模型，属于已知限制 |
| macOS 提示应用已损坏 | `xattr -cr /Applications/DgxayChatBox.app`，或右键打开 |
| deb 安装缺依赖 | `sudo apt install ./xxx.deb` 或 `sudo apt -f install` |
| 打包后界面是旧样式 | 改完未重新打包；安装包不会热更新源码 |

---

如新增功能涉及权限、协议、OAuth 或打包流程，请同步更新本文对应章节，避免文档与实现脱节。
