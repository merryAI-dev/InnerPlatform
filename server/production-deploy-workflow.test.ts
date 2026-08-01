import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..');
const workflowText = readFileSync(resolve(repoRoot, '.github/workflows/production-deploy.yml'), 'utf8');
const stageWorkflowText = readFileSync(resolve(repoRoot, '.github/workflows/stage-deploy.yml'), 'utf8');
const ciWorkflowText = readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const maintenanceRulesText = readFileSync(resolve(repoRoot, 'firebase/firestore.maintenance.rules'), 'utf8');
const maintenanceFirebaseConfig = JSON.parse(
  readFileSync(resolve(repoRoot, 'firebase.maintenance.json'), 'utf8'),
);

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
    expect(workflowText).toContain('if [ "${GITHUB_REF}" != "refs/heads/main" ]; then');
    expect(workflowText).toContain('ref: main');
    expect(workflowText).toContain('test "$(git rev-parse HEAD)" = "${GITHUB_SHA}"');
  });

  it('does not interpolate manual workflow inputs directly inside shell run blocks', () => {
    const runBlocks = extractRunBlocks(workflowText);

    expect(runBlocks.some((block) => block.includes('${{ inputs.'))).toBe(false);
    expect(workflowText).toContain('DEPLOY_NOTE: ${{ inputs.note }}');
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
    expect(workflowText.match(/if: inputs\.promote_alias/g)).toHaveLength(2);
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
    expect(workflowText).toContain("BFF_EDIT_LEASES_ENABLED: 'false'");
    expect(workflowText).toContain("BFF_WORKERS_ENABLED: 'false'");
    expect(workflowText).toContain('BFF_SCHEDULER_OWNER: disabled');
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
    expect(workflowText).toContain('worker_scheduler_disabled');
    expect(workflowText).toContain('mutation.response.status !== 400');
    expect(workflowText).toContain("mutation.body.error === 'stage_maintenance_read_only'");
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

describe('stage release workflow safety', () => {
  it('keeps stage mutations blocked during the live-data rehearsal', () => {
    expect(stageWorkflowText).toContain("BFF_MAINTENANCE_READ_ONLY: 'true'");
    expect(stageWorkflowText).toContain('--env BFF_MAINTENANCE_READ_ONLY="${BFF_MAINTENANCE_READ_ONLY}"');
    expect(maintenanceFirebaseConfig.firestore.rules).toBe('firebase/firestore.maintenance.rules');
    expect(maintenanceRulesText).toContain('allow read, write: if false;');
  });

  it('validates the stage Vercel token against the expected team before release work', () => {
    expect(stageWorkflowText).toMatch(/environment:\n\s+name: Stage/);
    expect(stageWorkflowText).toContain('inner-platform-internal-stage-merryai-devs-projects.vercel.app');
    expect(stageWorkflowText).not.toContain('inner-platform-stage-merryai-devs-projects.vercel.app');
    expect(stageWorkflowText).toContain('VERCEL_DEPLOY_TOKEN_STAGE');
    expect(stageWorkflowText).toContain('Missing secret: VERCEL_DEPLOY_TOKEN_STAGE');
    expect(stageWorkflowText).toContain('whoami --token "${VERCEL_TOKEN}" --scope merryai-devs-projects');
    expect(stageWorkflowText.indexOf('whoami --token "${VERCEL_TOKEN}" --scope merryai-devs-projects')).toBeLessThan(
      stageWorkflowText.indexOf('Deploy Git artifact to Vercel preview'),
    );
  });

  it('keeps the stage alias on the internal Vercel route instead of the production security domain', () => {
    expect(stageWorkflowText).toContain('root_status="$(curl -sS -D /tmp/stage-root-headers.txt');
    expect(stageWorkflowText).toContain('200|401) ;;');
    expect(stageWorkflowText).toContain('Stage must stay on the internal Vercel route and must not traverse Cloudflare.');
    expect(stageWorkflowText).toContain('Stage must not receive security-domain CSP report-only headers.');
    expect(stageWorkflowText).not.toContain('307)');
    expect(stageWorkflowText).not.toContain('https://myscube.myscguard.app/)');
    expect(stageWorkflowText).not.toContain('https://myscube.myscguard.app/*');
    expect(stageWorkflowText).not.toContain('Unexpected stage root redirect location');
    expect(stageWorkflowText).not.toContain('Unexpected stage redirect location');
    expect(stageWorkflowText).not.toContain('200|401|403) ;;');
    expect(stageWorkflowText).not.toContain('200|403) ;;');
  });

  it('does not hang indefinitely when Vercel returns a blocked preview deployment', () => {
    expect(stageWorkflowText).toContain('deploy --yes --no-wait --target preview --token "${VERCEL_TOKEN}"');
    expect(stageWorkflowText).toContain('--wait');
    expect(stageWorkflowText).toContain('--timeout 10m');
    expect(stageWorkflowText).toContain('Stage artifact is not READY');
  });

  it('injects only the guarded Stage lease and JVM runtime into the preview artifact', () => {
    expect(stageWorkflowText).toContain('STAGE_FIREBASE_PROJECT_ID: mysc-bmp-14173451');
    expect(stageWorkflowText).toContain('LIVE_FIREBASE_PROJECT_ID: inner-platform-live-20260316');
    expect(stageWorkflowText).toContain('JVM_WEEKLY_API_BASE_URL_STAGE');
    expect(stageWorkflowText).toContain('JVM_WEEKLY_INTERNAL_API_TOKEN_STAGE');
    expect(stageWorkflowText).toContain('JVM_WEEKLY_AUTH_MODE: strict');
    expect(stageWorkflowText).toContain('node scripts/assert-stage-edit-lease-runtime.mjs');
    expect(stageWorkflowText).toContain('--env BFF_DEPLOY_ENV="${BFF_DEPLOY_ENV}"');
    expect(stageWorkflowText).toContain('--env BFF_EDIT_LEASES_ENABLED="${BFF_EDIT_LEASES_ENABLED}"');
    expect(stageWorkflowText).toContain("BFF_WORKERS_ENABLED: 'false'");
    expect(stageWorkflowText).toContain('BFF_SCHEDULER_OWNER: disabled');
    expect(stageWorkflowText).toContain("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: '{}'");
    expect(stageWorkflowText).toContain('--env BFF_WORKERS_ENABLED="${BFF_WORKERS_ENABLED}"');
    expect(stageWorkflowText).toContain('--env BFF_SCHEDULER_OWNER="${BFF_SCHEDULER_OWNER}"');
    expect(stageWorkflowText).toContain('--env GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON="${GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON}"');
    expect(stageWorkflowText).toContain('--env FIREBASE_PROJECT_ID="${STAGE_FIREBASE_PROJECT_ID}"');
    expect(stageWorkflowText).toContain('--env JVM_WEEKLY_FIRESTORE_PROJECT_ID="${JVM_WEEKLY_FIRESTORE_PROJECT_ID}"');
    expect(stageWorkflowText).toContain('--env JVM_WEEKLY_AUTH_MODE="${JVM_WEEKLY_AUTH_MODE}"');
    expect(stageWorkflowText).not.toContain('--prod');
  });

  it('keeps deploy workflows focused on deployment after CI gates have passed', () => {
    expect(stageWorkflowText).not.toContain('run: npm ci');
    expect(stageWorkflowText).not.toContain('Unit tests');
    expect(stageWorkflowText).not.toContain('RBAC policy verify');
    expect(stageWorkflowText).not.toContain('Stage build');

    expect(workflowText).toContain('Verify CI succeeded for this commit');
    expect(workflowText).toContain('actions/workflows/ci.yml/runs');
    expect(workflowText).toContain('CI must be green for ${GITHUB_SHA} before production deploy.');
    expect(workflowText).not.toContain('node scripts/assert-safe-live-deploy.mjs');
    expect(workflowText).not.toContain('Verify production deploy policy');
    expect(workflowText).not.toContain('run: npm ci');
    expect(workflowText).not.toContain('Unit tests');
    expect(workflowText).not.toContain('RBAC policy verify');
    expect(workflowText).not.toContain('Production build');
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
