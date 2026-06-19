import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..');
const workflowText = readFileSync(resolve(repoRoot, '.github/workflows/production-deploy.yml'), 'utf8');
const stageWorkflowText = readFileSync(resolve(repoRoot, '.github/workflows/stage-deploy.yml'), 'utf8');

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
    expect(workflowText).toContain('node deploy-prod-align.mjs --verify-only "${DEPLOYMENT_URL}"');
  });

  it('keeps the Vercel deployment URL parse failure path reachable under pipefail', () => {
    expect(workflowText).toContain('deployment_url="$(grep -Eo');
    expect(workflowText).toContain('| tail -n 1 || true)"');
    expect(workflowText).toContain('Could not parse Vercel deployment URL');
  });

  it('uses a production-scoped Vercel token secret to avoid repo/environment name shadowing', () => {
    expect(workflowText).toContain('VERCEL_DEPLOY_TOKEN_PRODUCTION');
    expect(workflowText).not.toContain('VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}');
    expect(workflowText).toContain('Missing secret: VERCEL_DEPLOY_TOKEN_PRODUCTION');
    expect(workflowText).toContain('whoami --token "${VERCEL_TOKEN}" --scope merryai-devs-projects');
  });
});

describe('stage release workflow safety', () => {
  it('validates the stage Vercel token against the expected team before release work', () => {
    expect(stageWorkflowText).toMatch(/environment:\n\s+name: Stage/);
    expect(stageWorkflowText).toContain('VERCEL_DEPLOY_TOKEN_STAGE');
    expect(stageWorkflowText).toContain('Missing secret: VERCEL_DEPLOY_TOKEN_STAGE');
    expect(stageWorkflowText).toContain('whoami --token "${VERCEL_TOKEN}" --scope merryai-devs-projects');
    expect(stageWorkflowText.indexOf('whoami --token "${VERCEL_TOKEN}" --scope merryai-devs-projects')).toBeLessThan(
      stageWorkflowText.indexOf('run: npm ci'),
    );
  });

  it('accepts the protected stage alias redirect to the Cloudflare security domain', () => {
    expect(stageWorkflowText).toContain('curl -fsSLI "https://${STAGE_CANONICAL_HOST}/"');
    expect(stageWorkflowText).toContain('200|401|403) ;;');
    expect(stageWorkflowText).toContain('307)');
    expect(stageWorkflowText).toContain('https://soc.myscguard.app/*');
    expect(stageWorkflowText).toContain('Unexpected stage redirect location');
  });

  it('does not hang indefinitely when Vercel returns a blocked preview deployment', () => {
    expect(stageWorkflowText).toContain('deploy --yes --no-wait --target preview --token "${VERCEL_TOKEN}"');
    expect(stageWorkflowText).toContain('--wait');
    expect(stageWorkflowText).toContain('--timeout 10m');
    expect(stageWorkflowText).toContain('Stage artifact is not READY');
  });
});
