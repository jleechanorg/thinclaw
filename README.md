# thinclaw

**Thin inference-less MCP server for OpenClaw Gateway.**

A zero-inference bridge that exposes OpenClaw tool execution via the Model Context Protocol (MCP) stdio transport. Claude Cowork (or Perplexity, Claude Desktop) provides all reasoning — this server only relays tool calls to the local OpenClaw Gateway.

## Architecture

```
┌─────────────────┐  MCP stdio   ┌──────────────┐  HTTP REST  ┌──────────────────┐
│  Claude Cowork  │ ───────────► │   thinclaw   │ ──────────► │  OpenClaw         │
│  Perplexity     │  zero LLM    │   (this)     │  /tools/    │  Gateway          │
│  Claude Desktop │ ◄─────────── │  Node.js     │  invoke     │  localhost:18789  │
└─────────────────┘  tool result └──────────────┘ ◄────────── └──────────────────┘

Cognitive split:
  Claude Cowork  = brain (reasoning, planning, Computer Use, Projects, Dispatch)
  OpenClaw       = body  (file ops, bash, Slack, Git — pure daemon, no LLM calls)
  thinclaw       = bridge (stdio ↔ REST, zero inference)
```

**Zero inference by design.** The calling AI decides *what* to do. This server only carries *how*. No model, no tokens, no latency from inference.

## Prerequisites

- Node.js 18+
- OpenClaw Gateway running locally on `http://localhost:18789`
- Gateway auth token (auto-read from `~/.openclaw/openclaw.json` or set via `GATEWAY_TOKEN` env)

### Getting the Gateway Token

```bash
cat ~/.openclaw/openclaw.json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print(d['gateway']['auth']['token'])"
```

## Quick Start

```bash
git clone https://github.com/jleechanorg/thinclaw.git
cd thinclaw
npm install

# Run — token auto-read from ~/.openclaw/openclaw.json
npm start
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_GATEWAY_ADDR` | `http://localhost:18789` | OpenClaw Gateway base URL (preferred) |
| `GATEWAY_URL` | `http://localhost:18789` | Alias for OPENCLAW_GATEWAY_ADDR |
| `GATEWAY_TOKEN` | auto-read from `~/.openclaw/openclaw.json` | Bearer token for Gateway auth |

## Available Tools

### `openclaw_execute`

Universal execution proxy. Calls `POST /tools/invoke` on the Gateway.

```json
{
  "tool": "bash",
  "params": { "command": "ls -la ~", "cwd": "/tmp", "timeoutSeconds": 30 }
}
```

Supports any OpenClaw tool: `bash`, `read_file`, `grep`, `todo_list_write`, `slack_postMessage`, etc.

### `send_whatsapp`

Send a WhatsApp message. Calls `POST /tools/invoke` with tool=`whatsapp_send`.

```json
{
  "to": "+1234567890",
  "message": "Hello from thinclaw!"
}
```

> Requires `whatsapp_send` to be a registered OpenClaw tool.

### `schedule_cron`

Schedule a recurring cron task via the Gateway. Calls `POST /tools/invoke` with tool=`schedule_cron`.

```json
{
  "schedule": "*/5 * * * *",
  "task": "check-deployments"
}
```

> Requires `schedule_cron` to be a registered OpenClaw tool.

### `run_shell`

Execute a shell command directly. Calls `POST /tools/invoke` with tool=`bash`.

```json
{
  "command": "find . -name '*.log' | head -5"
}
```

> Requires `bash` to be a registered OpenClaw tool.

### `trigger_cowork_workflow`

Write a JSON flag file to `~/AI_Bridge/inbox/` for cron → Cowork handoff. The calling AI (Cowork) monitors this directory and picks up work on its next inference cycle.

```json
{
  "workflow": "daily-standup",
  "context": { "channel": "#engineering", "time": "09:30" }
}
```

This creates `~/AI_Bridge/inbox/trigger-<timestamp>.json`.

## AI_Bridge Folder

Created automatically at `~/AI_Bridge/` with three subdirectories:

```
~/AI_Bridge/
  inbox/       — flag files written by thinclaw (cron → Cowork handoff)
  outbox/      — Cowork writes results here after processing
  processed/   — moved here after Cowork consumes them
```

Cowork monitors `~/AI_Bridge/inbox/` and reacts to new `trigger-*.json` files.

## MCP Client Setup

### Claude Desktop (macOS)

1. Open `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add the thinclaw MCP server:

```json
{
  "mcpServers": {
    "thinclaw": {
      "command": "node",
      "args": ["/absolute/path/to/thinclaw/server.js"],
      "env": {
        "GATEWAY_TOKEN": "your-token-here"
      }
    }
  }
}
```

3. Restart Claude Desktop

### Claude Cowork (claude.ai)

Configure via the Cowork MCP settings panel:

| Field | Value |
|---|---|
| Command | `node` |
| Args | `/absolute/path/to/thinclaw/server.js` |
| Env | `GATEWAY_TOKEN=your-token-here` |

Cowork will then have access to all five tools. Zero inference on the thinclaw side.

### Perplexity Computer

Perplexity's computer use also supports MCP stdio. Configure similarly:

```bash
GATEWAY_TOKEN=$(cat ~/.openclaw/openclaw.json | python3 -c \
  "import json,sys; print(json.load(sys.stdin)['gateway']['auth']['token'])") \
  node /path/to/thinclaw/server.js
```

## HTTP Transport Mode

By default, thinclaw uses **stdio** transport (Claude Desktop, Cowork, Perplexity). Pass `--http` to switch to HTTP mode for clients that prefer HTTP JSON-RPC:

```bash
node server.js --http
# thinclaw HTTP server listening on http://localhost:18790/mcp
```

| Env var | Default | Description |
|---|---|---|
| `THINCLAW_HTTP_PORT` | `18790` | HTTP server port |

HTTP mode accepts `POST /mcp` with JSON-RPC 2.0 `tools/list` and `tools/call` requests. CORS is enabled for cross-origin access.

```bash
# Example: list tools via HTTP
curl -X POST http://localhost:18790/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Auto-Start with launchd (macOS)

Create `~/Library/LaunchAgents/com.thinclaw.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.thinclaw</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/jleechan/thinclaw/server.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENCLAW_GATEWAY_ADDR</key><string>http://localhost:18789</string>
    <key>GATEWAY_TOKEN</key><string>YOUR_TOKEN_HERE</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.thinclaw.plist
```

Verify:

```bash
launchctl print gui/$(id -u)/com.thinclaw
```

## Gateway Endpoints Reference

thinclaw proxies all tools to the single Gateway REST endpoint `POST /tools/invoke`:

| thinclaw Tool | Gateway Tool Name | Params |
|---|---|---|
| `openclaw_execute` | (any tool name) | `{ tool, params }` |
| `send_whatsapp` | `whatsapp_send` | `{ to, message }` |
| `schedule_cron` | `schedule_cron` | `{ schedule, task }` |
| `run_shell` | `bash` | `{ command }` |
| `trigger_cowork_workflow` | (local FS only) | writes `~/AI_Bridge/inbox/trigger-<ts>.json` |

> **Note:** Gateway tools must be registered in your OpenClaw config. `memory_search` is the only tool confirmed available in the default staging gateway. Other tools (`bash`, `whatsapp_send`, etc.) require corresponding OpenClaw plugins or agent tools to be enabled.

## Expanding with More Tools

Each tool is a thin wrapper around a Gateway endpoint. To add a new tool:

1. Add a Zod schema at the top of `server.js`
2. Add a case in the `CallToolRequestSchema` switch
3. Add the tool definition in `ListToolsRequestSchema`

**Example — add `openclaw_memory_search`:**

```javascript
// Schema
const MemorySearchSchema = z.object({
  query: z.string(),
  limit: z.number().optional().default(5),
});

// In switch:
if (name === "openclaw_memory_search") {
  const { query, limit } = MemorySearchSchema.parse(args);
  const response = await gateway.post("/memory/search", { query, limit });
  return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
}

// In ListToolsRequestSchema:
{
  name: "openclaw_memory_search",
  description: "Search OpenClaw memory via POST /memory/search.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      limit: { type: "number", description: "Max results (default 5)" },
    },
    required: ["query"],
  },
}
```

## Security Notes

- This server runs locally and communicates with the local Gateway only
- `GATEWAY_TOKEN` grants full access to all OpenClaw tools — treat it like a secret
- No data leaves your machine except to `localhost:18789`
- All inference happens entirely in the calling AI (Claude Cowork, Perplexity, etc.)

## License

MIT
