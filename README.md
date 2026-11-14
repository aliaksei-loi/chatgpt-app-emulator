# chatgpt-app-emulator

Local emulator of the ChatGPT host for MCP apps with UI. Point it at a local MCP server and test the whole flow (prompt, tool call, widget) without a tunnel, a connector refresh, or a new chat.

## Run

```bash
pnpm install
pnpm dev --server http://localhost:8787/mcp
```

Open http://localhost:4310. Click the server URL in the header to connect to another MCP server without restarting.

## Examples

The **Examples** menu in the header starts a ready-made MCP app and connects to it. The emulator downloads, builds and runs the example itself, then shows prompts to try. Only one example runs at a time, on port 8000.

| Id | What it is |
| --- | --- |
| `fixture` | Dice widget on the MCP Apps bridge and a counter on `window.openai` (lives in `fixtures/dice`) |
| `quickstart-dice` | The public server from the plugins quickstart, tools only |
| `quickstart-todo` | The to-do app from the MCP server and UI quickstart |
| `basics` | Eleven widgets, one per host bridge feature |
| `pizzaz` | Map, carousel, albums, list and shop widgets |
| `kitchen-sink` | The whole `window.openai` surface in one widget |
| `cards` | Cards Against AI, with a declared CSP and a live state stream |
| `solar-system`, `shopping-cart`, `pizzaz-python` | Python servers, need [uv](https://docs.astral.sh/uv/) |

Start one from the command line:

```bash
pnpm dev --example pizzaz
```

Download and build everything ahead of time (optional, the first launch does it anyway):

```bash
pnpm examples:setup
```

The official examples come from `openai/openai-apps-sdk-examples` at a pinned commit, and the to-do app is extracted from the quickstart page. Both land in `examples/.cache` (about 800 MB, not committed).

## Model

Pick a provider with `--provider` or `EMU_PROVIDER`, and a model with `--model` or `EMU_MODEL`.

- `chatgpt` (default): your local ChatGPT subscription through `chatgpt()` from `eve/models/openai`. No API key. Needs the Codex CLI signed in (`codex login`), which eve uses only as the token source. Example: `pnpm dev --model gpt-6-sol`.
- `openai`: the OpenAI API with `OPENAI_API_KEY`.
- `scripted`: no model. Type `/tool_name {"arg": 1}` in the chat to drive a tool call deterministically.

## What is emulated

- MCP Apps bridge (`ui/*` JSON-RPC over `postMessage`) through the official `AppBridge`: host context with style variables and tool info, `tool-input-partial` while the model streams arguments, `tool-input`, `tool-result`, `ui/message`, `ui/update-model-context`, `ui/open-link`, `ui/request-display-mode`, size changes. MCP Apps widgets mount as soon as the tool call starts.
- `window.openai` globals and methods for legacy widgets: `toolInput`, `toolOutput`, `toolResponseMetadata`, `widgetState`, `setWidgetState`, `callTool`, `sendFollowUpMessage`, `requestDisplayMode`, `openExternal`, `notifyIntrinsicHeight`, `openai:set_globals`, plus the `window.webplus` alias. Widget state is kept per `openai/widgetSessionId`.
- Widget state and `ui/update-model-context` are shared with the model on the next turn.
- Widgets run on a separate origin (`127.0.0.1`) at the root path, so client-side routers work.
- CSP: a widget that declares `_meta.ui.csp` or `openai/widgetCSP` gets exactly that policy. A widget that declares none loads without restrictions and is flagged, because the official examples rely on that.
- Streamable HTTP and SSE transports.
- Watch mode: tools and widget HTML are re-read continuously, widgets reload when their resource changes.

Checked against the quickstart server and the official examples repository (`openai/openai-apps-sdk-examples`): MCP app basics, Pizzaz (Node and Python), kitchen sink (Node), Cards Against AI, solar system, shopping cart.

Not emulated: OAuth for protected MCP servers, `requestModal`, file APIs, checkout.

Model behaviour is an approximation: same tool metadata, different system prompt and harness than ChatGPT. Host style variable values, the host name, and the CSP default are inferred, not copied from ChatGPT. Do a final check in ChatGPT before release.

## Security

The local API accepts requests only from the emulator page (Host and Origin checks, JSON bodies) and listens on `127.0.0.1`. Widgets can open only `http` and `https` links.

## License

MIT, see [LICENSE](LICENSE). The files in `src/client/beautifui` come from Beautiful UI and keep their own MIT license in that folder.
