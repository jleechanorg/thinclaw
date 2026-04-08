# thinclaw Roadmap

## Overview

Thin inference-less MCP server for OpenClaw Gateway. Enables Claude Cowork, Perplexity, Claude Desktop, Codex CLI, and Gemini CLI to use OpenClaw tools via MCP.

## Recent Activity (rolling)

### 2026-04-07
- Scaffolded development scripts from claude-commands: create_worktree.sh, integrate.sh, schedule_branch_work.sh, scripts/*.sh
- Adapted run_lint.sh, run_tests_with_coverage.sh, coverage.sh for Node.js/Vitest stack
- Verified lint and HTTP transport working (thinclaw listening on :18790)
- Multi-agent tools working: setup_info returns proper config with multi_agent feature flag
- Modified `openclaw-src/src/gateway/tool-resolution.ts` to allow ALL tools over HTTP (empty deny list)
- Modified `openclaw-src/src/gateway/mcp-http.ts` to support configurable bind host via OPENCLAW_MCP_BIND_HOST env var
- Goal: enable Cowork to act as LLM provider for OpenClaw, replicating OpenClaw's LLM request format
- Added 3 new tools to thinclaw server.js:
  - `list_agents`: proxies to Gateway's `agents_list` tool
  - `get_agent_profile`: retrieves agent config (with fallback)
  - `setup_info`: returns thinclaw setup info (transport, features, tools)

## Architecture

```
Claude Cowork/Code/Desktop = brain (reasoning)
OpenClaw Gateway = body (tool execution)
thinclaw = bridge (stdio/HTTP ↔ REST)
```

Zero inference by design - this server only relays tool calls.