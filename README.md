# chatgpt-app-emulator

Local emulator of the ChatGPT host for MCP apps with UI. Point it at a local MCP server and test the whole flow (prompt, tool call, widget) without a tunnel, a connector refresh, or a new chat.

## Run

```bash
pnpm install
pnpm dev --server http://localhost:8787/mcp
```

Open http://localhost:4310.

A fixture MCP app (dice widget on the MCP Apps bridge, counter widget on `window.openai`) lives in `fixtures/dice`:

```bash
pnpm fixture:dice
```

## Model

Pick a provider with `--provider` or `EMU_PROVIDER`, and a model with `--model` or `EMU_MODEL`.

- `chatgpt` (default): your local ChatGPT subscription through `chatgpt()` from `eve/models/openai`. No API key. Needs the Codex CLI signed in (`codex login`), which eve uses only as the token source. Example: `pnpm dev --model gpt-6-sol`.
- `openai`: the OpenAI API with `OPENAI_API_KEY`.
- `scripted`: no model. Type `/tool_name {"arg": 1}` in the chat to drive a tool call deterministically.

## What is emulated

- MCP Apps bridge (`ui/*` JSON-RPC over `postMessage`) through the official `AppBridge`.
- `window.openai` globals and methods: `toolInput`, `toolOutput`, `toolResponseMetadata`, `widgetState`, `setWidgetState`, `callTool`, `sendFollowUpMessage`, `requestDisplayMode`, `openExternal`, `notifyIntrinsicHeight`, `openai:set_globals`.
- Widgets run on a separate origin with a CSP built from `_meta.ui.csp` or `openai/widgetCSP`.
- Watch mode: tools and widget HTML are re-read continuously, widgets reload when their resource changes.

Model behaviour is an approximation: same tool metadata, different system prompt and harness than ChatGPT. Do a final check in ChatGPT before release.
