import { describe, test, expect } from 'vitest';
import axios from 'axios';

const BASE_URL = 'http://localhost:18790';
const GATEWAY_TOKEN = '9d6b1d4c070b96f03076c2277f5a80a68d470e0ccdb19d392e2fcd46d845dbd6';

describe('thinclaw tool availability', () => {
  test('HTTP transport is working', async () => {
    const response = await axios.post(`${BASE_URL}/mcp`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    });
    expect(response.status).toBe(200);
    expect(response.data.result).toHaveProperty('tools');
  });

  test('list shows all 5 thinclaw tools', async () => {
    const response = await axios.post(`${BASE_URL}/mcp`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    });
    const toolNames = response.data.result.tools.map(t => t.name);
    expect(toolNames).toContain('openclaw_execute');
    expect(toolNames).toContain('send_whatsapp');
    expect(toolNames).toContain('schedule_cron');
    expect(toolNames).toContain('run_shell');
    expect(toolNames).toContain('trigger_cowork_workflow');
  });

  test('run_shell fails because bash not registered in gateway', async () => {
    const response = await axios.post(`${BASE_URL}/mcp`, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'run_shell',
        arguments: { command: 'echo hello' }
      }
    });
    expect(response.status).toBe(200);
    // Should return error because gateway doesn't have bash tool
    expect(response.data.result.isError).toBe(true);
    expect(response.data.result.content[0].text).toContain('Tool not available');
    expect(response.data.result.content[0].text).toContain('bash');
  });

  test('trigger_cowork_workflow works (local FS, no gateway)', async () => {
    const response = await axios.post(`${BASE_URL}/mcp`, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'trigger_cowork_workflow',
        arguments: { workflow: 'test-workflow', context: { test: true } }
      }
    });
    expect(response.status).toBe(200);
    expect(response.data.result.isError).toBeFalsy();
    expect(response.data.result.content[0].text).toContain('ok');
    expect(response.data.result.content[0].text).toContain('test-workflow');
  });

  test('schedule_cron fails because not registered in gateway', async () => {
    const response = await axios.post(`${BASE_URL}/mcp`, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'schedule_cron',
        arguments: { schedule: '* * * * *', task: 'test' }
      }
    });
    expect(response.status).toBe(200);
    expect(response.data.result.isError).toBe(true);
    expect(response.data.result.content[0].text).toContain('Tool not available');
  });

  test('send_whatsapp fails because not registered in gateway', async () => {
    const response = await axios.post(`${BASE_URL}/mcp`, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'send_whatsapp',
        arguments: { to: '+1234567890', message: 'test' }
      }
    });
    expect(response.status).toBe(200);
    expect(response.data.result.isError).toBe(true);
    expect(response.data.result.content[0].text).toContain('Tool not available');
  });
});
