#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const JVM_ROOT = 'server/jvm-weekly-api/';
const BFF_CUTOVER_PATHS = [
  'server/bff/routes/jvm-weekly-api.mjs',
  'server/bff/cashflow/settlement-cycle/',
  'server/bff/java-weekly-auth.mjs',
  'server/bff/cashflow-month-close-withdrawal.mjs',
  'src/app/components/cashflow/',
  'src/app/data/admin-route-providers.tsx',
  'src/app/data/portal-route-providers.tsx',
  'src/app/data/cashflow-month-close-request-reconcile.ts',
  'src/app/data/cashflow-weeks-store.tsx',
  'src/app/lib/platform-bff-client.ts',
  'src/app/platform/api-error-messages.ts',
  'src/app/platform/cashflow-settlement-cycle.ts',
];
const JVM_ROLLOUT_SUPPORT_PATHS = new Set([
  'server/bff/cashflow/settlement-cycle/contract.mjs',
  'server/bff/cashflow/settlement-cycle/jvm-anti-corruption-adapter.mjs',
  'server/bff/cashflow/settlement-cycle/jvm-anti-corruption-adapter.test.mjs',
]);
const JVM_WEEKLY_ROUTE = 'server/bff/routes/jvm-weekly-api.mjs';
const JVM_ROLLOUT_SUPPORT_IMPORT = '../cashflow/settlement-cycle/jvm-anti-corruption-adapter.mjs';

function isPathOrChild(path, candidate) {
  return candidate.endsWith('/') ? path.startsWith(candidate) : path === candidate;
}

export function classifyCashflowSettlementReleasePaths(paths, { rolloutSupportIsLive = false } = {}) {
  const normalized = [...new Set(paths.map((path) => String(path || '').trim()).filter(Boolean))];
  return {
    jvm: normalized.filter((path) => path.startsWith(JVM_ROOT)),
    bffFrontendCutover: normalized.filter((path) => (
      (!JVM_ROLLOUT_SUPPORT_PATHS.has(path) || rolloutSupportIsLive)
      &&
      BFF_CUTOVER_PATHS.some((candidate) => isPathOrChild(path, candidate))
    )),
  };
}

export function assertCashflowSettlementReleaseBoundary(paths, options) {
  const classified = classifyCashflowSettlementReleasePaths(paths, options);
  if (classified.jvm.length > 0 && classified.bffFrontendCutover.length > 0) {
    throw new Error([
      'Cashflow settlement release boundary violation.',
      'Land and verify the JVM-only release before the BFF/frontend cutover release.',
      `JVM paths: ${classified.jvm.join(', ')}`,
      `BFF/frontend paths: ${classified.bffFrontendCutover.join(', ')}`,
    ].join('\n'));
  }
  return classified;
}

export function isJvmRolloutSupportLiveAt(head, execFile = execFileSync) {
  const routeSource = execFile('git', ['show', `${head}:${JVM_WEEKLY_ROUTE}`], { encoding: 'utf8' });
  return String(routeSource).includes(JVM_ROLLOUT_SUPPORT_IMPORT);
}

export function changedPathsBetween(base, head, execFile = execFileSync) {
  const stdout = execFile('git', [
    'diff', '--name-status', '-z', '--find-renames', '--diff-filter=ACDMRT', base, head,
  ], {
    encoding: 'utf8',
  });
  const fields = String(stdout || '').split('\0');
  const paths = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) continue;
    const source = fields[index++];
    if (!source) throw new Error(`Malformed git diff entry for status ${status}.`);
    paths.push(source);
    if (status.startsWith('R') || status.startsWith('C')) {
      const target = fields[index++];
      if (!target) throw new Error(`Malformed git ${status} entry.`);
      paths.push(target);
    }
  }
  return [...new Set(paths)];
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!['--base', '--jvm-base', '--bff-base', '--head'].includes(arg) || index + 1 >= argv.length) {
      throw new Error(`Unknown or incomplete option: ${arg}`);
    }
    options[arg.slice(2).replaceAll('-', '')] = argv[index + 1];
    index += 1;
  }
  if (options.base) {
    options.jvmbase ||= options.base;
    options.bffbase ||= options.base;
  }
  if (!options.jvmbase || !options.bffbase || !options.head) {
    throw new Error('--jvm-base, --bff-base, and --head are required.');
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const classificationOptions = {
    rolloutSupportIsLive: isJvmRolloutSupportLiveAt(options.head),
  };
  const jvmPending = classifyCashflowSettlementReleasePaths(
    changedPathsBetween(options.jvmbase, options.head),
    classificationOptions,
  ).jvm;
  const bffPending = classifyCashflowSettlementReleasePaths(
    changedPathsBetween(options.bffbase, options.head),
    classificationOptions,
  ).bffFrontendCutover;
  const result = assertCashflowSettlementReleaseBoundary(
    [...jvmPending, ...bffPending],
    classificationOptions,
  );
  console.log(JSON.stringify({ ok: true, ...result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
