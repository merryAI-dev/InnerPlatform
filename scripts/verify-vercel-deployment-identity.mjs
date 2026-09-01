#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const VERCEL_API_ORIGIN = 'https://api.vercel.com';
const FULL_SHA = /^[0-9a-f]{40}$/;
const DEPLOYMENT_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/;
const CANONICAL_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const VERCEL_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]{7,127}$/;
const GITHUB_INVOCATION = /^[1-9][0-9]*-[1-9][0-9]*$/;
const REPOSITORY_ID = /^[1-9][0-9]*$/;
const API_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]{2,199}$/;
const HEADER_TOKEN = /^[\x21-\x7e]{8,512}$/;

function invalidInput() {
  throw new Error('Invalid Vercel deployment identity input.');
}

function invalidIdentity() {
  throw new Error('Vercel deployment identity validation failed.');
}

function exactString(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

function validateInput(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalidInput();
  const directLookup = options.host !== undefined;
  const aliasLookup = options.aliasHost !== undefined;
  if (directLookup === aliasLookup) invalidInput();
  let lookupHost;
  let expectedHost;
  if (directLookup) {
    if (!exactString(options.host, DEPLOYMENT_HOST) || options.expectedHost !== undefined) invalidInput();
    lookupHost = options.host;
    expectedHost = options.host;
  } else {
    if (!exactString(options.canonicalHost, CANONICAL_HOST)
      || options.aliasHost !== options.canonicalHost
      || (options.expectedHost !== undefined
        && !exactString(options.expectedHost, DEPLOYMENT_HOST))) invalidInput();
    lookupHost = options.aliasHost;
    expectedHost = options.expectedHost;
  }
  if (!exactString(options.token, HEADER_TOKEN)) invalidInput();
  if (!exactString(options.teamId, API_ID)) invalidInput();
  if (!exactString(options.projectId, API_ID)) invalidInput();
  if (!exactString(options.repositoryId, REPOSITORY_ID)) invalidInput();
  if (!exactString(options.ancestorOf, FULL_SHA)) invalidInput();
  if (options.expectedSha !== undefined && !exactString(options.expectedSha, FULL_SHA)) invalidInput();
  if (options.expectedId !== undefined && !exactString(options.expectedId, VERCEL_ID)) invalidInput();
  if (options.expectedInvocation !== undefined
    && !exactString(options.expectedInvocation, GITHUB_INVOCATION)) invalidInput();
  if (options.legacyMissingInvocationSha !== undefined
    && !exactString(options.legacyMissingInvocationSha, FULL_SHA)) invalidInput();
  if (options.cwd !== undefined && (typeof options.cwd !== 'string' || options.cwd.length === 0)) invalidInput();
  return { ...options, lookupHost, expectedHost };
}

function validateDeploymentRecord(record, options) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) invalidIdentity();
  if (!exactString(record.id, VERCEL_ID)) invalidIdentity();
  if (!exactString(record.url, DEPLOYMENT_HOST)) invalidIdentity();
  if (options.expectedHost !== undefined && record.url !== options.expectedHost) invalidIdentity();
  if (record.projectId !== options.projectId) invalidIdentity();
  if (record.target !== 'production') invalidIdentity();
  if (record.readyState !== 'READY') invalidIdentity();

  const commitSha = record.meta?.githubCommitSha;
  if (!exactString(commitSha, FULL_SHA)) invalidIdentity();
  if (options.expectedSha !== undefined && commitSha !== options.expectedSha) invalidIdentity();
  if (options.expectedId !== undefined && record.id !== options.expectedId) invalidIdentity();

  const invocation = record.meta?.githubActionsInvocation ?? null;
  if (invocation === null) {
    if (options.legacyMissingInvocationSha !== commitSha) invalidIdentity();
  } else if (!exactString(invocation, GITHUB_INVOCATION)) {
    invalidIdentity();
  }
  if (options.expectedInvocation !== undefined && invocation !== options.expectedInvocation) {
    invalidIdentity();
  }

  if (record.gitSource !== undefined && record.gitSource !== null) {
    if (!record.gitSource || typeof record.gitSource !== 'object' || Array.isArray(record.gitSource)) {
      invalidIdentity();
    }
    if (record.gitSource.type !== 'github'
      || record.gitSource.sha !== commitSha
      || String(record.gitSource.repoId) !== options.repositoryId) {
      invalidIdentity();
    }
  }

  return {
    id: record.id,
    host: record.url,
    commitSha,
    invocation,
  };
}

function assertCommitAncestor(commitSha, ancestorOf, cwd, gitImpl = spawnSync) {
  const run = (args) => gitImpl('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'ignore',
  });
  const exists = run(['cat-file', '-e', `${commitSha}^{commit}`]);
  const ancestor = run(['merge-base', '--is-ancestor', commitSha, ancestorOf]);
  if (exists.status !== 0 || ancestor.status !== 0) {
    throw new Error('Vercel deployment commit validation failed.');
  }
}

export async function resolveVercelDeploymentIdentity(
  options,
  { fetchImpl = globalThis.fetch, gitImpl = spawnSync } = {},
) {
  const validatedOptions = validateInput(options);
  if (typeof fetchImpl !== 'function') invalidInput();

  const requestUrl = `${VERCEL_API_ORIGIN}/v13/deployments/${encodeURIComponent(validatedOptions.lookupHost)}`
    + `?withGitRepoInfo=true&teamId=${encodeURIComponent(validatedOptions.teamId)}`;
  let response;
  try {
    response = await fetchImpl(requestUrl, {
      method: 'GET',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${validatedOptions.token}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('Vercel deployment lookup failed.');
  }

  if (!response || typeof response.status !== 'number' || typeof response.ok !== 'boolean') {
    throw new Error('Vercel deployment response failed validation.');
  }
  if (!response.ok) {
    throw new Error(`Vercel deployment lookup failed with HTTP ${response.status}.`);
  }
  if (!String(response.headers?.get?.('content-type') ?? '').toLowerCase().includes('application/json')) {
    throw new Error('Vercel deployment response failed validation.');
  }

  let record;
  try {
    record = await response.json();
  } catch {
    throw new Error('Vercel deployment response failed validation.');
  }

  const identity = validateDeploymentRecord(record, validatedOptions);
  assertCommitAncestor(
    identity.commitSha,
    validatedOptions.ancestorOf,
    validatedOptions.cwd ?? process.cwd(),
    gitImpl,
  );
  return identity;
}

function parseArgs(argv) {
  const options = {};
  const valued = new Map([
    ['--host', 'host'],
    ['--alias-host', 'aliasHost'],
    ['--expected-host', 'expectedHost'],
    ['--ancestor-of', 'ancestorOf'],
    ['--expected-sha', 'expectedSha'],
    ['--expected-id', 'expectedId'],
    ['--expected-invocation', 'expectedInvocation'],
    ['--legacy-missing-invocation-sha', 'legacyMissingInvocationSha'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const key = valued.get(argv[index]);
    if (!key || index + 1 >= argv.length || argv[index + 1].startsWith('--')) invalidInput();
    if (options[key] !== undefined) invalidInput();
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const identity = await resolveVercelDeploymentIdentity({
      ...args,
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_ORG_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
      repositoryId: process.env.VERCEL_GITHUB_REPOSITORY_ID,
      canonicalHost: process.env.VERCEL_CANONICAL_PRODUCTION_HOST,
    });
    process.stdout.write(`${JSON.stringify(identity)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Vercel deployment identity check failed.';
    process.stderr.write(`[vercel-deployment-identity] ${message}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  await main();
}
