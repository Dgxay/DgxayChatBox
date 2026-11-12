# DgxayCode V1.4.1

一个简洁、明快的多模型 AI 桌面工作台，基于 Electron 构建。支持三种主流模型协议，在对话模式与工作模式之间切换，并让 AI 在分级权限与自动审查的保护下直接处理本地文件与终端命令。

## 核心功能

- **三种接口协议**：OpenAI ChatCompletions、Anthropic Messages、OpenAI Responses。
- **普通权限与自动审查分离**：普通权限每次操作都询问你；自动审查先由审查模型判断，可疑操作再转交你确认。只有配置了审查模型时，权限列表才显示「自动审查」。
- **上下文圆环**：模型选择器左侧的浅灰圆环随上下文占用增长填充深灰；点击可查看 token 用量详情。
- **斜杠命令**：`/压缩` 保留重要上下文并压缩历史；`/技能` 查看已安装 skills，`/技能 名称` 在本次对话中启用。
- **终端命令**：输入 `!` 开头的命令，对话中生成终端卡片，实时回显 stdout / stderr 与退出码。
- **MCP 管理**：设置 → MCP 可新增、启动、停止、查看日志；AI 也可通过 `install_mcp_server` 工具安装配置。
- **每个供应商独立审查模型**：未配置时自动回退到第一个（默认）供应商的审查模型。
- **OAuth 账户连接**：设置 → 账户连接，支持 OpenAI、Anthropic、xAI 与 Google 账户（PKCE，可选手动授权码）。
- **界面与动效**：浅色 / 深色 / 跟随系统三档主题。深色模式不用纯黑底色，字重整体下调一档；所有大圆角采用连续曲率；层级通过 1%～3% 的微对比色阶拉开，而不是边框和阴影；模型输出逐字从高斯模糊中浮现，思考框用自适应网格撑开。
- **本地优先**：配置、对话、OAuth 令牌、MCP 与技能都在本机 `~/.dcb`。

## 协议支持

| 协议 | 请求地址 | 鉴权 | 适用场景 |
| --- | --- | --- | --- |
| `openai` | `POST {base}/v1/chat/completions` | `Authorization: Bearer` | OpenAI、DeepSeek、Moonshot、Qwen、Ollama 及兼容网关 |
| `anthropic` | `POST {base}/v1/messages` | `x-api-key` + `anthropic-version` | Claude 官方与 Anthropic 兼容网关 |
| `responses` | `POST {base}/v1/responses` | `Authorization: Bearer` | OpenAI Responses API，支持函数调用 |

Base URL 可只填域名（`https://api.anthropic.com`）、带版本前缀（`https://api.openai.com/v1`）或完整端点。工具调用会按协议转换为 `tool_calls` / `tool_use` / `function_call`，三种协议下工作模式行为一致。

## 分级权限（V1.4）

| 能力 | 无权限 | 普通权限 | 自动审查 | 完全权限 |
| --- | --- | --- | --- | --- |
| 读取工作空间文件 | ✅ | ✅ | ✅ | ✅ |
| 写入 / 删除文件 | ❌ | ✅（每次询问） | ✅（先审查） | ✅ |
| 访问工作空间外文件 | ❌ | ✅（每次询问） | ✅（先审查） | ✅ |
| 执行终端命令 | ❌ | ✅（每次询问） | ✅（先审查） | ✅ |
| 联网工具 | ❌ | ✅（每次询问） | ✅（先审查） | ✅ |
| 授权流程 | — | 每次都询问用户 | 审查模型放行，可疑时询问用户 | 无 |

**普通权限**拥有全部能力，但每次工具调用与 `!` 终端命令都会弹出授权窗口，由你选择「允许一次」或「拒绝」。

**自动审查**同样拥有全部能力，但先由审查模型判断：

1. 审查模型接收操作、参数、工作空间与命令，返回 `allow` 或 `review`；
2. `allow`：直接执行，界面显示「自动审查」标记；
3. `review`：弹窗展示操作详情与审查理由，由你选择「允许一次」或「拒绝」。

在 **设置 → 供应商 → 编辑** 中配置「自动审查模型」。只有至少一个供应商配置了审查模型时，权限列表才显示「自动审查」；若当前供应商未配置，则使用列表第一个（默认）供应商的审查模型。

## OAuth 账户

**设置 → 账户连接** 支持四个平台：

| 平台 | 回调方式 | 说明 |
| --- | --- | --- |
| OpenAI | 回环 `localhost:1455` | ChatGPT / Codex 订阅账户 |
| Anthropic | 手动粘贴授权码 | Claude 账户；官方可能限制订阅令牌用于第三方应用 |
| xAI | 回环随机端口 | SuperGrok / X Premium+ |
| Google | 回环随机端口 | 需自建「桌面应用」OAuth 客户端并启用 Generative Language API |

授权在系统浏览器中完成，使用 PKCE；令牌写入 `~/.dcb/oauth.json`（`0600`，系统支持时用 Electron safeStorage 加密），过期自动刷新。连接后可在供应商的「认证方式」中选择该账户；若平台限制订阅令牌推理，可随时切回 API Key。

## 上下文圆环

模型选择器左侧的圆环：

- 浅灰轨道代表模型完整上下文窗口；
- 深灰圆弧代表估算占用，随消息增长；
- 点击查看已用 / 上限 token、剩余空间、消息数、当前模型与技能；
- 可在供应商编辑中为每个模型填写上下文窗口，留空时按协议默认（ChatCompletions 128k，Anthropic / Responses 200k）。

用量按字符启发式估算（中文按 1 token），实际以模型返回的 `usage` 为准。

## 斜杠命令

在输入框开头输入 `/`：

| 命令 | 行为 |
| --- | --- |
| `/压缩`（或 `/compress`） | 调用当前模型总结对话，只保留目标、决定、文件路径与待办，替换历史以降低上下文占用。 |
| `/技能`（或 `/skill`） | 展示 `~/.dcb/skills` 中已安装的技能。 |
| `/技能 <名称> [提示词]` | 在本次对话启用技能，并可同时发送提示词。 |

技能可以是包含 `SKILL.md` 的文件夹，或单个 `name.md` 文件，支持 frontmatter：

```markdown
---
name: report-writer
description: 按固定格式生成周报
---

技能启用后要求模型遵循的指令……
```

启用的技能会显示为输入框中的标签，并随对话持久化。

## 终端命令

以 `!` 开头发送：

```
!git status
!npm test
```

应用会在对话中创建终端卡片，在当前工作空间（未选择时为用户目录）执行命令，实时显示 stdout / stderr 与退出码。普通权限每次询问，自动审查先判断，完全权限直接执行，无权限直接拒绝。终端输出也会进入 AI 上下文。

## 工作模式连续性

工作模式会在系统提示中加入「任务执行纪律」：模型必须先拆解步骤、立即调用工具，在任务真正完成前不得停止，也不能只输出计划或「接下来我会…」。每次工具返回后自动继续下一步，完成前做一次验证，最后再汇总。

主进程另有续跑保护：如果工作模式在任务未完成时提前收尾（空回复、达到长度上限，或出现「接下来我会 / 下一步将」等承诺），会自动追加一次「继续执行」提示，最多两次，避免任务只做一半。

## MCP

**设置 → MCP** 会读取 `~/.dcb/mcp.json`，支持启动、停止、实时日志、PID、工作目录与删除；也可手动新增（名称、命令、参数、环境变量、工作目录），或让 AI 安装：

> 帮我安装 filesystem MCP，允许访问我的项目目录

模型会调用 `install_mcp_server` 保存配置，随后到 设置 → MCP 点击「启动」即可。应用退出时会自动停止所有 MCP 进程。

## 数据目录

```
%USERPROFILE%\.dcb\
├── config.json   # 供应商、模型、审查模型、模式、快捷键
├── chats.json    # 对话历史、技能、终端输出
├── oauth.json    # OAuth 客户端配置与账户令牌
├── mcp.json      # MCP server 配置
└── skills/       # 已安装技能（SKILL.md 或 name.md）
```

`config.json` 在支持 POSIX 权限的平台上以 `0600` 写入。开发时可用 `DCB_HOME` 指定其他目录。

## 开发

需要 Node.js 18+ 与 npm。

```bash
npm install
npm start        # 启动
npm run dev      # 启动并打开开发者工具
```

界面使用原生 HTML / CSS / ES Modules，没有前端构建步骤。整体为 ChatGPT / Claude 风格的浅色布局，单一蓝色强调色；所有数字通过首选的等宽字形呈现。

开发约定、权限边界、OAuth 与三平台打包的注意事项，统一整理在 [NOTES.md](./NOTES.md)。

## 打包

```bash
npm run dist         # Windows x64 安装包（NSIS）
npm run dist:mac     # macOS arm64 DMG（M 系列，需在 macOS 上运行）
npm run dist:linux   # Debian / Ubuntu .deb（x64，需在 Linux 上运行）
```

产物输出到 `dist/`。说明：

- electron-builder 禁止在非 macOS 上构建 macOS 产物，DMG 还依赖 `hdiutil`；请使用 Mac 或仓库内置的 `macos-14` GitHub Actions。
- 在 Windows 上可执行 `npx electron-builder --linux dir --x64`，再运行 `python scripts/make-deb.py`，无需 `fpm` 也能生成合法的 Debian 包。
- 在 Windows 上可用 `@electron/packager` 生成 arm64 `.app`，再用 `python scripts/make-mac-zip.py` 打成便携 zip；它不是 DMG，且未签名。
- `.github/workflows/build.yml` 会在 GitHub Actions 上构建 Windows、macOS arm64 与 Linux 三平台产物。

## 目录结构

```
src/
├── main/        # 窗口、配置、三协议客户端、审查与工具沙箱、MCP、技能、OAuth
├── preload/     # contextBridge IPC 白名单
└── renderer/    # 对话、上下文圆环、斜杠命令、终端、设置、引导
```

## 许可证

GNU General Public License v3.0，详见 [LICENSE](LICENSE)。
