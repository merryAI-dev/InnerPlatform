import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveVercelDeploymentIdentity,
} from '../scripts/verify-vercel-deployment-identity.mjs';

const HOST = 'inner-platform-co7vzd4k6-merryai-devs-projects.vercel.app';
const CANONICAL_HOST = 'myscube.myscguard.app';
const PROJECT_ID = 'prj_expected';
const TEAM_ID = 'team_expected';
const REPOSITORY_ID = '1157869653';
const TOKEN_SENTINEL = 'vercel-token-must-never-leak';
const BODY_SENTINEL = 'raw-response-must-never-leak';
const helperPath = resolve(__dirname, '../scripts/verify-vercel-deployment-identity.mjs');

const tempDirs: string[] = [];

function makeGitHistory() {
  const cwd = mkdtempSync(join(tmpdir(), 'myscube-vercel-identity-'));
  tempDirs.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'vercel-identity-test@example.com');
  git('config', 'user.name', 'Vercel Identity Test');
  writeFileSync(join(cwd, 'fixture.txt'), `base:${cwd}\n`);
  git('add', '.');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(cwd, 'fixture.txt'), `head:${cwd}\n`);
  git('commit', '-qam', 'head');
  const head = git('rev-parse', 'HEAD');
  return { cwd, base, head };
}

function deploymentRecord(commitSha: string) {
  return {
    id: 'dpl_89qyp1cskzkLrVicDaZoDbjyHuDJ',
    url: HOST,
    projectId: PROJECT_ID,
    target: 'production',
    readyState: 'READY',
    meta: {
      githubCommitSha: commitSha,
      githubActionsInvocation: '33141149889-1',
    },
    gitSource: {
      type: 'github',
      sha: commitSha,
      repoId: Number(REPOSITORY_ID),
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function requestOptions(
  history: ReturnType<typeof makeGitHistory>,
  overrides: Record<string, unknown> = {},
) {
  return {
    host: HOST,
    token: TOKEN_SENTINEL,
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    ancestorOf: history.head,
    cwd: history.cwd,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('Vercel production deployment identity', () => {
  it('binds the exact deployment host to the owner REST record and an ancestor commit', async () => {
    const history = makeGitHistory();
    const fetchImpl = vi.fn(async () => jsonResponse(deploymentRecord(history.base)));

    const identity = await resolveVercelDeploymentIdentity(
      requestOptions(history),
      { fetchImpl },
    );

    expect(identity).toEqual({
      id: 'dpl_89qyp1cskzkLrVicDaZoDbjyHuDJ',
      host: HOST,
      commitSha: history.base,
      invocation: '33141149889-1',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchImpl.mock.calls[0];
    expect(String(requestUrl)).toBe(
      `https://api.vercel.com/v13/deployments/${HOST}?withGitRepoInfo=true&teamId=${TEAM_ID}`,
    );
    expect(String(requestUrl)).not.toContain(TOKEN_SENTINEL);
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${TOKEN_SENTINEL}`,
      },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('resolves only the exact canonical alias and binds its deployment target host', async () => {
    const history = makeGitHistory();
    const fetchImpl = vi.fn(async () => jsonResponse(deploymentRecord(history.base)));
    const options = requestOptions(history, {
      host: undefined,
      aliasHost: CANONICAL_HOST,
      canonicalHost: CANONICAL_HOST,
      expectedHost: HOST,
    });

    await expect(resolveVercelDeploymentIdentity(options, { fetchImpl }))
      .resolves.toMatchObject({ host: HOST, commitSha: history.base });
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      `https://api.vercel.com/v13/deployments/${CANONICAL_HOST}`
      + `?withGitRepoInfo=true&teamId=${TEAM_ID}`,
    );

    for (const aliasHost of [
      `evil.${CANONICAL_HOST}`,
      `${CANONICAL_HOST}.evil.example`,
      `https://${CANONICAL_HOST}`,
      `${CANONICAL_HOST}/path`,
    ]) {
      await expect(resolveVercelDeploymentIdentity({
        ...options,
        aliasHost,
      }, { fetchImpl })).rejects.toThrow('Invalid Vercel deployment identity input.');
    }
  });

  it('supports role-specific exact candidate and rollback bindings through the same resolver', async () => {
    const history = makeGitHistory();
    const record = deploymentRecord(history.base);
    const fetchImpl = vi.fn(async () => jsonResponse(record));

    await expect(resolveVercelDeploymentIdentity(requestOptions(history, {
      expectedId: record.id,
      expectedSha: history.base,
      expectedInvocation: record.meta.githubActionsInvocation,
    }), { fetchImpl })).resolves.toMatchObject({ commitSha: history.base });

    for (const mismatch of [
      { expectedId: 'dpl_other' },
      { expectedSha: history.head },
      { expectedInvocation: '33141149889-2' },
    ]) {
      await expect(resolveVercelDeploymentIdentity(
        requestOptions(history, mismatch),
        { fetchImpl },
      )).rejects.toThrow('Vercel deployment identity validation failed.');
    }
  });

  it('allows a missing invocation only for the exact configured legacy REST commit', async () => {
    const history = makeGitHistory();
    const record = deploymentRecord(history.base);
    delete (record.meta as any).githubActionsInvocation;
    const fetchImpl = async () => jsonResponse(record);

    await expect(resolveVercelDeploymentIdentity(
      requestOptions(history),
      { fetchImpl },
    )).rejects.toThrow('Vercel deployment identity validation failed.');
    await expect(resolveVercelDeploymentIdentity(
      requestOptions(history, { legacyMissingInvocationSha: history.base }),
      { fetchImpl },
    )).resolves.toMatchObject({ commitSha: history.base, invocation: null });
    await expect(resolveVercelDeploymentIdentity(
      requestOptions(history, { legacyMissingInvocationSha: history.head }),
      { fetchImpl },
    )).rejects.toThrow('Vercel deployment identity validation failed.');
  });

  it.each(['absent', 'null'])('accepts %s gitSource only when metadata remains authoritative', async (shape) => {
    const history = makeGitHistory();
    const record = deploymentRecord(history.base);
    if (shape === 'absent') delete (record as any).gitSource;
    else (record as any).gitSource = null;

    await expect(resolveVercelDeploymentIdentity(
      requestOptions(history),
      { fetchImpl: async () => jsonResponse(record) },
    )).resolves.toMatchObject({ commitSha: history.base, host: HOST });
  });

  it('emits only normalized identity fields and keeps CLI failures injection-safe', () => {
    const history = makeGitHistory();
    const childEnv = { ...process.env };
    delete childEnv.FORCE_COLOR;
    const record = {
      ...deploymentRecord(history.base),
      privateRaw: BODY_SENTINEL,
      privateTokenEcho: TOKEN_SENTINEL,
    };
    const mockFetch = join(history.cwd, 'mock-vercel-fetch.mjs');
    writeFileSync(mockFetch, [
      `const record = ${JSON.stringify(record)};`,
      'globalThis.fetch = async () => new Response(JSON.stringify(record), {',
      "  status: 200, headers: { 'content-type': 'application/json' },",
      '});',
    ].join('\n'));
    const validEnv = {
      ...childEnv,
      VERCEL_TOKEN: TOKEN_SENTINEL,
      VERCEL_ORG_ID: TEAM_ID,
      VERCEL_PROJECT_ID: PROJECT_ID,
      VERCEL_GITHUB_REPOSITORY_ID: REPOSITORY_ID,
    };
    const baseArgs = [
      '--host', HOST,
      '--ancestor-of', history.head,
      '--expected-sha', history.base,
      '--expected-invocation', record.meta.githubActionsInvocation,
    ];
    const success = spawnSync(process.execPath, ['--import', mockFetch, helperPath, ...baseArgs], {
      cwd: history.cwd,
      env: validEnv,
      encoding: 'utf8',
    });
    expect(success.status).toBe(0);
    expect(success.stderr).toBe('');
    expect(JSON.parse(success.stdout)).toEqual({
      id: record.id,
      host: HOST,
      commitSha: history.base,
      invocation: record.meta.githubActionsInvocation,
    });
    expect(`${success.stdout}${success.stderr}`).not.toContain(BODY_SENTINEL);
    expect(`${success.stdout}${success.stderr}`).not.toContain(TOKEN_SENTINEL);

    const invalidCases = [
      ['--unknown', 'value'],
      [...baseArgs, '--host', HOST],
      [...baseArgs.slice(0, -1), `bad\noutput=value`],
    ];
    for (const args of invalidCases) {
      const failure = spawnSync(process.execPath, [helperPath, ...args], {
        cwd: history.cwd,
        env: validEnv,
        encoding: 'utf8',
      });
      expect(failure.status).not.toBe(0);
      expect(failure.stdout).toBe('');
      expect(failure.stderr).toBe(
        '[vercel-deployment-identity] Invalid Vercel deployment identity input.\n',
      );
      expect(failure.stderr).not.toContain(BODY_SENTINEL);
      expect(failure.stderr).not.toContain(TOKEN_SENTINEL);
    }

    const missingEnv = spawnSync(process.execPath, [helperPath, ...baseArgs], {
      cwd: history.cwd,
      env: {
        ...childEnv,
        VERCEL_TOKEN: '',
        VERCEL_ORG_ID: '',
        VERCEL_PROJECT_ID: '',
        VERCEL_GITHUB_REPOSITORY_ID: '',
      },
      encoding: 'utf8',
    });
    expect(missingEnv.status).not.toBe(0);
    expect(missingEnv.stdout).toBe('');
    expect(missingEnv.stderr).toBe(
      '[vercel-deployment-identity] Invalid Vercel deployment identity input.\n',
    );
  });

  it.each([
    ['missing id', (record: any) => { delete record.id; }],
    ['unsafe id', (record: any) => { record.id = '../deployment'; }],
    ['host mismatch', (record: any) => { record.url = 'other-project.vercel.app'; }],
    ['URL-shaped response host', (record: any) => { record.url = `https://${HOST}`; }],
    ['project mismatch', (record: any) => { record.projectId = 'prj_other'; }],
    ['preview target', (record: any) => { record.target = 'preview'; }],
    ['non-ready state', (record: any) => { record.readyState = 'BUILDING'; }],
    ['missing metadata', (record: any) => { delete record.meta; }],
    ['short SHA', (record: any) => { record.meta.githubCommitSha = 'a'.repeat(39); }],
    ['long SHA', (record: any) => { record.meta.githubCommitSha = 'a'.repeat(41); }],
    ['uppercase SHA', (record: any) => { record.meta.githubCommitSha = 'A'.repeat(40); }],
    ['whitespace SHA', (record: any) => { record.meta.githubCommitSha = ` ${'a'.repeat(40)}`; }],
    ['malformed git provenance', (record: any) => { record.gitSource = 'github'; }],
    ['wrong git provider', (record: any) => { record.gitSource.type = 'gitlab'; }],
    ['git SHA disagreement', (record: any) => { record.gitSource.sha = 'b'.repeat(40); }],
    ['repository mismatch', (record: any) => { record.gitSource.repoId = 42; }],
  ])('fails closed for %s', async (_name, mutate) => {
    const history = makeGitHistory();
    const record = deploymentRecord(history.base);
    mutate(record);

    await expect(resolveVercelDeploymentIdentity(
      requestOptions(history),
      { fetchImpl: async () => jsonResponse(record) },
    )).rejects.toThrow('Vercel deployment identity validation failed.');
  });

  it.each([
    '',
    `https://${HOST}`,
    `${HOST}/path`,
    `${HOST}?query=1`,
    `${HOST}#fragment`,
    `user@${HOST}`,
    `${HOST}:443`,
    `evil.${HOST}`,
    `lookalike-${HOST}.example.com`,
    'attacker.vercel.app.evil.example',
  ])('rejects a malformed or lookalike lookup host before fetching: %s', async (host) => {
    const history = makeGitHistory();
    const fetchImpl = vi.fn(async () => jsonResponse(deploymentRecord(history.base)));

    await expect(resolveVercelDeploymentIdentity(
      requestOptions(history, { host }),
      { fetchImpl },
    )).rejects.toThrow('Invalid Vercel deployment identity input.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a bearer token containing header-injection characters before fetching', async () => {
    const history = makeGitHistory();
    const fetchImpl = vi.fn(async () => jsonResponse(deploymentRecord(history.base)));
    await expect(resolveVercelDeploymentIdentity(
      requestOptions(history, { token: `${TOKEN_SENTINEL}\r\nx-injected: true` }),
      { fetchImpl },
    )).rejects.toThrow('Invalid Vercel deployment identity input.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([301, 401, 403, 404, 429, 500, 503])(
    'fails closed on HTTP %s without leaking response or token data',
    async (status) => {
      const history = makeGitHistory();
      let error = '';
      try {
        await resolveVercelDeploymentIdentity(requestOptions(history), {
          fetchImpl: async () => new Response(`${BODY_SENTINEL}:${TOKEN_SENTINEL}`, {
            status,
            headers: { 'content-type': 'text/plain' },
          }),
        });
      } catch (caught) {
        error = String(caught);
      }
      expect(error).toContain(`Vercel deployment lookup failed with HTTP ${status}.`);
      expect(error).not.toContain(BODY_SENTINEL);
      expect(error).not.toContain(TOKEN_SENTINEL);
    },
  );

  it.each([
    ['HTML response', async () => new Response(`<p>${BODY_SENTINEL}</p>`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })],
    ['malformed JSON', async () => new Response(`{"secret":"${BODY_SENTINEL}"`, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })],
    ['null JSON', async () => jsonResponse(null)],
    ['array JSON', async () => jsonResponse([deploymentRecord('a'.repeat(40))])],
    ['network reset', async () => { throw new Error(`${BODY_SENTINEL}:${TOKEN_SENTINEL}`); }],
    ['timeout', async () => { throw new DOMException(TOKEN_SENTINEL, 'AbortError'); }],
  ])('fails closed for %s without leaking raw data', async (_name, fetchImpl) => {
    const history = makeGitHistory();
    let error = '';
    try {
      await resolveVercelDeploymentIdentity(
        requestOptions(history),
        { fetchImpl },
      );
    } catch (caught) {
      error = String(caught);
    }
    expect(error).toMatch(/Vercel deployment (lookup|response|identity validation) failed/);
    expect(error).not.toContain(BODY_SENTINEL);
    expect(error).not.toContain(TOKEN_SENTINEL);
  });

  it('rejects an unknown or non-ancestor commit', async () => {
    const history = makeGitHistory();
    const unrelated = makeGitHistory();

    await expect(resolveVercelDeploymentIdentity(requestOptions(history), {
      fetchImpl: async () => jsonResponse(deploymentRecord('a'.repeat(40))),
    })).rejects.toThrow('Vercel deployment commit validation failed.');

    await expect(resolveVercelDeploymentIdentity(requestOptions(history), {
      fetchImpl: async () => jsonResponse(deploymentRecord(unrelated.head)),
    })).rejects.toThrow('Vercel deployment commit validation failed.');
  });
});
