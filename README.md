# DgxayChatBox V1.1

A clean, local-first multi-model AI desktop workspace built with Electron. Chat with any supported provider, hand file and terminal work to the model under a reviewed permission system, and keep full control over what runs on your machine.

## Highlights

- **Three API protocols** — OpenAI ChatCompletions, Anthropic Messages and OpenAI Responses.
- **Normal and auto-review are separate** — Normal asks you before every operation; Auto-review asks a safety model first and only escalates suspicious actions. Auto-review appears only when a reviewer is configured.
- **Context ring** — a light-grey ring beside the model picker fills with dark grey as the context window is consumed. Click it for a detailed token breakdown.
- **Slash commands** — `/压缩` compresses the conversation into a compact summary; `/技能` lists installed skills and `/技能 <name>` enables one for the current chat.
- **Terminal commands** — type `!` followed by a shell command. A terminal card appears in the conversation and streams stdout/stderr back inline.
- **MCP management** — a Settings → MCP page to add, start, stop and inspect MCP servers. The model can install a server configuration for you with the `install_mcp_server` tool.
- **Per-provider review model** — each provider can nominate its own safety reviewer; providers without one fall back to the first (default) provider's reviewer.
- **OAuth account connections** — Settings → Accounts connects OpenAI, Anthropic, xAI and Google with PKCE (manual code where required).
- **Local-first** — configuration, conversations, OAuth tokens and MCP definitions stay in `~/.dcb`.

## Protocols

| Protocol | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| `openai` | `POST {base}/v1/chat/completions` | `Authorization: Bearer` | OpenAI, DeepSeek, Moonshot, Qwen, Ollama and compatible gateways |
| `anthropic` | `POST {base}/v1/messages` | `x-api-key` + `anthropic-version` | Claude and Anthropic-compatible gateways |
| `responses` | `POST {base}/v1/responses` | `Authorization: Bearer` | OpenAI Responses API with function calling |

Base URL can be a bare host (`https://api.anthropic.com`), a versioned root (`https://api.openai.com/v1`) or a full endpoint. Tool calls are converted per protocol, so Work mode behaves the same across all three.

## Permission model (V1.1)

| Capability | None | Normal | Auto-review | Full |
| --- | --- | --- | --- | --- |
| Read workspace files | ✅ | ✅ | ✅ | ✅ |
| Write / delete files | ❌ | ✅ (ask each time) | ✅ (reviewed) | ✅ |
| Access files outside workspace | ❌ | ✅ (ask each time) | ✅ (reviewed) | ✅ |
| Run terminal commands | ❌ | ✅ (ask each time) | ✅ (reviewed) | ✅ |
| Network tools | ❌ | ✅ (ask each time) | ✅ (reviewed) | ✅ |
| Approval flow | — | User approves every operation | Reviewer allows, user decides suspicious ones | None |

**Normal permission** has every capability, but each tool call and `!` terminal command opens an approval dialog.

**Auto-review** also has every capability, but goes through the safety model first:

1. The configured **auto-review model** receives the operation, arguments, workspace and command, and returns `allow` or `review`.
2. `allow` → the operation runs immediately and the UI shows an “自动审查 / Auto-reviewed” badge.
3. `review` → a modal shows the operation and the reviewer's reason; you can allow once or reject.

Configure the reviewer in **Settings → Providers → Edit provider → 自动审查模型**. Auto-review is only listed when at least one reviewer exists. A provider without its own reviewer uses the first provider's reviewer.

## OAuth accounts

**Settings → Accounts** connects four providers:

| Provider | Callback | Notes |
| --- | --- | --- |
| OpenAI | loopback `localhost:1455` | ChatGPT / Codex subscription accounts |
| Anthropic | manual code paste | Claude accounts; subscription tokens may be restricted for third-party apps |
| xAI | loopback, random port | SuperGrok / X Premium+ |
| Google | loopback, random port | requires your own Desktop OAuth client and the Generative Language API |

Authorization happens in the system browser with PKCE. Tokens are stored in `~/.dcb/oauth.json` (mode `0600`, encrypted with Electron safeStorage when available) and refreshed automatically. A provider can then choose the account under **Authentication**; switch back to an API key at any time if the platform rejects subscription tokens.

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

The app creates a terminal card in the conversation, runs the command in the current workspace (or the home directory), and streams stdout/stderr live with the exit code. Normal asks every time, Auto-review checks first, Full runs directly, and None rejects. Terminal output is also added to the AI context.

## Work-mode continuity

Work mode injects a task discipline into the system prompt: split the task into steps, start calling tools immediately, never stop before the task is actually complete, and never substitute a plan or “I'll now…” for action. Each tool result continues the loop; the model verifies key output and only then summarises.

The main process also guards against premature stops: an empty reply, a length cutoff, or a future-tense promise (“I'll now… / 接下来我会…”) triggers an automatic “continue until complete” nudge, at most twice.

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
