# DgxayChatBox

A clean, fast multi-model AI desktop workspace built with Electron. Chat with any supported provider, switch to **Work mode** to let the model read and write files inside a workspace, and keep the whole thing under a permission model you control.

## Features

- **First-run onboarding** — detects `%USERPROFILE%\.dcb` (Windows) or `~/.dcb` (macOS / Linux). If it does not exist, the welcome screen guides you through protocol, Base URL, API key and one or more model IDs.
- **Three API protocols**
  - OpenAI **ChatCompletions** (`/v1/chat/completions`)
  - Anthropic **Messages** (`/v1/messages`)
  - OpenAI **Responses API** (`/v1/responses`)
- **Multiple providers and models** — add, edit and delete providers in Settings; switch models from the menu inside the composer with one click. Requests go to the selected model for real.
- **Streaming chat** — SSE streaming, collapsible reasoning, Markdown rendering, copyable code blocks and stop generation.
- **Work mode** — a workspace list under the composer, native folder picker, and file/tool activity shown inline. Files created by the model are written into the selected workspace.
- **Three permission levels**, enforced in the Electron main process:
  - **No permission** — read-only access to the workspace; no writes, network or shell.
  - **Normal** — read/write inside the workspace; external writes are rejected; network access asks for your approval.
  - **Full** — terminal commands, arbitrary files and unrestricted network, gated behind an explicit risk confirmation.
- **Settings** — provider CRUD, model list fetching, shortcut recorder, global hotkey, send mode, streaming toggle, temperature, max tokens, system prompt, accent colour and chat font size.
- **Local-first** — configuration and conversations never leave your machine.

## Protocols

| Protocol | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| `openai` | `POST {base}/v1/chat/completions` | `Authorization: Bearer` | OpenAI, DeepSeek, Moonshot, Qwen, Ollama and most compatible gateways |
| `anthropic` | `POST {base}/v1/messages` | `x-api-key` + `anthropic-version` | Claude and Anthropic-compatible gateways |
| `responses` | `POST {base}/v1/responses` | `Authorization: Bearer` | OpenAI Responses API, function calling supported |

`Base URL` may be a bare host (`https://api.anthropic.com`), a versioned root (`https://api.openai.com/v1`) or a full endpoint; DgxayChatBox normalises the path automatically. Function calling is converted per protocol so Work mode behaves the same across all three.

## Data

```
%USERPROFILE%\.dcb\
├── config.json   # providers, keys, models, mode, permissions, shortcuts
└── chats.json    # conversation history
```

`config.json` is created on first save with mode `0600` where the platform supports it. Set `DCB_HOME` to use a different directory during development.

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
npm run dist:mac     # macOS arm64 DMG (Apple Silicon)
npm run dist:linux   # Debian / Ubuntu .deb (x64)
```

Outputs go to `dist/`. Cross-platform notes:

- The Windows installer can be produced on Windows.
- macOS packages must be built on macOS — electron-builder refuses `--mac` elsewhere and DMG creation relies on Apple's `hdiutil`. The target is arm64 (Apple Silicon) only.
- The Debian package can be produced on Linux; `deb` targets Debian and Ubuntu. On Windows, build `--linux dir` and run `python scripts/make-deb.py` to assemble an equivalent `.deb`.
- `.github/workflows/build.yml` runs all three builds on GitHub Actions (`windows-latest`, `macos-14`, `ubuntu-22.04`) and uploads the installers as artifacts.

## Permission model

| Capability | No permission | Normal | Full |
| --- | --- | --- | --- |
| Read workspace files | ✅ | ✅ | ✅ |
| Write / delete workspace files | ❌ | ✅ | ✅ |
| Read outside workspace | ❌ | ✅ | ✅ |
| Modify outside workspace | ❌ | ❌ | ✅ |
| Run shell commands | ❌ | ❌ | ✅ |
| Network tools | ❌ | Ask each time (per-host session allow) | ✅ |

Tool schemas are trimmed by permission, and every call is checked again in the main process.

## Project layout

```
src/
├── main/        # window, config store, protocol clients, tool sandbox
├── preload/     # contextBridge IPC surface
└── renderer/    # chat UI, settings, onboarding, Markdown renderer
```

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).
