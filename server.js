#!/usr/bin/env node
/**
 * thinclaw — Thin inference-less MCP server for OpenClaw Gateway
 *
 * Architecture:
 *   Claude Cowork / Perplexity / Claude Code = brain (ONE inference per cycle)
 *   OpenClaw = lightweight body / tool executor (pure daemon, NO Claude model)
 *   thinclaw = bridge (Node.js MCP server → OpenClaw Gateway REST, zero inference)
 *
 * Gateway: http://localhost:18789 (GATEWAY_URL / OPENCLAW_GATEWAY_ADDR env)
 * Auth:    GATEWAY_TOKEN env or ~/.openclaw/openclaw.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { createServer } from "node:http";
import { join } from "path";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GATEWAY_URL =
  process.env.OPENCLAW_GATEWAY_ADDR ||
  process.env.GATEWAY_URL ||
  "http://localhost:18789";

const GATEWAY_TOKEN =
  process.env.GATEWAY_TOKEN ||
  (() => {
    try {
      const cfg = JSON.parse(readFileSync(join(process.env.HOME || "", ".openclaw", "openclaw.json"), "utf8"));
      return cfg?.gateway?.auth?.token || "";
    } catch { return ""; }
  })();

const gateway = axios.create({
  baseURL: GATEWAY_URL,
  timeout: 120_000,
  headers: { Authorization: `Bearer ${GATEWAY_TOKEN}`, "Content-Type": "application/json" },
});

// ~/AI_Bridge for cron → Cowork handoff
const AI_BRIDGE_INBOX = join(process.env.HOME || "", "AI_Bridge", "inbox");
const AI_BRIDGE_OUTBOX = join(process.env.HOME || "", "AI_Bridge", "outbox");
const AI_BRIDGE_PROCESSED = join(process.env.HOME || "", "AI_Bridge", "processed");
for (const dir of [AI_BRIDGE_INBOX, AI_BRIDGE_OUTBOX, AI_BRIDGE_PROCESSED]) {
  try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
}

// ---------------------------------------------------------------------------
// Tool definitions (single source of truth for both transports)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "openclaw_execute",
    description:
      "Universal execution: proxies ANY OpenClaw tool via POST /tools/invoke. " +
      "Zero inference. Covers built-in tools, skills, plugins, ClawHub skills. " +
      "Tool names: exec, read, write, edit, browser, memory_search, memory_write, " +
      "cron, message, sessions_list, agents_list, tools_catalog, <any-skill-name>",
    inputSchema: {
      type: "object",
      properties: {
        tool: { type: "string", description: "Tool name (e.g. exec, read, memory_search, send_whatsapp)" },
        params: { type: "object", description: "Tool parameters as key-value pairs" },
      },
      required: ["tool"],
    },
  },
  {
    name: "file_read",
    description: "Read a file via OpenClaw read tool",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "file_write",
    description: "Write or create a file via OpenClaw write tool",
    inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
  },
  {
    name: "run_shell",
    description: "Run a shell command via OpenClaw exec tool",
    inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
  {
    name: "browser_navigate",
    description: "Control browser — navigate to URL",
    inputSchema: { type: "object", properties: { url: { type: "string" }, action: { type: "string" } }, required: ["url"] },
  },
  {
    name: "memory_lookup",
    description: "Search OpenClaw long-term memory",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
  },
  {
    name: "memory_write",
    description: "Save to OpenClaw long-term memory",
    inputSchema: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] },
  },
  {
    name: "schedule_cron",
    description: "Schedule a recurring OpenClaw cron task",
    inputSchema: { type: "object", properties: { schedule: { type: "string" }, task: { type: "string" } }, required: ["schedule", "task"] },
  },
  {
    name: "send_message",
    description: "Send a message to any channel (slack, whatsapp, discord, etc.)",
    inputSchema: { type: "object", properties: { channel: { type: "string" }, to: { type: "string" }, message: { type: "string" } }, required: ["channel", "message"] },
  },
  {
    name: "send_whatsapp",
    description: "Send a WhatsApp message",
    inputSchema: { type: "object", properties: { to: { type: "string" }, message: { type: "string" } }, required: ["to", "message"] },
  },
  {
    name: "list_tools",
    description: "List all available OpenClaw tools and skills",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "trigger_cowork_workflow",
    description: "Signal Claude Cowork via ~/AI_Bridge/inbox flag file",
    inputSchema: { type: "object", properties: { workflow: { type: "string" }, context: { type: "object" } }, required: ["workflow"] },
  },
  {
    name: "list_agents",
    description: "List available agents from OpenClaw config (multi-agent support)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_agent_profile",
    description: "Get agent profile info (name, ID, subagent settings) by agent ID",
    inputSchema: { type: "object", properties: { agent_id: { type: "string" } }, required: ["agent_id"] },
  },
  {
    name: "setup_info",
    description: "Get thinclaw setup info (Gateway URL, MCP endpoint, transport mode, features)",
    inputSchema: { type: "object", properties: {} },
  },
];

// ---------------------------------------------------------------------------
// MCP Server (stdio)
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "thinclaw", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    if (name === "openclaw_execute") {
      const { tool, params } = args;
      const r = await gateway.post("/tools/invoke", { tool, params: params || {} });
      return { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
    }
    if (name === "file_read") {
      const r = await gateway.post("/tools/invoke", { tool: "read", params: { path: args.path } });
      return { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
    }
    if (name === "file_write") {
      await gateway.post("/tools/invoke", { tool: "write", params: { path: args.path, content: args.content } });
      return { content: [{ type: "text", text: `Written to ${args.path}` }] };
    }
    if (name === "run_shell") {
      const r = await gateway.post("/tools/invoke", { tool: "exec", params: { command: args.command } });
      return { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
    }
    if (name === "browser_navigate") {
      const r = await gateway.post("/tools/invoke", { tool: "browser", params: { url: args.url, action: args.action || "navigate" } });
      return { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
    }
    if (name === "memory_lookup") {
      const r = await gateway.post("/tools/invoke", { tool: "memory_search", params: { query: args.query, limit: args.limit || 10 } });
      return { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
    }
    if (name === "memory_write") {
      await gateway.post("/tools/invoke", { tool: "memory_write", params: { key: args.key, value: args.value } });
      return { content: [{ type: "text", text: `Saved: ${args.key}` }] };
    }
    if (name === "schedule_cron") {
      const r = await gateway.post("/tools/invoke", { tool: "cron", params: { schedule: args.schedule, task: args.task } });
      return { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
    }
    if (name === "send_message") {
      await gateway.post("/tools/invoke", { tool: "message", params: { channel: args.channel, to: args.to, message: args.message } });
      return { content: [{ type: "text", text: `Sent via ${args.channel}` }] };
    }
    if (name === "send_whatsapp") {
      await gateway.post("/tools/invoke", { tool: "send_whatsapp", params: { to: args.to, message: args.message } });
      return { content: [{ type: "text", text: `Sent to ${args.to}` }] };
    }
    if (name === "list_tools") {
      const r = await gateway.post("/tools/invoke", { tool: "tools_catalog", params: {} });
      return { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
    }
    if (name === "trigger_cowork_workflow") {
      const filename = `trigger-${Date.now()}.json`;
      writeFileSync(join(AI_BRIDGE_INBOX, filename), JSON.stringify({ workflow: args.workflow, context: args.context || {}, triggered_at: new Date().toISOString() }, null, 2));
      return { content: [{ type: "text", text: `Triggered workflow: ${args.workflow}` }] };
    }
    if (name === "list_agents") {
      const r = await gateway.post("/tools/invoke", { tool: "agents_list", params: {} });
      return { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
    }
    if (name === "get_agent_profile") {
      // Try to get agent config via openclaw_execute with various possible tool names
      try {
        const r = await gateway.post("/tools/invoke", { tool: "agent_config_get", params: { agent_id: args.agent_id } });
        return { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
      } catch (e) {
        // Fallback: use config.get via openclaw_execute
        try {
          const r = await gateway.post("/tools/invoke", { tool: "openclaw_execute", params: { tool: "config", action: "get", args: { path: `agents.list.${args.agent_id}` } } });
          return { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
        } catch (e2) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Agent config not available", agent_id: args.agent_id, hint: "Use list_agents to see available agents" }) }] };
        }
      }
    }
    if (name === "setup_info") {
      const info = {
        gateway_url: GATEWAY_URL,
        transport: useHttp ? "http" : "stdio",
        http_port: useHttp ? HTTP_PORT : null,
        features: ["tools_execution", "multi_agent", "workflow_trigger"],
        available_tools: TOOLS.map(t => t.name),
      };
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    }
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err?.response) return { content: [{ type: "text", text: `Gateway error (${err.response.status}): ${JSON.stringify(err.response.data)}` }], isError: true };
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
});

// ---------------------------------------------------------------------------
// Transport: stdio (default) or HTTP (--http flag)
// ---------------------------------------------------------------------------

const useHttp = process.argv.includes("--http");
const HTTP_PORT = parseInt(process.env.THINCLAW_HTTP_PORT || "18790", 10);

if (!useHttp) {
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => { console.error("Transport error:", err); process.exit(1); });
} else {
  // HTTP server — plain JSON-RPC over POST, no streaming
  const MIME = "application/json";
  const httpServer = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.method !== "POST") { res.writeHead(405); res.end('{"error":"method not allowed"}'); return; }
    let body = ""; req.on("data", c => { body += c; });
    req.on("end", async () => {
      try {
        const { id, method, params } = JSON.parse(body);
        if (method === "tools/list") {
          res.writeHead(200, { "Content-Type": MIME });
          res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: TOOLS } }));
        } else if (method === "tools/call") {
          const { name, arguments: args = {} } = params || {};
          let result;
          try {
            // Route to the same logic as the stdio handler above
            if (name === "openclaw_execute") {
              const r = await gateway.post("/tools/invoke", { tool: args.tool, params: args.params || {} });
              result = { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
            } else if (name === "file_read") {
              const r = await gateway.post("/tools/invoke", { tool: "read", params: { path: args.path } });
              result = { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
            } else if (name === "file_write") {
              await gateway.post("/tools/invoke", { tool: "write", params: { path: args.path, content: args.content } });
              result = { content: [{ type: "text", text: `Written to ${args.path}` }] };
            } else if (name === "run_shell") {
              const r = await gateway.post("/tools/invoke", { tool: "exec", params: { command: args.command } });
              result = { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
            } else if (name === "browser_navigate") {
              const r = await gateway.post("/tools/invoke", { tool: "browser", params: { url: args.url, action: args.action || "navigate" } });
              result = { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
            } else if (name === "memory_lookup") {
              const r = await gateway.post("/tools/invoke", { tool: "memory_search", params: { query: args.query, limit: args.limit || 10 } });
              result = { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
            } else if (name === "memory_write") {
              await gateway.post("/tools/invoke", { tool: "memory_write", params: { key: args.key, value: args.value } });
              result = { content: [{ type: "text", text: `Saved: ${args.key}` }] };
            } else if (name === "schedule_cron") {
              const r = await gateway.post("/tools/invoke", { tool: "cron", params: { schedule: args.schedule, task: args.task } });
              result = { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
            } else if (name === "send_message") {
              await gateway.post("/tools/invoke", { tool: "message", params: { channel: args.channel, to: args.to, message: args.message } });
              result = { content: [{ type: "text", text: `Sent via ${args.channel}` }] };
            } else if (name === "send_whatsapp") {
              await gateway.post("/tools/invoke", { tool: "send_whatsapp", params: { to: args.to, message: args.message } });
              result = { content: [{ type: "text", text: `Sent to ${args.to}` }] };
            } else if (name === "list_tools") {
              const r = await gateway.post("/tools/invoke", { tool: "tools_catalog", params: {} });
              result = { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
            } else if (name === "trigger_cowork_workflow") {
              const filename = `trigger-${Date.now()}.json`;
              writeFileSync(join(AI_BRIDGE_INBOX, filename), JSON.stringify({ workflow: args.workflow, context: args.context || {}, triggered_at: new Date().toISOString() }, null, 2));
              result = { content: [{ type: "text", text: `Triggered workflow: ${args.workflow}` }] };
            } else if (name === "list_agents") {
              const r = await gateway.post("/tools/invoke", { tool: "agents_list", params: {} });
              result = { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
            } else if (name === "get_agent_profile") {
              try {
                const r = await gateway.post("/tools/invoke", { tool: "agent_config_get", params: { agent_id: args.agent_id } });
                result = { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }] };
              } catch (e) {
                try {
                  const r2 = await gateway.post("/tools/invoke", { tool: "openclaw_execute", params: { tool: "config", action: "get", args: { path: `agents.list.${args.agent_id}` } } });
                  result = { content: [{ type: "text", text: JSON.stringify(r2.data, null, 2) }] };
                } catch (e2) {
                  result = { content: [{ type: "text", text: JSON.stringify({ error: "Agent config not available", agent_id: args.agent_id, hint: "Use list_agents to see available agents" }) }] };
                }
              }
            } else if (name === "setup_info") {
              const info = {
                gateway_url: GATEWAY_URL,
                transport: useHttp ? "http" : "stdio",
                http_port: useHttp ? HTTP_PORT : null,
                features: ["tools_execution", "multi_agent", "workflow_trigger"],
                available_tools: TOOLS.map(t => t.name),
              };
              result = { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
            } else {
              result = { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            result = e?.response
              ? { content: [{ type: "text", text: `Gateway error (${e.response.status}): ${JSON.stringify(e.response.data)}` }], isError: true }
              : { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
          }
          res.writeHead(200, { "Content-Type": MIME });
          res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
        } else {
          res.writeHead(400, { "Content-Type": MIME });
          res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }));
        }
      } catch (e) {
        res.writeHead(500, { "Content-Type": MIME });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: String(e) } }));
      }
    });
  });
  httpServer.listen(HTTP_PORT, () => { console.log(`thinclaw HTTP listening on http://localhost:${HTTP_PORT}/mcp`); });
  httpServer.on("error", (err) => { console.error("HTTP server error:", err); process.exit(1); });
}
