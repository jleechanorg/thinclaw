---
name: thinclaw-usage
description: Guide for using thinclaw MCP server — thin inference-less bridge to OpenClaw Gateway
type: user
---

# thinclaw — Thin Inference-Less MCP Server

## What thinclaw is

thinclaw is a **zero-inference MCP server** that acts as a bridge between Claude Desktop (and other MCP clients) and the OpenClaw Gateway.

```
┌─────────────────┐  MCP stdio   ┌──────────────┐  HTTP REST  ┌──────────────────┐
│  Claude Desktop │ ───────────► │   thinclaw   │ ──────────► │  OpenClaw         │
│  Claude Cowork  │   zero LLM   │   (bridge)   │  /tools/    │  Gateway         │
│  Perplexity     │ ◄─────────── │  Node.js     │  invoke     │  localhost:18789 │
└─────────────────┘  tool result└──────────────┘ ◄────────── └──────────────────┘
```

**Zero inference by design.** The calling AI (Claude Desktop/Cowork/Perplexity) provides ALL reasoning. thinclaw only relays tool calls to the Gateway — no LLM calls, no tokens, no inference latency.

## Available Tools

| Tool | Description | Use Case |
|---|---|---|
| `openclaw_execute` | Call any OpenClaw tool via `/tools/invoke` | Universal proxy for any tool |
| `run_shell` | Execute shell commands | Run bash commands |
| `send_whatsapp` | Send WhatsApp messages | Notifications |
| `schedule_cron` | Schedule recurring tasks | Cron jobs |
| `trigger_cowork_workflow` | Trigger Cowork workflows | Handoff to Claude Cowork |

## How to Use

### Basic execution with openclaw_execute

Call any OpenClaw tool by name with params:

```
Tool: openclaw_execute
Arguments: {
  "tool": "bash",
  "params": { "command": "ls -la", "cwd": "/tmp" }
}
```

Supported tools: `bash`, `read_file`, `grep`, `todo_list_write`, `slack_postMessage`, `whatsapp_send`, `memory_search`, etc.

### Shell execution

```
Tool: run_shell
Arguments: {
  "command": "find . -name '*.js' | head -10"
}
```

### Trigger Cowork workflow

Writes a flag file to `~/AI_Bridge/inbox/trigger-<timestamp>.json` for Claude Cowork to pick up:

```
Tool: trigger_cowork_workflow
Arguments: {
  "workflow": "daily-standup",
  "context": { "channel": "#engineering", "time": "09:30" }
}
```

## Architecture Notes

- **thinclaw runs locally** — communicates only with `localhost:18789`
- **All inference happens in the calling AI** — thinclaw is a pure relay
- **Gateway token required** — auto-read from `~/.openclaw/openclaw.json` or set via `GATEWAY_TOKEN`
- **AI_Bridge folder** — `~/AI_Bridge/{inbox,outbox,processed}` for cron → Cowork handoff

## Troubleshooting

- Gateway not running? Start it: `openclaw gateway start`
- Token issues? Check: `cat ~/.openclaw/openclaw.json | jq '.gateway.auth.token'`
- Check Gateway health: `curl http://localhost:18789/health`
