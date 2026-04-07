# thinclaw

**Thin inference-less MCP server for OpenClaw Gateway.**

This server exposes OpenClaw tools via the Model Context Protocol (MCP) stdio transport. It performs **zero LLM inference** — it is a pure HTTP relay that proxies tool calls to the local OpenClaw Gateway. External AIs (Claude Desktop, Perplexity Computer, Claude Cowork, etc.) provide all reasoning; this server just handles transport.

## Architecture

```
┌─────────────┐     MCP stdio      ┌──────────────┐    HTTP REST    ┌──────────────┐
│  Perplexity │ ─────────────────► │   thinclaw   │ ──────────────► │ OpenClaw     │
│  Claude     │   zero inference   │   (this)     │  /tools/invoke  │ Gateway      │
│  Cowork     │ ◄───────────────── │              │ ◄────────────── │ localhost    │
│  Desktop    │   tool result      └──────────────┘    JSON result   │  :18789      │
└─────────────┘                   (Node.js, no LLM)                    └──────────────┘
```

**Key design principle:** The calling AI decides *what* to do. This server only carries *how* to do it. No model, no inference, no token generation.

## Prerequisites

- Node.js 18+
- OpenClaw Gateway running locally on `http://localhost:18789`
- Gateway auth token (auto-read from `~/.openclaw/openclaw.json` or set via `GATEWAY_TOKEN` env)

## Quick Start

```bash
# Install
git clone https://github.com/jleechanorg/thinclaw.git
cd thinclaw
npm install

# Run (uses token from ~/.openclaw/openclaw.json automatically)
npm start
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_URL` | `http://localhost:18789` | OpenClaw Gateway base URL |
| `GATEWAY_TOKEN` | auto-read from `~/.openclaw/openclaw.json` | Bearer token for Gateway auth |

## Available Tools

### `openclaw_execute`

Universal execution proxy. Calls `POST /tools/invoke` on the Gateway.

```json
{
  "tool": "bash",
  "params": { "command": "ls -la", "cwd": "/tmp", "timeoutSeconds": 30 }
}
```

Or invoke a full skill:

```json
{
  "skill": "debugging",
  "params": { "issue": "server crashing on startup" }
}
```

### `send_whatsapp`

Convenience wrapper around the OpenClaw `whatsapp_send` tool.

```json
{
  "to": "+1234567890",
  "body": "Hello from thinclaw!"
}
```

### `run_shell`

Convenience wrapper around the OpenClaw `bash` tool.

```json
{
  "command": "find . -name '*.log' | head -5",
  "cwd": "/Users/jleechan",
  "timeout": 30
}
```

## MCP Client Setup

### Claude Desktop (macOS)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

### Claude Cowork (claude.ai)

Cowork uses the MCP stdio connector. Configure via the Cowork MCP settings panel with:

- **Command:** `node`
- **Args:** `/absolute/path/to/thinclaw/server.js`
- **Env:** `GATEWAY_TOKEN=your-token-here`

### Perplexity Computer

Perplexity's computer use also supports MCP stdio. Configure similarly:

```bash
# Or run directly to verify
GATEWAY_TOKEN=$(node -e "console.log(require('/Users/jleechan/.openclaw/openclaw.json').gateway.auth.token)") \
  node server.js
```

## Auto-Start (launchd on macOS)

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
    <key>GATEWAY_URL</key><string>http://localhost:18789</string>
    <key>GATEWAY_TOKEN</key><string>YOUR_TOKEN_HERE</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

Then:

```bash
launchctl load ~/Library/LaunchAgents/com.thinclaw.plist
```

## Expanding with More Tools

Each tool in this server is a thin wrapper around a Gateway endpoint. To add a new tool:

1. Add a Zod schema in `server.js`
2. Add the handler in the `CallToolRequestSchema` switch
3. Add the tool definition in `ListToolsRequestSchema`
4. Update this README

Example — add `openclaw_memory_search`:

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
```

## Gateway Endpoints Reference

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/tools/invoke` | Invoke any OpenClaw tool |
| `POST` | `/skills/<name>/invoke` | Invoke a named skill |
| `GET` | `/health` | Gateway health check |

## Security Notes

- This server runs locally and communicates with the local Gateway only
- The `GATEWAY_TOKEN` grants full access to all OpenClaw tools — treat it like a secret
- No data leaves your machine except to `localhost:18789`
- Inference happens entirely in the calling AI (Perplexity, Claude, etc.)

## License

MIT
