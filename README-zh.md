# DgxayChatBox

一个简洁、明快的多模型 AI 桌面工作台，基于 Electron 构建。支持三种主流模型协议，在对话模式与工作模式之间切换，并让 AI 在受控权限下直接处理本地文件。

## 功能

- **首次启动引导**：检测 `%USERPROFILE%\.dcb`（Windows）或 `~/.dcb`（macOS / Linux）。目录或配置不存在时进入欢迎页，依次选择协议、填写 Base URL、API Key 与模型 ID，支持一次添加多个模型。
- **三种接口协议**
  - OpenAI **ChatCompletions**`/v1/chat/completions`
  - Anthropic **Messages**`/v1/messages`
  - OpenAI **Responses API**`/v1/responses`
- **多供应商 / 多模型**：设置中可新增、修改、删除供应商，拉取模型列表；输入框右下角的菜单可随时切换模型，请求会真实发送到所选模型。
- **流式对话**：SSE 流式输出、推理过程折叠、Markdown 渲染、代码块一键复制、中断生成。
- **工作模式**：输入框下方显示工作空间列表与三档权限；点击「选择文件夹」或当前工作空间会弹出系统文件夹选择器。AI 生成的文件写入所选工作空间，并以内联工具卡片与文件标签展示。
- **三档权限**（主进程强制执行，渲染层无法绕过）：
  - **无权限**：只能只读访问工作空间，禁止写文件、联网与执行命令。
  - **普通权限**：可读写工作空间内文件，禁止修改外部文件；联网逐次申请授权，可对同一域名选择本次运行内始终允许。
  - **完全权限**：可执行终端命令、访问任意文件、无限制联网，切换时必须勾选风险确认。
- **设置中心**：供应商管理、快捷键录制、全局唤起、发送方式、流式开关、温度、最大回复长度、系统提示词、强调色与对话字号。
- **本地优先**：配置与对话只保存在本机用户目录，不经过第三方服务器。

## 协议支持

| 协议 | 请求地址 | 鉴权 | 适用场景 |
| --- | --- | --- | --- |
| `openai` | `POST {base}/v1/chat/completions` | `Authorization: Bearer` | OpenAI、DeepSeek、Moonshot、Qwen、Ollama 及大多数兼容网关 |
| `anthropic` | `POST {base}/v1/messages` | `x-api-key` + `anthropic-version` | Claude 官方与 Anthropic 兼容网关 |
| `responses` | `POST {base}/v1/responses` | `Authorization: Bearer` | OpenAI Responses API，支持函数调用 |

Base URL 可以只填域名（`https://api.anthropic.com`）、带版本前缀（`https://api.openai.com/v1`）或完整端点，应用会自动补全路径。工具调用会按协议转换为 `tool_calls` / `tool_use` / `function_call`，三种协议下工作模式的行为保持一致。

## 数据与配置

```
%USERPROFILE%\.dcb\
├── config.json   # 供应商、密钥、模型、模式、权限、快捷键等
└── chats.json    # 对话记录（仅保存有消息的会话）
```

`config.json` 首次保存时自动创建，在支持 POSIX 权限的平台上以 `0600` 写入。开发时可用 `DCB_HOME` 环境变量指定其他目录。

## 开发

需要 Node.js 18+ 与 npm。

```bash
npm install
npm start        # 启动应用
npm run dev      # 启动并打开开发者工具
```

界面使用原生 HTML / CSS / ES Modules，没有前端构建步骤。

## 打包

```bash
npm run dist         # Windows x64 安装包（NSIS）
npm run dist:mac     # macOS arm64 安装包（Apple Silicon）
npm run dist:linux   # Debian / Ubuntu .deb（x64）
```

产物输出到 `dist/`。跨平台说明：

- Windows 安装包可在 Windows 上直接构建。
- macOS 安装包必须在 macOS 上构建：electron-builder 在其他平台会直接拒绝 `--mac`，DMG 也依赖系统的 `hdiutil`。目标架构为 arm64（M 系列芯片）。
- Debian 包可在 Linux 上构建，适用于 Debian 与 Ubuntu。在 Windows 上可先构建 `--linux dir`，再运行 `python scripts/make-deb.py` 生成等效的 `.deb`。
- `.github/workflows/build.yml` 会在 GitHub Actions 上并行执行三个平台的构建（`windows-latest`、`macos-14`、`ubuntu-22.04`），并上传安装包产物。

## 权限矩阵

| 能力 | 无权限 | 普通权限 | 完全权限 |
| --- | --- | --- | --- |
| 读取工作空间文件 | ✅ | ✅ | ✅ |
| 写入 / 删除工作空间文件 | ❌ | ✅ | ✅ |
| 读取工作空间外文件 | ❌ | ✅ | ✅ |
| 修改工作空间外文件 | ❌ | ❌ | ✅ |
| 执行终端命令 | ❌ | ❌ | ✅ |
| 联网工具 | ❌ | 每次申请（可记住本次运行） | ✅ |

暴露给模型的工具会随权限裁剪，每次工具调用还会在主进程中再次校验路径与权限。

## 目录结构

```
src/
├── main/        # 窗口、配置存储、三种协议客户端、工具沙箱
├── preload/     # contextBridge IPC 白名单
└── renderer/    # 对话界面、设置、引导、Markdown 渲染
```

## 许可证

GNU General Public License v3.0，详见 [LICENSE](LICENSE)。
