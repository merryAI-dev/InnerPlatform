import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    expect(workflowText).toContain('DISPATCH_NOTE: ${{ inputs.note }}');
    expect(workflowText).toContain('DEPLOY_NOTE: ${{ needs.preflight.outputs.note }}');
    expect(workflowText).toContain('printf \'%s\\n\' "- Note: ${DEPLOY_NOTE}"');
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
    expect(workflowText.match(/if: needs\.preflight\.outputs\.promote == 'true'/g)).toHaveLength(2);
    expect(workflowText).toContain('deployment_host="${deployment_url#https://}"');
    expect(workflowText).toContain('echo "deployment_host=${deployment_host}" >> "${GITHUB_OUTPUT}"');
    expect(workflowText).toContain('Promote canonical production alias');
    expect(workflowText).toContain('"${VERCEL_CANONICAL_PRODUCTION_HOST}"');
    expect(workflowText).toContain('--scope merryai-devs-projects');
    expect(workflowText.indexOf('Promote canonical production alias')).toBeLessThan(
      workflowText.indexOf('Verify canonical production alias'),
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
