#!/usr/bin/env node
// Blocks NEW TypeScript errors without demanding the repo's existing ones be fixed first.
//
// `npm run build` runs vite, which strips types without checking them, so an undefined
// identifier reaches production as a runtime crash. A plain `tsc --noEmit` gate is not
// usable yet because the repo carries pre-existing errors, so this compares the current
// per-file error count against a committed baseline and fails only where it grew.
//
//   node scripts/verify-typecheck-baseline.mjs            verify
//   node scripts/verify-typecheck-baseline.mjs --update   rewrite the baseline
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(repoRoot, 'typecheck-baseline.json');
const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

function runTypecheck() {
  try {
    execFileSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return '';
  } catch (error) {
    // tsc exits non-zero whenever it reports anything; the diagnostics are the payload.
    const output = `${error.stdout || ''}${error.stderr || ''}`;
    if (!output.trim()) throw error;
    return output;
  }
}

function countByFile(output) {
  const counts = {};
  for (const line of output.split('\n')) {
    const match = ERROR_LINE.exec(line.trim());
    if (!match) continue;
    const file = match[1].split('\\').join('/');
    counts[file] = (counts[file] || 0) + 1;
  }
  return counts;
}

const output = runTypecheck();
const current = countByFile(output);
const total = Object.values(current).reduce((sum, count) => sum + count, 0);

if (process.argv.includes('--update')) {
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  console.log(`[typecheck] baseline updated: ${Object.keys(sorted).length} files, ${total} errors`);
  process.exit(0);
}

let baseline = {};
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch {
  console.error(`[typecheck] baseline missing at ${baselinePath}. Run: npm run typecheck:baseline`);
  process.exit(1);
}

const regressions = Object.entries(current)
  .filter(([file, count]) => count > (baseline[file] || 0))
  .map(([file, count]) => ({ file, count, allowed: baseline[file] || 0 }));

if (regressions.length === 0) {
  const fixed = Object.entries(baseline).filter(([file, count]) => (current[file] || 0) < count);
  console.log(`[typecheck] no new type errors (${total} known, ${Object.keys(current).length} files)`);
  if (fixed.length > 0) {
    console.log(`[typecheck] ${fixed.length} file(s) improved — run "npm run typecheck:baseline" to lock it in`);
  }
  process.exit(0);
}

console.error('[typecheck] new type errors detected\n');
for (const { file, count, allowed } of regressions) {
  console.error(`  ${file}: ${count} error(s), baseline allows ${allowed}`);
  for (const line of output.split('\n')) {
    const match = ERROR_LINE.exec(line.trim());
    if (match && match[1].split('\\').join('/') === file) console.error(`      ${line.trim()}`);
  }
}
console.error('\nFix the errors above, or run "npm run typecheck:baseline" if they are intentional.');
process.exit(1);
