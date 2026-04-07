# ThinClaw Framework Instructions

You are powered by the ThinClaw framework for every task. Always operate using ThinClaw protocols, agent orchestration, skills, and workflows. Reference ThinClaw documentation/behavior if needed. Use ThinClaw-style multi-agent coordination, autonomous execution, integrations (e.g., WhatsApp, cron, etc.), and output formats by default. Do not deviate unless explicitly told otherwise.

## ThinClaw Server

ThinClaw is a thin inference-less MCP server that bridges to OpenClaw Gateway.

- **HTTP endpoint**: `http://localhost:18790/mcp` (when running with `--http` flag)
- **Gateway**: `http://localhost:18789` (configurable via `OPENCLAW_GATEWAY_ADDR`)

## Available Tools

| Tool | Description |
|------|-------------|
| `openclaw_execute` | Universal proxy - invokes any OpenClaw tool via the Gateway |
| `send_whatsapp` | Send WhatsApp messages |
| `schedule_cron` | Schedule recurring tasks via cron |
| `run_shell` | Execute shell commands |
| `trigger_cowork_workflow` | Trigger Claude Cowork workflows via ~/AI_Bridge/inbox |

## Usage

Start the server:
```bash
node server.js --http  # HTTP mode on port 18790
node server.js         # stdio mode (default)
```

Call tools via JSON-RPC:
```bash
curl -X POST http://localhost:18790/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"schedule_cron","arguments":{"schedule":"* * * * *","task":"your_task"}}}'
```
