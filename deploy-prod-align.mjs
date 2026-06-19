#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const CANONICAL_PRODUCTION_HOST =
  process.env.VERCEL_CANONICAL_PRODUCTION_HOST?.trim() || 'myscube.myscguard.app';
const CANONICAL_PRODUCTION_URL = `https://${CANONICAL_PRODUCTION_HOST}`;
const MAX_ALIAS_CHECK_ATTEMPTS = Number.parseInt(process.env.VERCEL_CANONICAL_CHECK_ATTEMPTS ?? '10', 10);
const ALIAS_CHECK_DELAY_MS = Number.parseInt(process.env.VERCEL_CANONICAL_CHECK_DELAY_MS ?? '2000', 10);
const SKIP_PWA_LIVE_VERIFY = process.env.VERCEL_SKIP_PWA_LIVE_VERIFY === 'true';
const VERCEL_CLI_PACKAGE = process.env.VERCEL_CLI_PACKAGE?.trim() || null;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN?.trim() || null;

function redactSecrets(text) {
  if (!VERCEL_TOKEN) return text;
  return text.split(VERCEL_TOKEN).join('[redacted]');
}

function formatCommand(command, args) {
  return redactSecrets(`${command} ${args.join(' ')}`);
}

function fail(message, details) {
  console.error(`[deploy-align] ${message}`);
  if (details) {
    console.error(redactSecrets(details));
  }
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const combined = [stdout, stderr].filter(Boolean).join('\n');

  if (result.status !== 0) {
    fail(`command failed: ${formatCommand(command, args)}`, combined);
  }

  return { stdout, stderr, combined };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runVercel(args) {
  const authArgs = VERCEL_TOKEN ? [...args, '--token', VERCEL_TOKEN] : args;

  if (VERCEL_CLI_PACKAGE) {
    return run('npx', ['--yes', VERCEL_CLI_PACKAGE, ...authArgs]);
  }

  return run('vercel', authArgs);
}

function parseFetchedDeploymentHost(text) {
  const match =
    text.match(/Fetched deployment "https?:\/\/([^"]+)"/i)
    ?? text.match(/Fetched deployment "([^"]+)"/i);
  return match?.[1]?.replace(/^https?:\/\//i, '') ?? null;
}

function normalizeDeploymentHost(input) {
  if (!input) return null;

  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withProtocol).host;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = { help: false, verifyOnly: null };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '--help' || value === '-h') {
      args.help = true;
      continue;
    }

    if (value === '--verify-only') {
      args.verifyOnly = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    fail(`unknown argument: ${value}`, 'Usage: node deploy-prod-align.mjs --verify-only <deployment-url-or-host>');
  }

  return args;
}

async function verifyCanonicalAlias(deploymentHost) {
  for (let attempt = 1; attempt <= MAX_ALIAS_CHECK_ATTEMPTS; attempt += 1) {
    const aliasInspect = runVercel(['inspect', CANONICAL_PRODUCTION_HOST]);
    const aliasTargetHost = parseFetchedDeploymentHost(aliasInspect.combined);

    if (aliasTargetHost === deploymentHost) {
      console.log(`[deploy-align] canonical production URL confirmed: ${CANONICAL_PRODUCTION_URL}`);
      return;
    }

    console.log(
      `[deploy-align] waiting for ${CANONICAL_PRODUCTION_URL} to point at ${deploymentHost} `
      + `(currently: ${aliasTargetHost ?? 'unknown'}, attempt ${attempt}/${MAX_ALIAS_CHECK_ATTEMPTS})`,
    );

    if (attempt < MAX_ALIAS_CHECK_ATTEMPTS) {
      await sleep(ALIAS_CHECK_DELAY_MS);
    }
  }

  fail(`timed out waiting for ${CANONICAL_PRODUCTION_URL} to point at ${deploymentHost}`);
}

function verifyLivePwaPackage() {
  if (SKIP_PWA_LIVE_VERIFY) {
    console.log('[deploy-align] skipping live PWA verification because VERCEL_SKIP_PWA_LIVE_VERIFY=true');
    return;
  }

  console.log(`[deploy-align] verifying live PWA package: ${CANONICAL_PRODUCTION_URL}`);
  run('npm', ['run', 'pwa:verify:live', '--', CANONICAL_PRODUCTION_URL], { stdio: 'inherit' });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log('Usage: node deploy-prod-align.mjs --verify-only <deployment-url-or-host>');
    console.log(`Canonical production URL: ${CANONICAL_PRODUCTION_URL}`);
    console.log('Production deploys are intentionally not available from this local CLI.');
    return;
  }

  let deploymentHost = normalizeDeploymentHost(args.verifyOnly);

  if (!deploymentHost && args.verifyOnly) {
    fail(`could not parse deployment from --verify-only value: ${args.verifyOnly}`);
  }

  if (!deploymentHost) {
    fail(
      'Production deploys are disabled from local CLI.',
      'Use `node deploy-prod-align.mjs --verify-only <deployment-url-or-host>` to verify an existing deployment. Production deploy authority must move through GitHub Actions.',
    );
  }

  console.log(`[deploy-align] target deployment: https://${deploymentHost}`);
  await verifyCanonicalAlias(deploymentHost);
  verifyLivePwaPackage();
  console.log(`[deploy-align] official production URL: ${CANONICAL_PRODUCTION_URL}`);
}

await main();
