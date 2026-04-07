#!/usr/bin/env node
/**
 * thinclaw — Thin inference-less MCP server for OpenClaw Gateway
 *
 * Architecture:
 *   Claude Cowork (or Perplexity/Claude Desktop) = brain (reasoning, planning,
 *   Computer Use, Projects, Dispatch, scheduled tasks) — ONE inference per cycle.
 *   OpenClaw = lightweight body / tool executor — pure daemon, NO Claude model for
 *   tool calls. thinclaw = bridge — Node.js stdio MCP server calling OpenClaw
 *   Gateway REST endpoints DIRECTLY. Zero inference here.
 *
 * Gateway: http://localhost:18789 (configurable via GATEWAY_URL env)
 * Auth:    token from GATEWAY_TOKEN env or ~/.openclaw/openclaw.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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
      const home = process.env.HOME || "";
      const cfg = JSON.parse(
        readFileSync(join(home, ".openclaw", "openclaw.json"), "utf8")
      );
      return cfg?.gateway?.auth?.token || "";
    } catch {
      return "";
    }
  })();

const gateway = axios.create({
  baseURL: GATEWAY_URL,
  timeout: 120_000,
  headers: {
    Authorization: `Bearer ${GATEWAY_TOKEN}`,
    "Content-Type": "application/json",
  },
});

// ~/AI_Bridge layout for cron → Cowork handoff
const AI_BRIDGE_INBOX = join(process.env.HOME || "", "AI_Bridge", "inbox");
const AI_BRIDGE_OUTBOX = join(process.env.HOME || "", "AI_Bridge", "outbox");
const AI_BRIDGE_PROCESSED = join(process.env.HOME || "", "AI_Bridge", "processed");

function ensureAI_BridgeDirs() {
  for (const dir of [AI_BRIDGE_INBOX, AI_BRIDGE_OUTBOX, AI_BRIDGE_PROCESSED]) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // already exists
    }
  }
}
ensureAI_BridgeDirs();

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

const OpenclawExecuteSchema = z.object({
  tool: z.string().describe("OpenClaw tool name to invoke (e.g. bash, read_file)"),
  params: z.record(z.any()).optional().describe("Tool parameters as key-value pairs"),
});

const SendWhatsappSchema = z.object({
  to: z.string().describe("Recipient phone number or contact ID"),
  message: z.string().describe("Message text"),
});

const ScheduleCronSchema = z.object({
  schedule: z.string().describe("Cron expression, e.g. '*/5 * * * *'"),
  task: z.string().describe("Task name or command to schedule"),
});

const RunShellSchema = z.object({
  command: z.string().describe("Shell command to execute"),
});

const TriggerCoworkWorkflowSchema = z.object({
  workflow: z.string().describe("Workflow name to trigger"),
  context: z.record(z.any()).optional().describe("Additional context to pass"),
});

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: "thinclaw",
    version: "1.0.0",
  },
  {
    capabilities: { tools: {} },
  }
);

// ---- List tools -----------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "openclaw_execute",
        description:
          "Universal execution tool: proxies any OpenClaw tool via POST /tools/invoke. " +
          "Performs ZERO inference — this is a pure HTTP relay. " +
          "Claude Cowork/Perplexity provides all reasoning; this server only carries the call.",
        inputSchema: {
          type: "object",
          properties: {
            tool: {
              type: "string",
              description:
                "OpenClaw tool name (e.g. bash, read_file, grep, todo_list_write, slack_postMessage)",
            },
            params: {
              type: "object",
              description: "Tool parameters as key-value pairs",
            },
          },
          required: ["tool"],
        },
      },
      {
        name: "send_whatsapp",
        description:
          "Send a WhatsApp message via OpenClaw Gateway. " +
          "Proxies to POST /skills/whatsapp/send.",
        inputSchema: {
          type: "object",
          properties: {
            to: {
              type: "string",
              description: "Recipient phone number or WhatsApp contact ID",
            },
            message: {
              type: "string",
              description: "Message text",
            },
          },
          required: ["to", "message"],
        },
      },
      {
        name: "schedule_cron",
        description:
          "Schedule a recurring task via OpenClaw Gateway cron. " +
          "Proxies to POST /cron/schedule.",
        inputSchema: {
          type: "object",
          properties: {
            schedule: {
              type: "string",
              description: "Cron expression, e.g. '*/5 * * * *'",
            },
            task: {
              type: "string",
              description: "Task name or command to schedule",
            },
          },
          required: ["schedule", "task"],
        },
      },
      {
        name: "run_shell",
        description:
          "Execute a shell command directly via OpenClaw Gateway. " +
          "Proxies to POST /shell/exec.",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Shell command to execute",
            },
          },
          required: ["command"],
        },
      },
      {
        name: "trigger_cowork_workflow",
        description:
          "Trigger a Claude Cowork workflow via the AI_Bridge inbox handoff. " +
          "Writes a JSON flag file to ~/AI_Bridge/inbox/trigger-<timestamp>.json. " +
          "Used by OpenClaw cron jobs to hand off to Cowork for reasoning (ONE inference per cycle).",
        inputSchema: {
          type: "object",
          properties: {
            workflow: {
              type: "string",
              description: "Workflow name to trigger (e.g. 'daily-standup', 'code-review')",
            },
            context: {
              type: "object",
              description: "Additional context to pass to the workflow",
            },
          },
          required: ["workflow"],
        },
      },
    ],
  };
});

// ---- Call tool ------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "openclaw_execute") {
      const { tool, params } = OpenclawExecuteSchema.parse(args);
      const response = await gateway.post("/tools/invoke", { tool, params: params || {} });
      return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
    }

    if (name === "send_whatsapp") {
      const { to, message } = SendWhatsappSchema.parse(args);
      const response = await gateway.post("/skills/whatsapp/send", { to, message });
      return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
    }

    if (name === "schedule_cron") {
      const { schedule, task } = ScheduleCronSchema.parse(args);
      const response = await gateway.post("/cron/schedule", { schedule, task });
      return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
    }

    if (name === "run_shell") {
      const { command } = RunShellSchema.parse(args);
      const response = await gateway.post("/shell/exec", { command });
      return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
    }

    if (name === "trigger_cowork_workflow") {
      const { workflow, context } = TriggerCoworkWorkflowSchema.parse(args);
      const filename = `trigger-${Date.now()}.json`;
      const filepath = join(AI_BRIDGE_INBOX, filename);
      const payload = {
        workflow,
        context: context || {},
        triggered_at: new Date().toISOString(),
      };
      writeFileSync(filepath, JSON.stringify(payload, null, 2));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, file: filepath, payload }, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof z.ZodError) {
      return {
        content: [{ type: "text", text: `Schema validation error:\n${err.message}` }],
        isError: true,
      };
    }

    if (err?.response) {
      return {
        content: [
          {
            type: "text",
            text: `Gateway error (${err.response.status}): ${JSON.stringify(
              err.response.data,
              null,
              2
            )}`,
          },
        ],
        isError: true,
      };
    }

    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("Failed to connect transport:", err);
  process.exit(1);
});
