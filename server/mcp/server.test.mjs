import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let client;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe('MYSCube MCP server', () => {
  it('publishes only the read-only cashflow status tool', async () => {
    client = new Client({ name: 'myscube-mcp-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
      env: {},
      stderr: 'pipe',
    }));

    const { tools } = await client.listTools();

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: 'cashflow_status',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    });
  });
});
