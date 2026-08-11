import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';

const text = (value) => typeof value === 'string' ? value.trim() : '';
const value = () => randomBytes(32).toString('base64url');

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

export async function authorizeLocalMcp({ baseUrl, fetchImpl = globalThis.fetch, open = openBrowser }) {
  const base = new URL(baseUrl);
  const verifier = value();
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = value();
  const callback = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback' || url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
        res.statusCode = 400; res.end('MYSCube OAuth 인증을 확인하지 못했습니다. 이 창을 닫고 다시 시도해 주세요.'); return;
      }
      res.end('MYSCube 로그인이 완료됐습니다. 이 창을 닫아도 됩니다.');
      server.close();
      resolve({ code: url.searchParams.get('code'), redirectUri: `http://127.0.0.1:${server.address().port}/callback` });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
      const authorize = new URL('/api/v1/mcp/oauth/authorize', base);
      Object.entries({ response_type: 'code', client_id: 'myscube-local-launcher', redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', scope: 'cashflow.read', resource: new URL('/mcp', base).toString(), state }).forEach(([key, entry]) => authorize.searchParams.set(key, entry));
      open(authorize.toString());
    });
  });
  const response = await fetchImpl(new URL('/api/v1/mcp/oauth/token', base), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'myscube-local-launcher', redirect_uri: callback.redirectUri, code_verifier: verifier, code: callback.code }).toString(),
  });
  if (!response.ok) throw new Error('MYSCube 로그인 토큰을 발급하지 못했습니다.');
  const result = await response.json();
  if (!text(result?.access_token)) throw new Error('MYSCube 로그인 토큰을 확인하지 못했습니다.');
  return result.access_token;
}
