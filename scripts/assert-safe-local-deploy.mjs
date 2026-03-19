import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(`[deploy-guard] ${message}`);
  process.exit(1);
}

function readGit(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const repoRoot = readGit(['rev-parse', '--show-toplevel']);
const branch = readGit(['branch', '--show-current']);
const markerPath = path.join(repoRoot, '.canonical-deploy-repo');

if (!existsSync(markerPath)) {
  fail(`canonical deploy marker missing at ${markerPath}.`);
}

const marker = readFileSync(markerPath, 'utf8');
const expectedPathLine = marker
  .split('\n')
  .map((line) => line.trim())
  .find((line) => line.startsWith('canonical-production-path='));
const expectedPath = expectedPathLine?.split('=')[1];

if (!expectedPath) {
  fail(`canonical production path missing in ${markerPath}.`);
}

if (repoRoot !== expectedPath) {
  fail(`production deploys are only allowed from ${expectedPath} (current: ${repoRoot}).`);
}

if (branch !== 'main') {
  fail(`production deploys are only allowed from branch "main" (current: "${branch || 'detached'}").`);
}

console.log(`[deploy-guard] canonical repo confirmed: ${repoRoot}`);
console.log(`[deploy-guard] branch confirmed: ${branch}`);
