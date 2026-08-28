import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..');
const workflowText = readFileSync(resolve(repoRoot, '.github/workflows/production-deploy.yml'), 'utf8');
const ciWorkflowText = readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8');

function extractRunBlocks(text: string) {
  const lines = text.split('\n');
  const blocks: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)run:\s*\|/);
    if (!match) continue;

    const runIndent = match[1].length;
    const body: string[] = [];
    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
      const line = lines[bodyIndex];
      if (line.trim() && line.search(/\S/) <= runIndent) break;
      body.push(line);
    }
    blocks.push(body.join('\n'));
  }

  return blocks;
}

function extractNamedStep(text: string, name: string) {
  const marker = `      - name: ${name}\n`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Missing workflow step: ${name}`);
  const next = text.indexOf('\n      - ', start + marker.length);
  return text.slice(start, next < 0 ? text.length : next);
}

function extractStepIf(step: string) {
  return step.match(/^        if:\s*(.+)$/m)?.[1] ?? null;
}

function extractShellFunction(text: string, name: string) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `${name}() {`);
  if (start < 0) throw new Error(`Missing workflow shell function: ${name}`);
  const indent = lines[start].search(/\S/);
  const end = lines.findIndex((line, index) => (
    index > start && line === `${' '.repeat(indent)}}`
  ));
  if (end < 0) throw new Error(`Unclosed workflow shell function: ${name}`);
  return lines.slice(start, end + 1).map((line) => line.slice(indent)).join('\n');
}

function runDigestNormalizer(text: string, imageUri: string, expectedRepository: string) {
  const functionSource = extractShellFunction(text, 'normalize_live_image_digest');
  return spawnSync('bash', ['-c', [
    'set -euo pipefail',
    functionSource,
    'normalized="$(normalize_live_image_digest "$1" "$2")"',
    'printf \'%s\\n\' "${normalized}"',
  ].join('\n'), 'digest-normalizer', imageUri, expectedRepository], { encoding: 'utf8' });
}

function extractReleaseModeProgram(text: string) {
  const step = extractNamedStep(text, 'Classify Production release mode');
  const match = step.match(
    /release_classification="\$\(node --input-type=module - "\$\{BFF_DEPLOY_BASE_SHA\}" "\$\{DEPLOY_SHA\}" <<'NODE'\n([\s\S]*?)\n\s+NODE\n\s+\)"/,
  );
  if (!match) throw new Error('Missing release-mode inline program');
  const lines = match[1].split('\n');
  const indent = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)?.[0].length ?? 0),
  );
  return lines.map((line) => line.slice(indent)).join('\n');
}

function classifyProductionReleaseInTempRepo(changes: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'myscube-production-release-mode-'));
  const write = (path: string, contents: string) => {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    copyFileSync(
      resolve(repoRoot, 'scripts/verify-cashflow-settlement-release-boundary.mjs'),
      join(dir, 'scripts/verify-cashflow-settlement-release-boundary.mjs'),
    );
    write('server/bff/routes/jvm-weekly-api.mjs', 'export const route = true;\n');
    write('README.md', 'base\n');
    git('init', '-q');
    git('config', 'user.email', 'release-mode-test@example.com');
    git('config', 'user.name', 'Release Mode Test');
    git('add', '.');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');

    for (const [path, contents] of Object.entries(changes)) write(path, contents);
    git('add', '.');
    git('commit', '-qm', 'candidate');
    const head = git('rev-parse', 'HEAD');

    const output = execFileSync(process.execPath, ['--input-type=module', '-', base, head], {
      cwd: dir,
      encoding: 'utf8',
      input: extractReleaseModeProgram(workflowText),
    }).trim();
    return JSON.parse(output) as { releaseMode: 'jvm_only' | 'web'; settlementCutover: boolean };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('production deployment workflow safety', () => {
  it('deploys only through the Production environment from the full main ref', () => {
    expect(workflowText).toMatch(/environment:\n\s+name: Production/);
    // 수동 dispatch 는 main 에서만.
    expect(workflowText).toContain('if [ "${DISPATCH_REF}" != "refs/heads/main" ]; then');
    // 자동/수동 모두 preflight 가 확정한 SHA 를 체크아웃하고, 그것과 일치하는지 다시 확인한다.
    expect(workflowText).toContain('ref: ${{ needs.preflight.outputs.sha }}');
    expect(workflowText).toContain('test "$(git rev-parse HEAD)" = "${DEPLOY_SHA}"');
    // 배포 대상은 반드시 main 의 현재 head 여야 한다.
    expect(workflowText).toContain('head="$(gh api "repos/${GITHUB_REPOSITORY}/commits/main" --jq .sha)"');
  });

  it('auto-deploys only a green main commit and skips superseded ones', () => {
    expect(workflowText).toMatch(/workflow_run:\n\s+workflows: \[CI\]/);
    expect(workflowText).toContain('branches: [main]');
    // CI 가 실패했거나 PR 이벤트로 돈 CI 는 배포 대상이 아니다.
    expect(workflowText).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflowText).toContain("github.event.workflow_run.event == 'push'");
    expect(workflowText).toContain('CI_SHA: ${{ github.event.workflow_run.head_sha }}');
    // 뒤처진 커밋은 조용히 건너뛴다. 최신 커밋의 CI 가 자기 배포를 띄운다.
    expect(workflowText).toContain('skipping superseded');
    expect(workflowText).toContain("if: needs.preflight.outputs.proceed == 'true'");
    // 자동 경로라고 CI 초록 가드를 건너뛰지 않는다.
    expect(workflowText).toContain('CI must be green for ${DEPLOY_SHA} before production deploy.');
  });

  it('does not interpolate manual workflow inputs directly inside shell run blocks', () => {
    const runBlocks = extractRunBlocks(workflowText);

    expect(runBlocks.some((block) => block.includes('${{ inputs.'))).toBe(false);
    expect(runBlocks.some((block) => block.includes('${{ needs.'))).toBe(false);
    expect(workflowText).not.toContain('DISPATCH_NOTE');
    expect(workflowText).not.toContain('DEPLOY_NOTE');
    expect(workflowText).not.toContain('echo "note=${note}" >> "${GITHUB_OUTPUT}"');
  });

  it('does not interpolate deployment outputs directly inside shell run blocks', () => {
    const runBlocks = extractRunBlocks(workflowText);

    expect(runBlocks.some((block) => block.includes('${{ steps.'))).toBe(false);
    expect(workflowText).toContain('DEPLOYMENT_URL: ${{ steps.vercel_deploy.outputs.deployment_url }}');
    expect(workflowText).toContain('DEPLOYMENT_HOST: ${{ steps.vercel_deploy.outputs.deployment_host }}');
    expect(workflowText).toContain('node deploy-prod-align.mjs --verify-only "${DEPLOYMENT_URL}"');
  });

  it('promotes the canonical production alias before verifying it', () => {
    expect(workflowText).toContain('promote_alias:');
    expect(workflowText).toContain('default: true');
    for (const name of [
      'Capture current canonical alias',
      'Promote canonical production alias',
      'Verify canonical alias target',
    ]) {
      expect(extractNamedStep(workflowText, name)).toContain("needs.preflight.outputs.promote == 'true'");
    }
    expect(workflowText).toContain('deployment_host="${deployment_url#https://}"');
    expect(workflowText).toContain('echo "deployment_host=${deployment_host}" >> "${GITHUB_OUTPUT}"');
    expect(workflowText).toContain('Promote canonical production alias');
    expect(workflowText).toContain('"${VERCEL_CANONICAL_PRODUCTION_HOST}"');
    expect(workflowText).toContain('--scope merryai-devs-projects');
    expect(workflowText.indexOf('Promote canonical production alias')).toBeLessThan(
      workflowText.indexOf('Verify canonical alias target'),
    );
  });

  it('keeps the Vercel deployment URL parse failure path reachable under pipefail', () => {
    expect(workflowText).toContain('deployment_url="$(grep -Eo');
    expect(workflowText).toContain('| tail -n 1 || true)"');
    expect(workflowText).toContain('Could not parse Vercel deployment URL');
  });

  it('deploys the production artifact with Live reads and writes enabled before alias promotion', () => {
    expect(workflowText).toContain('LIVE_FIREBASE_PROJECT_ID: inner-platform-live-20260316');
    expect(workflowText).toContain('BFF_DEPLOY_ENV: live');
    expect(workflowText).toContain("BFF_EDIT_LEASES_ENABLED: 'true'");
    expect(workflowText).toContain("BFF_WORKERS_ENABLED: 'true'");
    expect(workflowText).toContain('BFF_SCHEDULER_OWNER: vercel');
    expect(workflowText).toContain("BFF_MAINTENANCE_READ_ONLY: 'false'");
    expect(workflowText).toContain('--env FIREBASE_PROJECT_ID="${LIVE_FIREBASE_PROJECT_ID}"');
    expect(workflowText).toContain('--env BFF_FIREBASE_AUTH_PROJECT_ID="${LIVE_FIREBASE_PROJECT_ID}"');
    expect(workflowText).toContain('--env JVM_WEEKLY_FIRESTORE_PROJECT_ID="${LIVE_FIREBASE_PROJECT_ID}"');
    expect(workflowText).toContain('JVM_WEEKLY_API_BASE_URL: ${{ vars.JVM_WEEKLY_API_BASE_URL_LIVE }}');
    expect(workflowText).toContain('JVM_WEEKLY_API_ID_TOKEN_AUDIENCE: ${{ vars.JVM_WEEKLY_API_ID_TOKEN_AUDIENCE_LIVE }}');
    expect(workflowText).toContain('JVM_WEEKLY_INTERNAL_API_TOKEN: ${{ secrets.JVM_WEEKLY_INTERNAL_API_TOKEN_LIVE }}');
    expect(workflowText).toContain('JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON: ${{ secrets.JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON_LIVE }}');
    expect(workflowText).toContain('--env JVM_WEEKLY_API_BASE_URL="${JVM_WEEKLY_API_BASE_URL}"');
    expect(workflowText).toContain('--env JVM_WEEKLY_API_ID_TOKEN_AUDIENCE="${JVM_WEEKLY_API_ID_TOKEN_AUDIENCE}"');
    expect(workflowText).toContain('--env JVM_WEEKLY_INTERNAL_API_TOKEN="${JVM_WEEKLY_INTERNAL_API_TOKEN}"');
    expect(workflowText).toContain('--env JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON="${JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON}"');
    expect(workflowText).not.toContain("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: '{}'");
    expect(workflowText).not.toContain('--env GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON=');
    expect(workflowText).toContain('--env SLACK_ALERT_WEBHOOK_URL=');
    expect(workflowText).toContain('--build-env VITE_FIRESTORE_CORE_ENABLED=false');
    expect(workflowText).toContain('--build-env VITE_FIREBASE_PROJECT_ID="${LIVE_FIREBASE_PROJECT_ID}"');
    expect(workflowText).toContain('VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}');
    expect(workflowText).toContain("'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(workflowText).toContain('deploy --prod --yes --skip-domain');
    expect(workflowText).toContain('/api/v1/__maintenance_probe__');
    expect(workflowText).toContain('unauthorized_worker');
    expect(workflowText).toContain('mutation.response.status !== 400');
    expect(workflowText).toContain("mutation.body.error === 'maintenance_read_only'");
    expect(workflowText.indexOf('Verify production surface before alias')).toBeLessThan(
      workflowText.indexOf('Promote canonical production alias'),
    );
  });

  it('uses a production-scoped Vercel token secret to avoid repo/environment name shadowing', () => {
    expect(workflowText).toContain('VERCEL_DEPLOY_TOKEN_PRODUCTION');
    expect(workflowText).not.toContain('VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}');
    expect(workflowText).toContain('Missing secret: VERCEL_DEPLOY_TOKEN_PRODUCTION');
    expect(workflowText).toContain('whoami --token "${VERCEL_TOKEN}" --scope merryai-devs-projects');
  });

  it('blocks a mixed JVM and settlement BFF/frontend release before either deploy can race', () => {
    expect(workflowText).toContain('fetch-depth: 0');
    expect(workflowText).toContain('Verify cashflow settlement split-release boundary');
    expect(workflowText).toContain('verify-cashflow-settlement-release-boundary.mjs');
    expect(workflowText).toContain('--jvm-base "${JVM_DEPLOY_BASE_SHA}"');
    expect(workflowText).toContain('--bff-base "${BFF_DEPLOY_BASE_SHA}"');
    expect(workflowText).toContain('Deploy production from main');
    expect(workflowText.indexOf('Verify cashflow settlement split-release boundary'))
      .toBeLessThan(workflowText.indexOf('Deploy to Vercel production'));
  });

  it('classifies JVM-only work from the canonical alias before requiring the JVM verifier', () => {
    const releaseModeStep = extractNamedStep(
      workflowText,
      'Classify Production release mode',
    );
    expect(releaseModeStep).toContain('const [aliasBase, head] = process.argv.slice(2);');
    expect(releaseModeStep).toContain('changedPathsBetween(aliasBase, head)');
    expect(releaseModeStep).toContain('classifyCashflowSettlementProductionRelease');
    expect(releaseModeStep).toContain('const { releaseMode, bffFrontendCutover } = classifyCashflowSettlementProductionRelease(');
    expect(releaseModeStep).not.toContain('const jvmOnlyReleaseSupportPaths = new Set');
    expect(releaseModeStep).not.toContain('const unexpectedPaths = changedPaths.filter');
    expect(releaseModeStep).toContain('echo "release_mode=${release_mode}"');
    expect(releaseModeStep).toContain('echo "settlement_cutover=${settlement_cutover}"');
    expect(workflowText.indexOf('Classify Production release mode'))
      .toBeLessThan(workflowText.indexOf('Authenticate JVM release verifier'));

    const verifierAuth = extractNamedStep(workflowText, 'Authenticate JVM release verifier');
    const gcloudSetup = extractNamedStep(workflowText, 'Set up gcloud for release verification');
    const boundaryStep = extractNamedStep(workflowText, 'Verify cashflow settlement split-release boundary');
    for (const step of [verifierAuth, gcloudSetup, boundaryStep]) {
      expect(extractStepIf(step)).toContain("steps.release_mode.outputs.settlement_cutover == 'true'");
    }
    expect(boundaryStep).toContain('boundary_json="$(node scripts/verify-cashflow-settlement-release-boundary.mjs');
    expect(boundaryStep).not.toContain('release_mode="$(node --input-type=module -');

    const skipStep = extractNamedStep(workflowText, 'Skip Production for JVM-only release');
    expect(skipStep).toContain("if: steps.release_mode.outputs.release_mode == 'jvm_only'");
    expect(skipStep).toContain('JVM-only release; Vercel production intentionally skipped.');
  });

  it('never treats a JVM change mixed with ordinary web runtime code as JVM-only', () => {
    expect(classifyProductionReleaseInTempRepo({
      'server/jvm-weekly-api/src/main/java/example/NewCapability.java': 'final class NewCapability {}\n',
    })).toEqual({ releaseMode: 'jvm_only', settlementCutover: false });
    expect(classifyProductionReleaseInTempRepo({
      'src/app/components/people/PeoplePage.tsx': 'export const PeoplePage = () => null;\n',
    })).toEqual({ releaseMode: 'web', settlementCutover: false });
    expect(classifyProductionReleaseInTempRepo({
      'server/jvm-weekly-api/src/main/java/example/NewCapability.java': 'final class NewCapability {}\n',
      'src/app/components/people/PeoplePage.tsx': 'export const PeoplePage = () => null;\n',
    })).toEqual({ releaseMode: 'web', settlementCutover: false });
    expect(classifyProductionReleaseInTempRepo({
      'server/jvm-weekly-api/src/main/java/example/NewCapability.java': 'final class NewCapability {}\n',
      '.github/workflows/ci.yml/child': 'not an exact support path\n',
    })).toEqual({ releaseMode: 'web', settlementCutover: false });
    expect(classifyProductionReleaseInTempRepo({
      'server/jvm-weekly-api/src/main/java/example/NewCapability.java': 'final class NewCapability {}\n',
      '.github/workflows/ci.yml': 'name: hardened CI\n',
      '.github/workflows/jvm-production-deploy.yml': 'name: hardened JVM workflow\n',
      '.github/workflows/production-deploy.yml': 'name: hardened production workflow\n',
      'deploy-prod-align.mjs': 'export {};\n',
      'scripts/verify-cashflow-settlement-candidate.mjs': 'export {};\n',
      'scripts/verify-cashflow-settlement-release-boundary.mjs': `${readFileSync(
        resolve(repoRoot, 'scripts/verify-cashflow-settlement-release-boundary.mjs'),
        'utf8',
      )}\n`,
      'scripts/audit-cashflow-settlement-cycle-rollout.mjs': 'export {};\n',
      'server/bff/cashflow-settlement-cycle-rollout.mjs': 'export {};\n',
      'server/bff/cashflow-settlement-cycle-rollout.test.mjs': 'export {};\n',
      'server/bff/cashflow-settlement-cycle-rollout.integration.test.ts': 'export {};\n',
      'server/bff/cashflow/settlement-cycle/contract.mjs': 'export {};\n',
      'server/bff/cashflow/settlement-cycle/jvm-anti-corruption-adapter.mjs': 'export {};\n',
      'server/bff/cashflow/settlement-cycle/jvm-anti-corruption-adapter.test.mjs': 'export {};\n',
      'server/cashflow-settlement-candidate-canary.test.mjs': 'export {};\n',
      'server/cashflow-settlement-release-boundary.test.mjs': 'export {};\n',
      'server/deploy-prod-align.test.ts': 'export {};\n',
      'server/production-deploy-workflow.test.ts': 'export {};\n',
    })).toEqual({ releaseMode: 'jvm_only', settlementCutover: false });
    expect(classifyProductionReleaseInTempRepo({
      'src/app/components/cashflow/CashflowWeeklyPage.tsx': 'export const CashflowWeeklyPage = () => null;\n',
    })).toEqual({ releaseMode: 'web', settlementCutover: true });
    expect(classifyProductionReleaseInTempRepo({
      'server/jvm-weekly-api/src/main/java/example/NewCapability.java': 'final class NewCapability {}\n',
      'server/bff/routes/jvm-weekly-api.mjs': 'export const cutover = true;\n',
    })).toEqual({ releaseMode: 'web', settlementCutover: true });
  }, 15_000);

  it('skips every Vercel and live-JVM action for JVM-only work', () => {
    const gatedSteps = [
      'Verify Vercel deploy author policy',
      'Verify Vercel credentials are configured',
      'Verify deployed JVM settlement capability and version',
      'Mint JVM cutover verifier ID token',
      'Verify settlement-cycle cutover inventory',
      'Deploy to Vercel production',
      'Verify Vercel candidate identity',
      'Verify production surface before alias',
      'Verify authenticated settlement reads before alias',
      'Capture current canonical alias',
      'Promote canonical production alias',
      'Verify canonical alias target',
      'Reconcile canonical alias or roll back',
      'Release summary',
    ];

    for (const name of gatedSteps) {
      const step = extractNamedStep(workflowText, name);
      const condition = extractStepIf(step);
      expect({
        name,
        gated: condition?.includes("steps.release_mode.outputs.release_mode != 'jvm_only'")
          || condition?.includes("steps.release_mode.outputs.settlement_cutover == 'true'"),
      })
        .toEqual({ name, gated: true });
    }
    expect(extractStepIf(extractNamedStep(workflowText, 'Reconcile canonical alias or roll back')))
      .toContain('always()');
  });

  it('uses a dedicated least-privilege Firebase canary only in the two canary steps', () => {
    expect(workflowText).toContain('FIREBASE_SETTLEMENT_READ_CANARY_REFRESH_TOKEN_LIVE');
    expect(workflowText).toContain('FIREBASE_WEB_API_KEY_LIVE');
    expect(workflowText).toContain('SETTLEMENT_READ_CANARY_ACTOR_UID_LIVE');
    expect(workflowText).not.toContain('SETTLEMENT_CANARY_ACTOR_UID: ${{ vars.JVM_SETTLEMENT_CANARY_ACTOR_UID_LIVE }}');
    expect(workflowText).toContain('JVM_SETTLEMENT_CANARY_PROJECT_ID_LIVE');
    expect(workflowText).toContain('JVM_SETTLEMENT_CANARY_CYCLE_YEAR_MONTH_LIVE');
    expect(workflowText.match(/FIREBASE_SETTLEMENT_READ_CANARY_REFRESH_TOKEN_LIVE/g)).toHaveLength(2);
    expect(workflowText).toContain('Verify authenticated settlement reads before alias');
    expect(workflowText).toContain('node scripts/verify-cashflow-settlement-candidate.mjs');
    expect(workflowText).not.toContain('npm run cashflow:settlement-cycle:canary');
    expect(workflowText.indexOf('Verify authenticated settlement reads before alias'))
      .toBeLessThan(workflowText.indexOf('Promote canonical production alias'));
    expect(workflowText.lastIndexOf('Reconcile canonical alias or roll back'))
      .toBeGreaterThan(workflowText.indexOf('Promote canonical production alias'));
  });

  it('binds both canaries to one approved settlement fixture', () => {
    expect(workflowText).toContain('SETTLEMENT_CANARY_EXPECTED_REQUEST_ID');
    expect(workflowText).toContain('SETTLEMENT_CANARY_EXPECTED_STATUS');
    expect(workflowText).toContain('SETTLEMENT_CANARY_EXPECTED_WORKFLOW_REVISION');
    expect(workflowText).toContain('SETTLEMENT_CANARY_EXPECTED_EVIDENCE_REVISION');
    expect(workflowText).toContain('SETTLEMENT_CANARY_EXPECTED_TARGET_YEAR_MONTH');
    expect(workflowText).toContain('SETTLEMENT_CANARY_EXPECTED_ACTIONS');
    expect(workflowText).toContain('SETTLEMENT_CANARY_EXPECTED_REQUEST_ID_LIVE');
    expect(workflowText).toContain('SETTLEMENT_CANARY_EXPECTED_STATUS_LIVE');
    expect(workflowText).toContain('SETTLEMENT_CANARY_EXPECTED_WORKFLOW_REVISION_LIVE');
    expect(workflowText).toContain('SETTLEMENT_CANARY_EXPECTED_EVIDENCE_REVISION_LIVE');
    expect(workflowText).toContain('SETTLEMENT_CANARY_EXPECTED_TARGET_YEAR_MONTH_LIVE');
    expect(workflowText).toContain('SETTLEMENT_CANARY_EXPECTED_ACTIONS_LIVE');
  });

  it('requires persistent proof that the live JVM version and capability cover the cutover', () => {
    expect(workflowText).toContain('Verify deployed JVM settlement capability and version');
    expect(workflowText).toContain('JVM_DEPLOYED_SHA');
    expect(workflowText).toContain('git diff --quiet "${JVM_DEPLOYED_SHA}" "${DEPLOY_SHA}" -- ${JVM_SOURCE_PATHS}');
    expect(workflowText).toContain('google-auth-library');
    expect(workflowText).toContain('settlement-cycle-v1');
    expect(workflowText).toContain('id-token: write');
    expect(workflowText).toContain('live_revision=');
    expect(workflowText).toContain('select(.name == "JVM_WEEKLY_COMMIT_SHA")');
    expect(workflowText).toContain('test "${live_sha}" = "${JVM_DEPLOYED_SHA}"');
    expect(workflowText).toContain('baseUrl.origin !== audience.origin');
    expect(workflowText.indexOf('Verify deployed JVM settlement capability and version'))
      .toBeLessThan(workflowText.indexOf('Deploy to Vercel production'));
  });

  it('fails closed on the full settlement inventory against the canonical live JVM before any Vercel deploy', () => {
    const verifierAuth = extractNamedStep(workflowText, 'Authenticate JVM release verifier');
    const versionStep = extractNamedStep(
      workflowText,
      'Verify deployed JVM settlement capability and version',
    );
    const idTokenStep = extractNamedStep(workflowText, 'Mint JVM cutover verifier ID token');
    const inventoryStep = extractNamedStep(
      workflowText,
      'Verify settlement-cycle cutover inventory',
    );

    expect(verifierAuth).toContain('service_account: ${{ vars.GCP_JVM_RELEASE_VERIFIER_SERVICE_ACCOUNT_LIVE }}');
    expect(verifierAuth).toContain('create_credentials_file: true');
    expect(idTokenStep).toContain('service_account: ${{ vars.GCP_JVM_RELEASE_VERIFIER_SERVICE_ACCOUNT_LIVE }}');
    expect(idTokenStep).toContain('token_format: id_token');
    expect(idTokenStep).toContain('id_token_audience: ${{ vars.JVM_WEEKLY_API_ID_TOKEN_AUDIENCE_LIVE }}');
    expect(idTokenStep).toContain('create_credentials_file: false');
    expect(inventoryStep).toContain('GOOGLE_APPLICATION_CREDENTIALS: ${{ steps.jvm_release_verifier_auth.outputs.credentials_file_path }}');
    expect(inventoryStep).toContain('JVM_WEEKLY_API_ID_TOKEN: ${{ steps.jvm_cutover_verifier_auth.outputs.id_token }}');
    expect(inventoryStep).toContain('JVM_WEEKLY_INTERNAL_API_TOKEN: ${{ secrets.JVM_WEEKLY_INTERNAL_API_TOKEN_LIVE }}');
    expect(inventoryStep).toContain('CASHFLOW_ACTOR_UID: ${{ vars.JVM_SETTLEMENT_CANARY_ACTOR_UID_LIVE }}');
    expect(inventoryStep).not.toContain('GCP_JVM_DEPLOYER_SERVICE_ACCOUNT_LIVE');
    expect(inventoryStep).not.toContain('JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON_LIVE');
    expect(inventoryStep).toContain('--verify-cutover');
    expect(inventoryStep).toContain('--jvm-base-url "${JVM_WEEKLY_API_BASE_URL}"');
    expect(inventoryStep).toContain('--jvm-audience "${JVM_WEEKLY_API_ID_TOKEN_AUDIENCE}"');
    expect(extractStepIf(idTokenStep)).toContain("steps.release_mode.outputs.settlement_cutover == 'true'");
    expect(extractStepIf(inventoryStep)).toContain("steps.release_mode.outputs.settlement_cutover == 'true'");
    expect(workflowText.indexOf(versionStep)).toBeLessThan(workflowText.indexOf(idTokenStep));
    expect(workflowText.indexOf(idTokenStep)).toBeLessThan(workflowText.indexOf(inventoryStep));
    expect(workflowText.indexOf(inventoryStep))
      .toBeLessThan(workflowText.indexOf('Deploy to Vercel production'));
  });

  it('gates settlement verification only on cutover paths without freezing unrelated web deploys', () => {
    const settlementSteps = [
      'Authenticate JVM release verifier',
      'Set up gcloud for release verification',
      'Verify cashflow settlement split-release boundary',
      'Verify deployed JVM settlement capability and version',
      'Mint JVM cutover verifier ID token',
      'Verify settlement-cycle cutover inventory',
      'Verify authenticated settlement reads before alias',
    ];
    for (const name of settlementSteps) {
      expect(extractStepIf(extractNamedStep(workflowText, name)))
        .toContain("steps.release_mode.outputs.settlement_cutover == 'true'");
    }

    for (const name of [
      'Deploy to Vercel production',
      'Verify Vercel candidate identity',
      'Verify production surface before alias',
      'Promote canonical production alias',
    ]) {
      const condition = extractStepIf(extractNamedStep(workflowText, name));
      expect(condition).toContain("steps.release_mode.outputs.release_mode != 'jvm_only'");
      expect(condition).not.toContain('settlement_cutover');
    }

    const reconcileStep = extractNamedStep(workflowText, 'Reconcile canonical alias or roll back');
    expect(reconcileStep).toContain('SETTLEMENT_CUTOVER: ${{ steps.release_mode.outputs.settlement_cutover }}');
    expect(reconcileStep).toContain('if [ "${SETTLEMENT_CUTOVER}" != "true" ]');
    expect(reconcileStep).toContain('if [ "${SETTLEMENT_CUTOVER}" = "true" ]; then');
  });

  it('accepts only release bases whose canonical reconciliation step succeeded', () => {
    expect(workflowText).toContain('gcloud run services describe "${JVM_SERVICE}"');
    expect(workflowText).toContain('node deploy-prod-align.mjs --print-current-target');
    expect(workflowText).toContain('inspect "${bff_deployment_host}" --json');
    expect(workflowText).toContain('.meta.githubCommitSha');
    expect(workflowText).toContain('JVM_SPLIT_RELEASE_BASE_SHA_LIVE');
    expect(workflowText).toContain('status.imageDigest');
    expect(workflowText).not.toContain('git hash-object -t tree /dev/null');
    expect(workflowText).toContain('git merge-base --is-ancestor "${bff_deployed_sha}" "${DEPLOY_SHA}"');
    expect(workflowText).toContain('git merge-base --is-ancestor "${jvm_deployed_sha}" "${DEPLOY_SHA}"');
  });

  it('normalizes only an exact live JVM image URI from the expected repository', () => {
    const repository = 'example.pkg.dev/project/repository/service';
    const digest = `sha256:${'b'.repeat(64)}`;
    const valid = runDigestNormalizer(workflowText, `${repository}@${digest}`, repository);
    expect(valid.status).toBe(0);
    expect(valid.stdout.trim()).toBe(digest);

    for (const malformed of [
      `other.pkg.dev/project/repository/service@${digest}`,
      digest,
      `${repository}@sha256:${'b'.repeat(63)}`,
      `${repository}@SHA256:${'b'.repeat(64)}`,
      `${repository}@${digest}@${digest}`,
      `${repository}@`,
    ]) {
      expect(runDigestNormalizer(workflowText, malformed, repository).status).not.toBe(0);
    }

    const boundaryStep = extractNamedStep(
      workflowText,
      'Verify cashflow settlement split-release boundary',
    );
    expect(boundaryStep).toContain('live_image_uri="$(jq -er \'.status.imageDigest\'');
    expect(boundaryStep).toContain('live_digest="$(normalize_live_image_digest "${live_image_uri}" "${JVM_IMAGE}")"');
    expect(boundaryStep).toContain('[[ "${JVM_SPLIT_RELEASE_BASE_SHA}" =~ ^[0-9a-f]{40}$ ]] || {');
    expect(boundaryStep).toContain('[[ "${bootstrap_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || {');
  });

  it('binds the parsed Vercel candidate to this project and commit before authenticated reads', () => {
    expect(workflowText).toContain('Verify Vercel candidate identity');
    expect(workflowText).toContain('inspect "${DEPLOYMENT_HOST}" --json');
    expect(workflowText).toContain('.projectId == $project');
    expect(workflowText).toContain('.meta.githubCommitSha == $sha');
    expect(workflowText).toContain('.meta.githubActionsInvocation == $invocation');
    expect(workflowText).toContain('--meta githubActionsInvocation="${DEPLOY_INVOCATION_ID}"');
    expect(workflowText).toContain('.target == "production"');
    expect(workflowText.indexOf('Verify Vercel candidate identity'))
      .toBeLessThan(workflowText.indexOf('Verify authenticated settlement reads before alias'));
  });

  it('captures the prior alias and restores it on any promotion or post-alias canary failure', () => {
    expect(workflowText).toContain('id: previous_alias');
    expect(workflowText).toContain('--print-current-target');
    expect(workflowText).toContain('id: alias_promotion');
    expect(workflowText).toContain('id: canonical_alias');
    expect(workflowText).toContain(
      "if: always() && steps.release_mode.outputs.release_mode != 'jvm_only' && needs.preflight.outputs.promote == 'true'",
    );
    expect(workflowText).toContain('ALIAS_OUTCOME: ${{ steps.alias_promotion.outcome }}');
    expect(workflowText).toContain('ALIAS_CHECK_OUTCOME: ${{ steps.canonical_alias.outcome }}');
    expect(workflowText).toContain('PREVIOUS_DEPLOYMENT_HOST: ${{ steps.previous_alias.outputs.deployment_host }}');
    expect(workflowText).toContain('PREVIOUS_DEPLOYMENT_ID: ${{ steps.previous_alias.outputs.deployment_id }}');
    expect(workflowText).toContain('PREVIOUS_DEPLOYMENT_SHA: ${{ steps.previous_alias.outputs.commit_sha }}');
    expect(workflowText).toContain('"${PREVIOUS_DEPLOYMENT_HOST}"');
    expect(workflowText).toContain('actual_target="$(node deploy-prod-align.mjs --print-current-target 2>/dev/null)"');
    expect(workflowText).toContain('if [ "${actual_target_status}" = "0" ]');
    expect(workflowText).not.toContain('if [ "${ALIAS_OUTCOME}" = "success" ]');
    expect(workflowText).toContain('rollback_alias_status=0');
    expect(workflowText).toContain('node deploy-prod-align.mjs --verify-only "${PREVIOUS_DEPLOYMENT_HOST}"');
    const reconcileStart = workflowText.lastIndexOf('Reconcile canonical alias or roll back');
    const rollbackVerify = workflowText.indexOf('node deploy-prod-align.mjs --verify-only "${PREVIOUS_DEPLOYMENT_HOST}"', reconcileStart);
    const rollbackCanary = workflowText.indexOf('node scripts/verify-cashflow-settlement-candidate.mjs', rollbackVerify);
    expect(rollbackVerify).toBeGreaterThan(reconcileStart);
    expect(rollbackCanary).toBeGreaterThan(rollbackVerify);
  });

  it('scopes production deploy secrets away from checkout and dependency installation', () => {
    const deployJob = workflowText.slice(workflowText.indexOf('  deploy:'), workflowText.indexOf('    steps:'));
    expect(deployJob).not.toContain('${{ secrets.');
    const installBlock = extractNamedStep(workflowText, 'Install deployment verification dependencies');
    expect(installBlock).not.toContain('${{ secrets.');
    expect(workflowText.indexOf('Install deployment verification dependencies'))
      .toBeLessThan(workflowText.indexOf('google-github-actions/auth@v3'));
    expect(workflowText).toContain('VERCEL_TOKEN: ${{ secrets.VERCEL_DEPLOY_TOKEN_PRODUCTION }}');
    const verifierAuth = extractNamedStep(workflowText, 'Authenticate JVM release verifier');
    const inventoryStep = extractNamedStep(
      workflowText,
      'Verify settlement-cycle cutover inventory',
    );
    expect(verifierAuth).toContain('token_format: access_token');
    expect(verifierAuth).toContain('create_credentials_file: true');
    expect(workflowText).toContain('CLOUDSDK_AUTH_ACCESS_TOKEN: ${{ steps.jvm_release_verifier_auth.outputs.access_token }}');
    expect(inventoryStep).toContain('steps.jvm_release_verifier_auth.outputs.credentials_file_path');
    expect(inventoryStep).not.toContain('VERCEL_DEPLOY_TOKEN_PRODUCTION');
    expect(inventoryStep).not.toContain('JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON_LIVE');
  });
});

describe('CI security evidence gates', () => {
  it('runs static route policy on every CI pass through policy verification', () => {
    expect(ciWorkflowText).toContain('RBAC policy verify');
    expect(ciWorkflowText).toContain('npm run policy:verify');
  });

  it('runs BFF Firestore emulator integration as a blocking product release gate', () => {
    const productGateText = ciWorkflowText.slice(
      ciWorkflowText.indexOf('product-release-gates:'),
      ciWorkflowText.indexOf('edge-security-smoke:'),
    );
    const bffGateIndex = productGateText.indexOf('run: npm run bff:test:integration');

    expect(productGateText.match(/actions\/setup-node@v5/g)).toHaveLength(1);
    expect(productGateText.match(/actions\/setup-java@v5/g)).toHaveLength(1);
    expect(bffGateIndex).toBeGreaterThan(productGateText.indexOf('actions/setup-node@v5'));
    expect(bffGateIndex).toBeGreaterThan(productGateText.indexOf('actions/setup-java@v5'));
    expect(bffGateIndex).toBeGreaterThan(productGateText.indexOf('run: npm ci'));
  });

  it('captures strict Cloudflare edge smoke evidence only for main pushes', () => {
    expect(ciWorkflowText).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(ciWorkflowText).toContain('Strict Cloudflare edge smoke');
    expect(ciWorkflowText).toContain("CLOUDFLARE_EDGE_ALLOW_CHALLENGE: '1'");
    expect(ciWorkflowText).toContain('npm run security:edge-smoke:strict');
    expect(ciWorkflowText).toContain('Upload edge smoke evidence');
    expect(ciWorkflowText).toContain('tmp/edge-smoke/cloudflare-edge-smoke.json');
  });
});
