#!/usr/bin/env node
/**
 * thinclaw — Thin inference-less MCP server for OpenClaw Gateway
 *
 * Architecture: This server performs ZERO LLM inference. It exposes
 * OpenClaw Gateway tools via the MCP stdio protocol. External AIs
 * (Perplexity, Claude Cowork, Claude Desktop, etc.) call these tools
 * and do their own inference. This server is a pure HTTP proxy.
 *
 * Gateway docs: http://localhost:18789 (configurable via GATEWAY_URL env)
 * Auth: token read from GATEWAY_TOKEN env or ~/.openclaw/openclaw.json
 */

import { readFileSync } from "fs";
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
  process.env.GATEWAY_URL || "http://localhost:18789";
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
  timeout: 120_000, // allow long gateway runs
  headers: {
    Authorization: `Bearer ${GATEWAY_TOKEN}`,
    "Content-Type": "application/json",
  },
});

// ---------------------------------------------------------------------------
// Tool schemas (Zod)
// ---------------------------------------------------------------------------

const OpenclawExecuteSchema = z.object({
  tool: z.string().describe("OpenClaw tool name to invoke (e.g. bash, read_file)"),
  params: z.record(z.any()).optional().describe("Tool parameters"),
  skill: z.string().optional().describe("Skill name (alternative to tool)"),
});

const SendWhatsappSchema = z.object({
  to: z.string().describe("Recipient phone number or contact ID"),
  body: z.string().describe("Message text"),
});

const RunShellSchema = z.object({
  command: z.string().describe("Shell command to execute"),
  cwd: z.string().optional().describe("Working directory"),
  timeout: z.number().optional().describe("Timeout in seconds (default 60)"),
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
    capabilities: {
      tools: {},
    },
  }
);

// ---- List tools -----------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "openclaw_execute",
        description:
          "Universal execution tool: proxies any OpenClaw tool via the Gateway REST API. " +
          "Performs ZERO inference — this is a pure HTTP relay. " +
          "Use this when you need file operations, code execution, Slack, Git, or any " +
          "OpenClaw tool but want the calling AI to do all reasoning.",
        inputSchema: {
          type: "object",
          properties: {
            tool: {
              type: "string",
              description: "OpenClaw tool name (e.g. bash, read_file, grep, todo_list_write)",
            },
            params: {
              type: "object",
              description: "Tool parameters as key-value pairs",
            },
            skill: {
              type: "string",
              description:
                "Optional skill name to invoke (e.g. debugging, frontend-design). " +
                "Skill invocation takes priority over tool name.",
            },
          },
          required: ["tool"],
        },
      },
      {
        name: "send_whatsapp",
        description:
          "Send a WhatsApp message via OpenClaw Gateway. " +
          "Proxy to POST /tools/invoke with tool=whatsapp_send.",
        inputSchema: {
          type: "object",
          properties: {
            to: {
              type: "string",
              description: "Recipient phone number or WhatsApp contact ID",
            },
            body: {
              type: "string",
              description: "Message text",
            },
          },
          required: ["to", "body"],
        },
      },
      {
        name: "run_shell",
        description:
          "Execute a shell command via OpenClaw Gateway bash tool. " +
          "Proxy to POST /tools/invoke with tool=bash.",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Shell command to execute",
            },
            cwd: {
              type: "string",
              description: "Working directory (optional)",
            },
            timeout: {
              type: "number",
              description: "Timeout in seconds (default 60, max 600)",
            },
          },
          required: ["command"],
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
      const parsed = OpenclawExecuteSchema.parse(args);
      const body = parsed.skill
        ? { skill: parsed.skill, params: parsed.params || {} }
        : { tool: parsed.tool, params: parsed.params || {} };

      const response = await gateway.post("/tools/invoke", body);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    }

    if (name === "send_whatsapp") {
      const { to, body: message } = SendWhatsappSchema.parse(args);
      const response = await gateway.post("/tools/invoke", {
        tool: "whatsapp_send",
        params: { to, body: message },
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
      };
    }

    if (name === "run_shell") {
      const { command, cwd, timeout } = RunShellSchema.parse(args);
      const response = await gateway.post("/tools/invoke", {
        tool: "bash",
        params: {
          command,
          ...(cwd ? { cwd } : {}),
          timeoutSeconds: timeout || 60,
        },
      });
      return {
        content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isZodError = err instanceof z.ZodError;

    if (isZodError) {
      return {
        content: [
          {
            type: "text",
            text: `Schema validation error:\n${err.message}`,
          },
        ],
        isError: true,
      };
    }

    // Axios errors
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

    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
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
