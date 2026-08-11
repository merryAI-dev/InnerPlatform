import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { readCashflowStatus, resolveCashflowMcpConfig } from './cashflow-status.mjs';
import { authorizeLocalMcp } from './oauth-launcher.mjs';

function audit(event) {
  console.error(JSON.stringify({ source: 'myscube_mcp', ...event }));
}

const server = new McpServer({ name: 'myscube', version: '0.1.0' });
let accessToken;

async function localAccessToken() {
  if (!accessToken) accessToken = await authorizeLocalMcp(resolveCashflowMcpConfig());
  return accessToken;
}

server.registerTool('cashflow_status', {
  title: 'MYSCube 정산 현황 조회',
  description: '로그인한 사용자가 접근할 수 있는 프로젝트의 월·주 정산 상태와 P/A 차액을 조회합니다. 읽기 전용입니다.',
  inputSchema: {
    yearMonth: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
    projectIds: z.array(z.string()).min(1).max(100),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ yearMonth, projectIds }) => {
  try {
    const overview = await readCashflowStatus({ ...resolveCashflowMcpConfig(), accessToken: await localAccessToken(), yearMonth, projectIds, audit });
    return { content: [{ type: 'text', text: JSON.stringify(overview) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : '현금흐름 조회에 실패했습니다.' }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
