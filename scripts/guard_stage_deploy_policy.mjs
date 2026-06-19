import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const STAGE_HOST = 'inner-platform-internal-stage-merryai-devs-projects.vercel.app';

const ALLOWED_FILES = new Set([
  '.github/workflows/stage-deploy.yml',
  'docs/operations/2026-05-26-production-deployment-governance.md',
  'docs/operations/2026-06-18-stage-deployment-governance.md',
  'server/production-deploy-workflow.test.ts',
  'scripts/assert-safe-stage-deploy.mjs',
  'scripts/guard_stage_deploy_policy.mjs',
]);

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function fail(message) {
  console.error(`[stage-policy-guard] ${message}`);
  process.exit(1);
}

function stagedFiles() {
  const output = git(['diff', '--cached', '--name-only', '--diff-filter=ACM']);
  return output ? output.split('\n').filter(Boolean) : [];
}

function committedFiles(range) {
  const output = git(['diff', '--name-only', '--diff-filter=ACM', range]);
  return output ? output.split('\n').filter(Boolean) : [];
}

function readStaged(file) {
  try {
    return git(['show', `:${file}`]);
  } catch {
    return '';
  }
}

function readCurrent(file) {
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8');
}

function readCommitted(file, range) {
  const endRef = range?.includes('..') ? range.split('..').pop() : 'HEAD';
  try {
    return git(['show', `${endRef}:${file}`]);
  } catch {
    return readCurrent(file);
  }
}

function hasForbiddenStageCommand(content) {
  const compact = content.replace(/\s+/g, ' ');
  const mentionsStage = compact.includes(STAGE_HOST);
  const aliasesStage =
    /vercel\s+alias\s+set/i.test(compact) &&
    (mentionsStage || /inner-platform-(?:internal-)?stage/i.test(compact));
  const deploysStage =
    /vercel\s+deploy/i.test(compact) &&
    (mentionsStage || /stagePolicy=|deploy:stage|Stage Deploy/i.test(compact));
  return aliasesStage || deploysStage;
}

const committedFlagIndex = process.argv.indexOf('--committed');
const mode = committedFlagIndex === -1 ? 'staged' : 'committed';
const range = mode === 'committed' ? process.argv[committedFlagIndex + 1] || 'HEAD~20..HEAD' : null;
const files = mode === 'staged' ? stagedFiles() : committedFiles(range);
const violations = [];

for (const file of files) {
  if (ALLOWED_FILES.has(file)) continue;
  const content = mode === 'staged' ? readStaged(file) : readCommitted(file, range);
  if (!content) continue;
  if (hasForbiddenStageCommand(content)) {
    violations.push(file);
  }
}

if (violations.length > 0) {
  fail(
    [
      'forbidden direct stage deployment or alias command detected.',
      `Stage host ${STAGE_HOST} may only be promoted by .github/workflows/stage-deploy.yml.`,
      `Files: ${violations.join(', ')}`,
    ].join('\n'),
  );
}

console.log(`[stage-policy-guard] ${mode} files comply with Git-only stage deployment policy.`);
