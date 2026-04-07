import { describe, test, expect } from 'vitest';
import axios from 'axios';

const BASE_URL = 'http://localhost:18790';

describe('thinclaw HTTP transport', () => {
  test('POST /mcp with tools/list returns tool list', async () => {
    const response = await axios.post(`${BASE_URL}/mcp`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    });

    expect(response.status).toBe(200);
    expect(response.data.jsonrpc).toBe('2.0');
    expect(response.data.result).toHaveProperty('tools');
    expect(Array.isArray(response.data.result.tools)).toBe(true);

    const toolNames = response.data.result.tools.map(t => t.name);
    expect(toolNames).toContain('openclaw_execute');
    expect(toolNames).toContain('send_whatsapp');
    expect(toolNames).toContain('schedule_cron');
    expect(toolNames).toContain('run_shell');
    expect(toolNames).toContain('trigger_cowork_workflow');
  });

  test('POST /mcp with tools/call executes openclaw_execute', async () => {
    const response = await axios.post(`${BASE_URL}/mcp`, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'openclaw_execute',
        arguments: {
          tool: 'bash',
          params: { command: 'echo hello' }
        }
      }
    }, { timeout: 10000 });

    expect(response.status).toBe(200);
    expect(response.data.jsonrpc).toBe('2.0');
    expect(response.data.result).toBeDefined();
  });

  test('POST /mcp with unknown method returns error', async () => {
    const response = await axios.post(`${BASE_URL}/mcp`, {
      jsonrpc: '2.0',
      id: 3,
      method: 'unknown/method',
      params: {}
    }).catch(err => err.response);

    expect(response.status).toBe(400);
    expect(response.data.error).toBeDefined();
  });

  test('OPTIONS request returns CORS headers', async () => {
    const response = await axios.options(`${BASE_URL}/mcp`);

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });
});
