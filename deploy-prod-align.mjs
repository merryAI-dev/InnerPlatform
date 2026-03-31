#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const CANONICAL_PRODUCTION_HOST =
  process.env.VERCEL_CANONICAL_PRODUCTION_HOST?.trim() || 'inner-platform.vercel.app';
const CANONICAL_PRODUCTION_URL = `https://${CANONICAL_PRODUCTION_HOST}`;
const MAX_ALIAS_CHECK_ATTEMPTS = Number.parseInt(process.env.VERCEL_CANONICAL_CHECK_ATTEMPTS ?? '10', 10);
const ALIAS_CHECK_DELAY_MS = Number.parseInt(process.env.VERCEL_CANONICAL_CHECK_DELAY_MS ?? '2000', 10);

function fail(message, details) {
  console.error(`[deploy-align] ${message}`);
  if (details) {
    console.error(details);
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
    fail(`command failed: ${command} ${args.join(' ')}`, combined);
  }

  return { stdout, stderr, combined };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDeploymentUrl(text) {
  const matches = text.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi) ?? [];
  return matches.at(-1) ?? null;
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

    fail(`unknown argument: ${value}`, 'Usage: node deploy-prod-align.mjs [--verify-only <deployment-url-or-host>]');
  }

  return args;
}

async function verifyCanonicalAlias(deploymentHost) {
  for (let attempt = 1; attempt <= MAX_ALIAS_CHECK_ATTEMPTS; attempt += 1) {
    const aliasInspect = run('vercel', ['inspect', CANONICAL_PRODUCTION_HOST]);
    const aliasTargetHost = parseFetchedDeploymentHost(aliasInspect.combined);

    if (aliasTargetHost === deploymentHost) {
      const deploymentInspect = run('vercel', ['inspect', deploymentHost]);

      if (!deploymentInspect.combined.includes(CANONICAL_PRODUCTION_URL)) {
        fail(
          `${deploymentHost} is ready, but ${CANONICAL_PRODUCTION_URL} is missing from the deployment aliases.`,
          deploymentInspect.combined,
        );
      }

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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log('Usage: node deploy-prod-align.mjs [--verify-only <deployment-url-or-host>]');
    console.log(`Canonical production URL: ${CANONICAL_PRODUCTION_URL}`);
    return;
  }

  let deploymentHost = normalizeDeploymentHost(args.verifyOnly);

  if (!deploymentHost && args.verifyOnly) {
    fail(`could not parse deployment from --verify-only value: ${args.verifyOnly}`);
  }

  if (!deploymentHost) {
    run('node', ['scripts/assert-safe-local-deploy.mjs'], { stdio: 'inherit' });

    const deployment = run('vercel', ['deploy', '--prod', '--yes']);
    process.stdout.write(deployment.stdout);
    process.stderr.write(deployment.stderr);

    deploymentHost = normalizeDeploymentHost(parseDeploymentUrl(deployment.stdout) ?? parseDeploymentUrl(deployment.combined));

    if (!deploymentHost) {
      fail('could not parse the production deployment URL from `vercel deploy --prod --yes` output.', deployment.combined);
    }
  }

  console.log(`[deploy-align] target deployment: https://${deploymentHost}`);
  await verifyCanonicalAlias(deploymentHost);
  console.log(`[deploy-align] official production URL: ${CANONICAL_PRODUCTION_URL}`);
}

await main();
