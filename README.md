# DgxayChatBox V1.1

A clean, local-first multi-model AI desktop workspace built with Electron. Chat with any supported provider, hand file and terminal work to the model under a reviewed permission system, and keep full control over what runs on your machine.

## Highlights

- **Three API protocols** — OpenAI ChatCompletions, Anthropic Messages and OpenAI Responses.
- **Reviewed normal permission** — full capabilities, but every tool call is reviewed by a dedicated safety model before it runs; suspicious actions are handed to you.
- **Context ring** — a light-grey ring beside the model picker fills with dark grey as the context window is consumed. Click it for a detailed token breakdown.
- **Slash commands** — `/压缩` compresses the conversation into a compact summary; `/技能` lists installed skills and `/技能 <name>` enables one for the current chat.
- **Terminal commands** — type `!` followed by a shell command. A terminal card appears in the conversation and streams stdout/stderr back inline.
- **MCP management** — a Settings → MCP page to add, start, stop and inspect MCP servers. The model can install a server configuration for you with the `install_mcp_server` tool.
- **Per-provider review model** — each provider can nominate its own safety reviewer; providers without one fall back to the first (default) provider's reviewer.
- **Local-first** — configuration, conversations and MCP definitions stay in `~/.dcb`.

## Protocols

| Protocol | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| `openai` | `POST {base}/v1/chat/completions` | `Authorization: Bearer` | OpenAI, DeepSeek, Moonshot, Qwen, Ollama and compatible gateways |
| `anthropic` | `POST {base}/v1/messages` | `x-api-key` + `anthropic-version` | Claude and Anthropic-compatible gateways |
| `responses` | `POST {base}/v1/responses` | `Authorization: Bearer` | OpenAI Responses API with function calling |

Base URL can be a bare host (`https://api.anthropic.com`), a versioned root (`https://api.openai.com/v1`) or a full endpoint. Tool calls are converted per protocol, so Work mode behaves the same across all three.

## Permission model (V1.1)

| Capability | None | Normal | Full |
| --- | --- | --- | --- |
| Read workspace files | ✅ | ✅ | ✅ |
| Write / delete files | ❌ | ✅ (reviewed) | ✅ |
| Access files outside workspace | ❌ | ✅ (reviewed) | ✅ |
| Run terminal commands | ❌ | ✅ (reviewed) | ✅ |
| Network tools | ❌ | ✅ (reviewed) | ✅ |
| Approval flow | — | Auto-review, then user if suspicious | None |

**Normal permission** now has every capability by default, but each actual tool call (and each `!` terminal command) goes through this flow:

1. The configured **auto-review model** receives the operation, arguments, workspace and command, and returns `allow` or `review`.
2. `allow` → the operation runs immediately and the UI shows an “自动审查 / Auto-reviewed” badge.
3. `review` → a modal shows the operation and the reviewer's reason; you can allow once or reject.

Configure the reviewer in **Settings → Providers → Edit provider → 自动审查模型**. If a provider has no reviewer, the first provider's reviewer is used. If neither is configured, every operation asks you directly.

## Context ring

The ring sits left of the model picker:

- Light grey track = 100% of the model context window.
- Dark grey arc = estimated usage, growing with each message.
- Click it for used / total tokens, remaining space, message count, current model and active skill.
- Context window per model can be set in the provider editor; otherwise defaults are used (128k for ChatCompletions, 200k for Anthropic / Responses).

Usage is estimated from characters (CJK counts as one token); the model's returned `usage` remains authoritative.

## Slash commands

Type `/` at the start of the composer:

| Command | Behaviour |
| --- | --- |
| `/压缩` (or `/compress`) | Calls the active model to summarise the conversation, then replaces history with the summary. Keeps goals, decisions, paths and pending work. |
| `/技能` (or `/skill`) | Lists skills installed in `~/.dcb/skills`. |
| `/技能 <name> [prompt]` | Enables the skill for this conversation and optionally sends `prompt`. |

**Skills** can be a folder containing `SKILL.md` or a single `name.md` file, with optional frontmatter:

```markdown
---
name: report-writer
description: Writes weekly reports in a fixed format
---

Instructions the model should follow in this conversation…
```

The enabled skill is shown as a chip in the composer and persisted with the chat.

## Terminal commands

Start a message with `!`:

```
!git status
!npm test
```

The app creates a terminal card in the conversation, runs the command in the current workspace (or the home directory), and streams stdout/stderr live with the exit code. In Normal permission the command is reviewed/approved first; in Full permission it runs directly; in None it is rejected. Terminal output is also added to the AI context.

## MCP

**Settings → MCP** lists MCP servers from `~/.dcb/mcp.json`, with start/stop, live logs, PID, working directory and delete. You can add a server manually (name, command, args, env, cwd) or ask the model to install one:

> 帮我安装 filesystem MCP，允许访问我的项目目录

The model calls `install_mcp_server`; once installed, open Settings → MCP and press **启动**.

MCP configurations are stored in `~/.dcb/mcp.json`. Servers are stopped when the app quits.

## Data

```
%USERPROFILE%\.dcb\
├── config.json   # providers, models, review models, modes, shortcuts
├── chats.json    # conversation history, skills and terminal output
├── mcp.json      # MCP server definitions
└── skills/       # installed skills (SKILL.md or name.md)
```

`config.json` is written with mode `0600` where supported. Set `DCB_HOME` to use another directory during development.

## Development

Requirements: Node.js 18+ and npm.

```bash
npm install
npm start        # launch
npm run dev      # launch with DevTools
```

The renderer is plain HTML/CSS/ES Modules — there is no frontend build step.

## Packaging

```bash
npm run dist         # Windows x64 installer (NSIS)
npm run dist:mac     # macOS arm64 DMG (Apple Silicon, must run on macOS)
npm run dist:linux   # Debian / Ubuntu .deb (x64, run on Linux)
```

Outputs go to `dist/`. Notes:

- macOS packaging is blocked on non-macOS hosts by electron-builder; DMG creation also needs `hdiutil`. Use a Mac or the included `macos-14` GitHub Actions job.
- On Windows, `npx electron-builder --linux dir --x64` plus `python scripts/make-deb.py` produces a valid Debian package without `fpm`.
- On Windows, a portable arm64 `.app` zip can be assembled with `@electron/packager` and `python scripts/make-mac-zip.py`; it is not a DMG and is unsigned.
- `.github/workflows/build.yml` builds Windows, macOS arm64 and Linux packages on GitHub Actions.

## Project layout

```
src/
├── main/        # window, config, protocol clients, approval & review, tools, MCP, skills
├── preload/     # contextBridge IPC surface
└── renderer/    # chat, context ring, slash commands, terminal UI, settings, onboarding
```

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).
